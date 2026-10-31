// rs-history — history for the RS Alpha distribution windows.
//
// Stores one compact snapshot per day of the RS stock list: each stock's sector, its relative
// strength vs SPY over 1d / 1w / 1m / 3m / 6m, and its ADR. The app replays the user's filters
// on these snapshots to draw how each sector's share of the list changed over time.
//
//   { action: "snapshot" } → save today's list as a "live" row (only when RS was updated that day)
//   { action: "rebuild" }  → fill missing past weeks ("rebuilt" rows) from the stored 1-year
//                            daily price history, using the same formulas as calculate-rs-scores
//   { action: "daily" }    → both (scheduled every weekday after the close), plus cleanup
//
// Rebuilt weeks use today's stock list and today's sectors: a stock that has since left the list
// is not counted, and the list's entry rules (market cap, dollar volume) are not re-checked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { adrAt, cleanBars, lastAtOrBefore, returnsAt, weekEnds, type Bar } from "../_shared/rsHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WEEKS = 26;            // rebuilt history length (6-month RS needs the first half of the year of prices)
const KEEP_DAYS = 400;
const DAY = 86_400;

/** Compact snapshot: column arrays, one entry per stock. */
export interface Snapshot {
  s: string[];               // symbols
  secs: string[];            // distinct sector / industry strings
  si: number[];              // index into secs (-1 = none)
  d1: (number | null)[]; w1: (number | null)[]; m1: (number | null)[]; m3: (number | null)[]; m6: (number | null)[];
  adr: (number | null)[];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const r2 = (x: number) => Math.round(x * 100) / 100;

// deno-lint-ignore no-explicit-any
async function readAll<T>(sb: any, table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** New York calendar date of a unix time (seconds). */
function nyDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts * 1000));
}

function encode(rows: { symbol: string; sector: string | null; d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; adr: number | null }[]): Snapshot {
  const secs: string[] = [];
  const secIdx = new Map<string, number>();
  const snap: Snapshot = { s: [], secs, si: [], d1: [], w1: [], m1: [], m3: [], m6: [], adr: [] };
  for (const r of rows) {
    let i = -1;
    if (r.sector) {
      i = secIdx.get(r.sector) ?? -1;
      if (i < 0) { i = secs.length; secs.push(r.sector); secIdx.set(r.sector, i); }
    }
    snap.s.push(r.symbol); snap.si.push(i);
    snap.d1.push(r.d1); snap.w1.push(r.w1); snap.m1.push(r.m1); snap.m3.push(r.m3); snap.m6.push(r.m6); snap.adr.push(r.adr);
  }
  return snap;
}

// ── Live snapshot ────────────────────────────────────────────────────────────

interface UniRow { symbol: string; sector: string | null; rs_1d: number | null; rs_1w: number | null; rs_1m: number | null; rs_3m: number | null; rs_6m: number | null; adr_percent: number | null; rs_calculated_at: string | null }

// deno-lint-ignore no-explicit-any
async function snapshot(sb: any) {
  const uni = await readAll<UniRow>(sb, "qualified_rs_universe", "symbol, sector, rs_1d, rs_1w, rs_1m, rs_3m, rs_6m, adr_percent, rs_calculated_at");
  const latest = uni.reduce<string | null>((m, r) => (r.rs_calculated_at && (!m || r.rs_calculated_at > m) ? r.rs_calculated_at : m), null);
  if (!latest || !uni.length) return { saved: false, reason: "no RS data" };
  // The day the RS values describe: the session that had closed when RS was last calculated.
  const day = nyDate(Math.floor(Date.parse(latest) / 1000) - 16 * 3600); // before 16:00 ET counts as the previous session
  const { data: existing } = await sb.from("rs_history_snapshots").select("day, source").eq("day", day).maybeSingle();
  if (existing?.source === "live") return { saved: false, reason: "already saved", day };
  const data = encode(uni.map((u) => ({ symbol: u.symbol, sector: u.sector, d1: u.rs_1d, w1: u.rs_1w, m1: u.rs_1m, m3: u.rs_3m, m6: u.rs_6m, adr: u.adr_percent })));
  const { error } = await sb.from("rs_history_snapshots").upsert({ day, source: "live", data }, { onConflict: "day" });
  if (error) throw error;
  return { saved: true, day, stocks: uni.length };
}

// ── Rebuild past weeks from price history ────────────────────────────────────
async function fetchYahoo1y(symbol: string): Promise<Bar[]> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!r.ok) { await r.body?.cancel(); return []; }
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const q = res?.indicators?.quote?.[0] ?? {};
    return cleanBars(ts.map((t, i) => ({ ts: t, open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null, close: q.close?.[i] ?? null, volume: q.volume?.[i] ?? null })));
  } catch { return []; }
}

