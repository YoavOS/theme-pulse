import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { classifyStage, completedWeeks, type Stage, type WeeklyBar } from "../_shared/stageEngine.ts";
import { detectBase, finalizeBase, type BaseFeatures, type DailyBar } from "../_shared/baseEngine.ts";

/** ---------------------------------------------------------------
 * stage-scan — Weinstein Stage Analysis + Base Scanner for the whole stock list.
 *
 * Driven by the app (Full Scan, or the "Scan Stages" button):
 *   { action: "symbols" }                       → stock list (RS universe + theme tickers)
 *   { action: "chunk", symbols: [...] }         → stages + base candidates for ≤80 symbols
 *   { action: "finalize", startedAt, prune }    → RS percentiles, earnings, final base scores;
 *                                                 drop rows not refreshed (only when prune)
 *   { action: "status" }                        → row counts + last week classified
 *
 * One Yahoo call per stock (2 years of weekly bars). Benchmark = SPY.
 * Daily bars for breakout timing are read from the Full Scan's cache
 * (yahoo_history_cache, period 6mo) — no extra API calls.
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1wk&includePrePost=false`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
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
    const body = await req.json().catch(() => ({})) as { action?: string; symbols?: string[]; startedAt?: string; prune?: boolean };
    const action = body.action ?? "status";

    if (action === "symbols") {
      const universe = await fetchAll<{ symbol: string }>(db, "qualified_rs_universe", "symbol");
      const themed = await fetchAll<{ ticker_symbol: string }>(db, "theme_tickers", "ticker_symbol");
      const set = new Set<string>([BENCH]);
      for (const r of universe) if (r.symbol) set.add(r.symbol.toUpperCase().trim());
      for (const r of themed) if (r.ticker_symbol) set.add(r.ticker_symbol.toUpperCase().trim());
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
      let cursor = 0;
      const worker = async () => {
        while (cursor < symbols.length) {
          const sym = symbols[cursor++];
          const raw = sym === BENCH ? bench.bars : await fetchWeekly(sym);
          const bars = raw ? (sym === BENCH ? raw : completedWeeks(raw)) : null;
          const r = bars ? classifyStage(bars, sym === BENCH ? null : bench.bars, bench.stage) : null;
          if (!r) { failed.push(sym); continue; }
          rows.push({
            symbol: sym, stage: r.stage, substage: r.substage, confidence: r.confidence, quality: r.quality,
            event: r.event, event_kind: r.eventKind, event_weeks_ago: r.eventWeeksAgo, weeks_in_stage: r.weeksInStage,
            last_directional: r.lastDirectional, history: r.history, features: r.features, reasons: r.reasons,
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

        // Upcoming earnings (one Finnhub call for the next 30 days)
        const earnings = new Map<string, string>();
        if (FINNHUB_KEY) {
          try {
            const today = new Date().toISOString().slice(0, 10);
            const to = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
            const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${to}&token=${FINNHUB_KEY}`);
            if (res.ok) {
              const j = await res.json();
              for (const e of (j?.earningsCalendar ?? []) as { symbol?: string; date?: string }[]) {
                if (!e.symbol || !e.date) continue;
                const sym = e.symbol.toUpperCase();
                const prev = earnings.get(sym);
                if (!prev || e.date < prev) earnings.set(sym, e.date);
              }
            } else await res.body?.cancel();
          } catch (e) { console.warn("earnings calendar failed", e); }
        }

        const baseRows = await fetchAll<{ symbol: string; features: BaseFeatures; as_of: string }>(db, "stock_bases", "symbol, features, as_of");
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
          const fin = finalizeBase(f, rsPct, inDays);
          if (!fin) { drop.push(row.symbol); continue; }
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

      return json({ ok: true, fresh: fresh ?? 0, removed, bases });
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
