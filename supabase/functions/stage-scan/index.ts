import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { classifyStage, completedWeeks, type Stage, type WeeklyBar } from "../_shared/stageEngine.ts";

/** ---------------------------------------------------------------
 * stage-scan — Weinstein Stage Analysis for the whole stock list.
 *
 * Driven by the app (Full Scan, or the "Scan Stages" button):
 *   { action: "symbols" }                 → stock list (RS universe + theme tickers)
 *   { action: "chunk", symbols: [...] }   → classify ≤80 symbols, upsert their rows
 *   { action: "finalize", startedAt }     → drop rows not refreshed by this scan
 *   { action: "status" }                  → row count + last week classified
 *
 * One Yahoo call per stock (2 years of weekly bars). Benchmark = SPY.
 * Storage: one row per stock in public.stock_stages (latest scan only).
 * --------------------------------------------------------------*/

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_CHUNK = 80;
const CONCURRENCY = 12;
const BENCH = "SPY";

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
    const body = await req.json().catch(() => ({})) as { action?: string; symbols?: string[]; startedAt?: string };
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
      const failed: string[] = [];
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
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
      if (rows.length) {
        const { error } = await db.from("stock_stages").upsert(rows, { onConflict: "symbol" });
        if (error) throw error;
      }
      return json({ ok: true, processed: rows.length, failed, market: { stage: bench.stage, substage: bench.substage } });
    }

    if (action === "finalize") {
      const startedAt = body.startedAt;
      if (!startedAt) return json({ ok: false, error: "startedAt required" }, 400);
      if (Date.parse(startedAt) > Date.now()) return json({ ok: false, error: "startedAt is in the future" }, 400);
      const { count: fresh } = await db.from("stock_stages").select("symbol", { count: "exact", head: true }).gte("updated_at", startedAt);
      const { count: stale } = await db.from("stock_stages").select("symbol", { count: "exact", head: true }).lt("updated_at", startedAt);
      // Safety: only prune when this scan clearly completed (never wipe on a failed scan).
      let removed = 0;
      if ((fresh ?? 0) > 0 && (fresh ?? 0) >= (stale ?? 0)) {
        const { error } = await db.from("stock_stages").delete().lt("updated_at", startedAt);
        if (error) throw error;
        removed = stale ?? 0;
      }
      return json({ ok: true, fresh: fresh ?? 0, removed });
    }

    // status
    const { count } = await db.from("stock_stages").select("symbol", { count: "exact", head: true });
    const { data: last } = await db.from("stock_stages").select("as_of, updated_at").order("updated_at", { ascending: false }).limit(1);
    return json({ ok: true, count: count ?? 0, asOf: last?.[0]?.as_of ?? null, updatedAt: last?.[0]?.updated_at ?? null });
  } catch (e) {
    if (isMissingTable(e)) return json({ ok: false, setupNeeded: true, error: "Stage table not created yet (migration not applied)." });
    console.error("stage-scan error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
