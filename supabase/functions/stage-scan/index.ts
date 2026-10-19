import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { classifyStage, completedWeeks, type Stage, type WeeklyBar } from "../_shared/stageEngine.ts";
import { detectBase, finalizeBase, type BaseFeatures, type DailyBar } from "../_shared/baseEngine.ts";
import { logSignals, type BaseLogInfo } from "../_shared/signalLog.ts";
import { dailySnapshot } from "../_shared/dailySnapshot.ts";
import { fetchEarnGrowth, type EarnGrowth } from "../_shared/earningsGrowth.ts";
import { fetchEarningsCalendar, measureEarnings, scoreFuel, type DBar, type EarnEvent, type EarnInfo } from "../_shared/earningsFuel.ts";

/** ---------------------------------------------------------------
 * stage-scan — Weinstein Stage Analysis + Base Scanner for the whole stock list.
 *
 * Driven by the app (Full Scan, or the "Scan Stages" button):
 *   { action: "symbols" }                       → stock list (RS universe + theme tickers)
 *   { action: "chunk", symbols: [...] }         → stages + base candidates for ≤80 symbols
 *   { action: "finalize", startedAt, prune }    → RS percentiles, earnings, final base scores;
 *                                                 drop rows not refreshed (only when prune);
 *                                                 signal log snapshot + 4/8/13-week outcomes
 *   { action: "status" }                        → row counts + last week classified
 *   { action: "chart", symbol }                 → last 2 years of weekly bars + 30w MA (app charts)
 *
 * One Yahoo call per stock (5 years of weekly bars — long warm-up for the stage state machine). Benchmark = SPY.
 * Daily bars (breakout timing + the screens' daily snapshot, features.dly) are read from the Full Scan's
 * cache (yahoo_history_cache, period 6mo); stocks missing from it get one extra daily call.
 * Storage: one row per stock in stock_stages, one per base candidate in
 * stock_bases (latest scan only).
 * --------------------------------------------------------------*/

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_CHUNK = 80;
const CONCURRENCY = 12;
const BENCH = "SPY";
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