// deno-lint-ignore no-explicit-any
async function rebuild(sb: any, started: number) {
  const [uni, existing] = await Promise.all([
    readAll<{ symbol: string; sector: string | null }>(sb, "qualified_rs_universe", "symbol, sector"),
    readAll<{ day: string }>(sb, "rs_history_snapshots", "day"),
  ]);
  const { data: spyRow } = await sb.from("yahoo_history_cache").select("ohlc, fetched_at").eq("symbol", "SPY").eq("period", "1y").maybeSingle();
  let spy = cleanBars(spyRow?.ohlc);
  // SPY isn't in the stock list, so the 52-week scan doesn't store its 1-year history: fetch it here.
  if (spy.length < 200 || !spyRow?.fetched_at || Date.now() - Date.parse(spyRow.fetched_at) > 2 * DAY * 1000) {
    const fresh = await fetchYahoo1y("SPY");
    if (fresh.length >= 200) {
      spy = fresh;
      const closes = fresh.map((b) => b.close!);
      await sb.from("yahoo_history_cache").upsert({
        symbol: "SPY", period: "1y", ohlc: fresh, data_points: fresh.length, fetched_at: new Date().toISOString(),
        start_price: closes[0], end_price: closes[closes.length - 1],
        return_pct: r2(((closes[closes.length - 1] - closes[0]) / closes[0]) * 100),
      }, { onConflict: "symbol,period" });
    }
  }
  if (spy.length < 150) return { rebuilt: 0, reason: "no 1-year SPY history yet (run the 52-week highs scan)" };

  const nowTs = Math.floor(Date.now() / 1000);
  const have = new Set(existing.map((e) => e.day));
  // Weeks that already have any row in that week are skipped.
  const weekHas = (ts: number) => { for (let k = 0; k < 7; k++) if (have.has(nyDate(ts - k * DAY))) return true; return false; };
  const targets = weekEnds(spy, nowTs, WEEKS).filter((ts) => !weekHas(ts) && returnsAt(spy, lastAtOrBefore(spy, ts)).m6 !== null);
  if (!targets.length) return { rebuilt: 0, reason: "nothing missing" };

  const spyRet = targets.map((ts) => returnsAt(spy, lastAtOrBefore(spy, ts)));
  const perWeek = targets.map(() => [] as { symbol: string; sector: string | null; d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; adr: number | null }[]);
  const sectorOf = new Map(uni.map((u) => [u.symbol, u.sector]));
  const symbols = uni.map((u) => u.symbol);
  let withHistory = 0;

  // Read the price history in pages so only ~150 stocks' bars are in memory at once.
  for (let p = 0; p < symbols.length; p += 150) {
    if (Date.now() - started > 50_000) break;
    const page = symbols.slice(p, p + 150);
    const { data, error } = await sb.from("yahoo_history_cache").select("symbol, ohlc").eq("period", "1y").in("symbol", page);
    if (error) throw error;
    for (const row of data ?? []) {
      const bars = cleanBars(row.ohlc);
      if (bars.length < 30) continue;
      withHistory++;
      targets.forEach((ts, w) => {
        const i = lastAtOrBefore(bars, ts);
        if (i < 0 || ts - bars[i].ts > 4 * DAY) return; // no bar near that week (not trading yet, halted)
        const r = returnsAt(bars, i), s = spyRet[w];
        const rel = (a: number | null, b: number | null) => (a !== null && b !== null ? r2(a - b) : null);
        perWeek[w].push({
          symbol: row.symbol, sector: sectorOf.get(row.symbol) ?? null,
          d1: rel(r.d1, s.d1), w1: rel(r.w1, s.w1), m1: rel(r.m1, s.m1), m3: rel(r.m3, s.m3), m6: rel(r.m6, s.m6),
          adr: adrAt(bars, i),
        });
      });
    }
  }

  const rows = targets.map((ts, w) => ({ day: nyDate(ts), source: "rebuilt", data: encode(perWeek[w]) }))
    .filter((r) => r.data.s.length >= 50);
  for (const r of rows) {
    const { error } = await sb.from("rs_history_snapshots").upsert(r, { onConflict: "day", ignoreDuplicates: true });
    if (error) throw error;
  }
  return { rebuilt: rows.length, weeks: rows.map((r) => r.day), stocksWithHistory: withHistory, listSize: symbols.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({})) as { action?: string };
    const sb = createClient(SB_URL, SB_KEY);
    const action = body.action ?? "daily";
    const out: Record<string, unknown> = { ok: true };
    if (action === "snapshot" || action === "daily") out.snapshot = await snapshot(sb);
    if (action === "rebuild" || action === "daily") out.rebuild = await rebuild(sb, started);
    if (action === "daily") {
      const cutoff = new Date(Date.now() - KEEP_DAYS * DAY * 1000).toISOString().slice(0, 10);
      await sb.from("rs_history_snapshots").delete().lt("day", cutoff);
    }
    out.ms = Date.now() - started;
    return json(out);
  } catch (e) {
    console.error("rs-history error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