async function fetchWeekly(symbol: string): Promise<WeeklyBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1wk&includePrePost=false`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await res.body?.cancel(); await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok) { await res.body?.cancel(); return null; }
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      const q = r?.indicators?.quote?.[0] ?? {};
      const out: WeeklyBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i], h = q.high?.[i], l = q.low?.[i], o = q.open?.[i];
        if (c == null || h == null || l == null) continue;
        out.push({ t: ts[i], o: o ?? c, h, l, c, v: q.volume?.[i] ?? 0 });
      }
      return out;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

async function fetchDaily(symbol: string, range = "6mo"): Promise<DailyBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429) { await res.body?.cancel(); await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok) { await res.body?.cancel(); return null; }
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      const q = r?.indicators?.quote?.[0] ?? {};
      const out: DailyBar[] = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close?.[i] == null) continue;
        out.push({ ts: ts[i], open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null, close: q.close[i], volume: q.volume?.[i] ?? null });
      }
      return out;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

// Benchmark cached per warm instance (10 min).
let benchCache: { at: number; bars: WeeklyBar[]; stage: Stage | null; substage: string | null } | null = null;
async function getBench() {
  if (benchCache && Date.now() - benchCache.at < 10 * 60_000) return benchCache;
  const raw = await fetchWeekly(BENCH);
  const bars = raw ? completedWeeks(raw) : [];
  const r = bars.length ? classifyStage(bars, null, null) : null;
  const out = { at: Date.now(), bars, stage: r?.stage ?? null, substage: r?.substage ?? null };
  if (bars.length) benchCache = out; // never cache a failed benchmark fetch
  return out;
}

async function fetchAll<T>(db: SupabaseClient, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

const isMissingTable = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("42p01");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; symbols?: string[]; symbol?: string; startedAt?: string; prune?: boolean };
    const action = body.action ?? "status";

    if (action === "symbols") {
      const universe = await fetchAll<{ symbol: string }>(db, "qualified_rs_universe", "symbol");
      const themed = await fetchAll<{ ticker_symbol: string }>(db, "theme_tickers", "ticker_symbol");
      const set = new Set<string>([BENCH]);
      // only well-formed tickers (a mis-pasted row of run-together symbols would be one huge "ticker")
      const add = (x: string | null) => { const s = (x ?? "").toUpperCase().trim(); if (/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(s)) set.add(s); };
      for (const r of universe) add(r.symbol);
      for (const r of themed) add(r.ticker_symbol);
      // serverTime: the scan's start mark for "finalize" (server clock, so a wrong
      // computer clock can never make fresh rows look stale).
      return json({ ok: true, symbols: [...set].sort(), serverTime: new Date().toISOString() });
    }

    if (action === "chunk") {
      const symbols = [...new Set((body.symbols ?? []).map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, MAX_CHUNK);
      const bench = await getBench();
      const rows: Record<string, unknown>[] = [];
      const baseRows: Record<string, unknown>[] = [];
      const failed: string[] = [];

      // Recent daily bars from the Full Scan cache (fresh within 4 days), for breakout timing.
      const dailyBy = new Map<string, DailyBar[]>();
      {
        const since = new Date(Date.now() - 4 * 86400_000).toISOString();
        const { data } = await db.from("yahoo_history_cache").select("symbol, ohlc")
          .eq("period", "6mo").gte("fetched_at", since).in("symbol", symbols);
        for (const r of (data ?? []) as { symbol: string; ohlc: DailyBar[] | null }[]) {
          if (Array.isArray(r.ohlc)) dailyBy.set(String(r.symbol).toUpperCase(), r.ohlc);
        }
      }
      // Earnings growth snapshot (features.ern): reuse one fetched in the last 7 days.
      const ernBy = new Map<string, EarnGrowth>();
      {
        const { data } = await db.from("stock_stages").select("symbol, ern:features->ern").in("symbol", symbols);
        for (const r of (data ?? []) as { symbol: string; ern: EarnGrowth | null }[]) {
          if (r.ern?.at && Date.now() - Date.parse(r.ern.at) < 7 * 86400_000) ernBy.set(r.symbol, r.ern);
        }
      }
      let cursor = 0;
      const worker = async () => {
        while (cursor < symbols.length) {
          const sym = symbols[cursor++];
          const raw = sym === BENCH ? bench.bars : await fetchWeekly(sym);
          const bars = raw ? (sym === BENCH ? raw : completedWeeks(raw)) : null;
          const r = bars ? classifyStage(bars, sym === BENCH ? null : bench.bars, bench.stage) : null;
          if (!r) { failed.push(sym); continue; }
          // Daily bars: Full Scan cache first, otherwise one daily call (never fatal).
          if (sym !== BENCH && !dailyBy.has(sym)) {
            try { const d = await fetchDaily(sym); if (d?.length) dailyBy.set(sym, d); } catch { /* ignore */ }
          }
          let dly = null;
          try { dly = sym === BENCH ? null : dailySnapshot(dailyBy.get(sym)); } catch { /* ignore */ }
          let ern: EarnGrowth | null = ernBy.get(sym) ?? null;
          if (!ern && sym !== BENCH) ern = await fetchEarnGrowth(sym);
          rows.push({
            symbol: sym, stage: r.stage, substage: r.substage, confidence: r.confidence, quality: r.quality,
            event: r.event, event_kind: r.eventKind, event_weeks_ago: r.eventWeeksAgo, weeks_in_stage: r.weeksInStage,
            last_directional: r.lastDirectional, history: r.history, features: { ...r.features, dly, ern }, reasons: r.reasons,
            as_of: r.asOf, updated_at: new Date().toISOString(),
          });
          if (sym === BENCH || !bars) continue;
          // Base candidate (never let a base-engine problem break the stage scan)
          try {
            const b = detectBase({
              weekly: bars, bench: bench.bars, daily: dailyBy.get(sym) ?? null,
              stage: { stage: r.stage, weeksInStage: r.weeksInStage }, marketStage: bench.stage,
            });
            if (b) {
              baseRows.push({
                symbol: sym, features: b, pivot: b.pivot, support: b.support, dist_to_pivot: b.distToPivotPct,
                stop_risk: b.stopRiskPct, as_of: r.asOf, updated_at: new Date().toISOString(),
                score: null, band: null, state: null, primary_label: null, labels: null, tier: null,
                rs_pct: null, breakdown: null, warnings: null, earnings_date: null,
              });
            }
          } catch (e) {
            console.warn(`base engine failed for ${sym}`, e);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
      if (rows.length) {
        const { error } = await db.from("stock_stages").upsert(rows, { onConflict: "symbol" });
        if (error) throw error;
      }
      let basesStored = 0;
      if (baseRows.length) {
        const { error } = await db.from("stock_bases").upsert(baseRows, { onConflict: "symbol" });
        if (error) console.warn("stock_bases upsert failed", error.message); else basesStored = baseRows.length;
      }
      // Stocks scanned now without a qualifying base lose any older base row right away
      // (so a partial scan never leaves a stale setup behind).
      const withBase = new Set(baseRows.map((r) => r.symbol as string));
      const noBase = rows.map((r) => r.symbol as string).filter((s) => !withBase.has(s));
      if (noBase.length) {
        const { error } = await db.from("stock_bases").delete().in("symbol", noBase);
        if (error && !isMissingTable(error)) console.warn("stock_bases cleanup failed", error.message);
      }
      return json({ ok: true, processed: rows.length, bases: basesStored, failed, market: { stage: bench.stage, substage: bench.substage } });
    }

    if (action === "chart") {
      // Weekly bars for one stock (the app's stage / base charts) — last 2 years + 30-week MA.
      const sym = String(body.symbol ?? "").toUpperCase().trim();
      if (!/^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(sym)) return json({ ok: false, error: "bad symbol" }, 400);
      const raw = await fetchWeekly(sym);
      const bars = raw ? completedWeeks(raw) : [];
      if (!bars.length) return json({ ok: false, error: "no data" });
      const n = bars.length, k0 = Math.max(0, n - 104);
      const sig = (x: number) => Number(x.toPrecision(5));
      const ma = bars.slice(k0).map((_, k) => {
        const j = k0 + k;
        if (j < 29) return null;
        let t = 0;
        for (let q = j - 29; q <= j; q++) t += bars[q].c;
        return sig(t / 30);
      });
      const sl = bars.slice(k0);
      return json({ ok: true, symbol: sym, t: sl.map((b) => b.t), o: sl.map((b) => sig(b.o)), h: sl.map((b) => sig(b.h)), l: sl.map((b) => sig(b.l)), c: sl.map((b) => sig(b.c)), ma });
    }

    if (action === "finalize") {
      const startedAt = body.startedAt;
      if (!startedAt) return json({ ok: false, error: "startedAt required" }, 400);
      if (Date.parse(startedAt) > Date.now()) return json({ ok: false, error: "startedAt is in the future" }, 400);
      const prune = body.prune !== false;

      // 1. Stages: prune rows not refreshed by this scan (only after a clearly successful scan).
      const { count: fresh } = await db.from("stock_stages").select("symbol", { count: "exact", head: true }).gte("updated_at", startedAt);
      const { count: stale } = await db.from("stock_stages").select("symbol", { count: "exact", head: true }).lt("updated_at", startedAt);
      let removed = 0;
      if (prune && (fresh ?? 0) > 0 && (fresh ?? 0) >= (stale ?? 0)) {
        const { error } = await db.from("stock_stages").delete().lt("updated_at", startedAt);
        if (error) throw error;
        removed = stale ?? 0;
      }

      // 2. Bases: cross-sectional 26-week RS percentile over the whole stock list.
      const bases = { finalized: 0, dropped: 0, pruned: 0, error: null as string | null };
      let rsPctOf: (x: number | null | undefined) => number | null = () => null;
      const baseBy = new Map<string, BaseLogInfo>();
      try {
        const stageRows = await fetchAll<{ symbol: string; r26: number | null }>(db, "stock_stages", "symbol, r26:features->r26Pct");
        const vals = stageRows.map((r) => Number(r.r26)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
        const pctOf = (x: number | null | undefined) => {
          if (x === null || x === undefined || !Number.isFinite(Number(x)) || !vals.length) return null;
          // share of the list with a lower-or-equal 26-week return (binary search)
          let lo = 0, hi = vals.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] <= Number(x)) lo = m + 1; else hi = m; }
          return Math.max(1, Math.min(99, Math.round((lo / vals.length) * 100)));
        };
        rsPctOf = pctOf;

        // Earnings: the next report date (warnings) and how the latest report landed (earnings fuel)
        const earnings = new Map<string, string>();
        const lastReport = new Map<string, EarnEvent>();
        if (FINNHUB_KEY) {
          try {
            const today = new Date().toISOString().slice(0, 10);
            for (const e of await fetchEarningsCalendar(FINNHUB_KEY, -75, 31)) {
              if (e.date >= today) {
                const prev = earnings.get(e.symbol);
                if (!prev || e.date < prev) earnings.set(e.symbol, e.date);
              } else {
                const prev = lastReport.get(e.symbol);
                if (!prev || e.date > prev.date) lastReport.set(e.symbol, e);
              }
            }
          } catch (e) { console.warn("earnings calendar failed", e); }
        }

        const baseRows = await fetchAll<{ symbol: string; features: BaseFeatures; as_of: string }>(db, "stock_bases", "symbol, features, as_of");
        // Earnings fuel for base candidates that reported in the last ~75 days (daily bars from the
        // Full Scan cache; a few missing ones fetched from Yahoo).
        const fuelBy = new Map<string, EarnInfo>();
        try {
          const want = baseRows.map((r) => r.symbol).filter((x) => lastReport.has(x));
          if (want.length) {
            const dailyOf = new Map<string, DBar[]>();
            for (let k = 0; k < want.length + 1; k += 100) {
              const syms = [...want.slice(k, k + 100), ...(k === 0 ? [BENCH] : [])];
              const { data } = await db.from("yahoo_history_cache").select("symbol, period, ohlc").in("symbol", syms).in("period", ["6mo", "1y"]);
              for (const r of (data ?? []) as { symbol: string; period: string; ohlc: DBar[] | null }[]) {
                if (!Array.isArray(r.ohlc) || !r.ohlc.length) continue;
                const cur = dailyOf.get(r.symbol);
                const lastTs = (a: DBar[]) => a[a.length - 1]?.ts ?? 0;
                if (!cur || lastTs(r.ohlc) > lastTs(cur)) dailyOf.set(r.symbol, r.ohlc);
              }
            }
            const staleCut = Date.now() / 1000 - 6 * 86400;
            const isStale = (a?: DBar[]) => !a || !a.length || a[a.length - 1].ts < staleCut;
            if (isStale(dailyOf.get(BENCH))) { const b = await fetchDaily(BENCH); if (b) dailyOf.set(BENCH, b); }
            let fetched = 0;
            for (const sym of want) {
              if (!isStale(dailyOf.get(sym)) || fetched >= 40) continue;
              const b = await fetchDaily(sym); fetched++;
              if (b) dailyOf.set(sym, b);
            }
            const spyD = dailyOf.get(BENCH) ?? [];
            for (const sym of want) {
              const d = dailyOf.get(sym);
              if (!d || isStale(d)) continue;
              const info = measureEarnings(lastReport.get(sym)!, d, spyD);
              if (info) fuelBy.set(sym, info);
            }
            scoreFuel([...fuelBy.values()]);
          }
        } catch (e) { console.warn("earnings fuel failed", e); }

        const updates: Record<string, unknown>[] = [];
        const drop: string[] = [];
        const todayMs = Date.parse(new Date().toISOString().slice(0, 10));
        const r26By = new Map(stageRows.map((r) => [r.symbol, r.r26 === null ? null : Number(r.r26)]));
        for (const row of baseRows) {
          const f = row.features;
          if (!f || !Array.isArray(f.labels)) { drop.push(row.symbol); continue; }
          const rsPct = pctOf(r26By.get(row.symbol) ?? f.r26Pct);
          const ed = earnings.get(row.symbol) ?? null;
          const inDays = ed ? Math.round((Date.parse(ed) - todayMs) / 86400_000) : null;
          f.earn = fuelBy.get(row.symbol) ?? null;
          const fin = finalizeBase(f, rsPct, inDays);
          if (!fin) { drop.push(row.symbol); continue; }
          baseBy.set(row.symbol, {
            score: fin.score, state: fin.state, label: fin.primaryLabel, labels: fin.labels,
            tight: !!f.daily?.contracting, pivot: f.pivot, rvol: f.trigger?.rvol ?? null,
            earnFuel: f.earn?.fuel ?? null, earnLabel: f.earn?.label ?? null, volScore: f.trigger?.vol?.score ?? null,
          });
          updates.push({
            symbol: row.symbol, features: f, as_of: row.as_of,
            score: fin.score, band: fin.band, state: fin.state, primary_label: fin.primaryLabel, labels: fin.labels,
            tier: fin.tier, rs_pct: rsPct, breakdown: fin.breakdown, warnings: fin.warnings, earnings_date: ed,
            pivot: f.pivot, support: f.support, dist_to_pivot: f.distToPivotPct, stop_risk: f.stopRiskPct,
          });
        }
        for (let k = 0; k < updates.length; k += 500) {
          const { error } = await db.from("stock_bases").upsert(updates.slice(k, k + 500), { onConflict: "symbol" });
          if (error) throw error;
        }
        for (let k = 0; k < drop.length; k += 200) {
          const { error } = await db.from("stock_bases").delete().in("symbol", drop.slice(k, k + 200));
          if (error) throw error;
        }
        bases.finalized = updates.length;
        bases.dropped = drop.length;
        if (prune) {
          const { count: staleBases } = await db.from("stock_bases").select("symbol", { count: "exact", head: true }).lt("updated_at", startedAt);
          if (staleBases) {
            const { error } = await db.from("stock_bases").delete().lt("updated_at", startedAt);
            if (error) throw error;
            bases.pruned = staleBases;
          }
        }
      } catch (e) {
        bases.error = e instanceof Error ? e.message : String(e);
        console.warn("base finalize failed", e);
      }

      // 3. Signal log: this week's snapshot + outcomes of earlier weeks (the app's own track record)
      let signals: Record<string, unknown> = {};
      try {
        const rowsForLog = await fetchAll<Parameters<typeof logSignals>[1][number]>(db, "stock_stages", "symbol, stage, substage, confidence, event_kind, as_of, features");
        signals = await logSignals(db, rowsForLog, rsPctOf, baseBy, fetchWeekly);
      } catch (e) {
        signals = { error: isMissingTable(e) ? "signal_log table not created yet" : e instanceof Error ? e.message : String(e) };
        console.warn("signal log failed", e);
      }

      return json({ ok: true, fresh: fresh ?? 0, removed, bases, signals });
    }

    // status
    const { count } = await db.from("stock_stages").select("symbol", { count: "exact", head: true });
    const { count: baseCount } = await db.from("stock_bases").select("symbol", { count: "exact", head: true });
    const { data: last } = await db.from("stock_stages").select("as_of, updated_at").order("updated_at", { ascending: false }).limit(1);
    return json({ ok: true, count: count ?? 0, bases: baseCount ?? 0, asOf: last?.[0]?.as_of ?? null, updatedAt: last?.[0]?.updated_at ?? null });
  } catch (e) {
    if (isMissingTable(e)) return json({ ok: false, setupNeeded: true, error: "Stage table not created yet (migration not applied)." });
    console.error("stage-scan error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
