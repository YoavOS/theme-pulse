// Inside-candle detector (daily / weekly / monthly).
// Reads cached OHLC from `yahoo_history_cache` (prefers 6mo, falls back to 1y)
// so this function almost never calls Yahoo when the RS Alpha universe has
// already been warmed by the 52W-high / EMA jobs. Missing symbols fall back
// to Yahoo (throttled, concurrency 8) and reuse the canonical 6mo row.
//
// Inside candle rule (both timeframes):
//   current.high <= prior.high AND current.low >= prior.low
// - Daily : last daily bar vs previous daily bar
// - Weekly: current ISO week aggregate vs previous week aggregate
// - Monthly: current calendar month aggregate vs previous month aggregate

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const CONCURRENCY = 8;
const MAX_SYMBOLS = 1500;
const DEADLINE_MS = 125_000;

interface OHLCBar { ts: number; open: number|null; high: number|null; low: number|null; close: number|null; volume: number|null }
interface Row { symbol: string; daily: boolean|null; weekly: boolean|null; monthly: boolean|null; source: "cache"|"yahoo"|"none"; error?: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s) || seen.has(s)) continue;
    seen.add(s); out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function isoWeekKey(d: Date): string {
  // ISO week number
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const weekNum = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function aggregateByKey(bars: OHLCBar[], keyFn: (d: Date) => string): { key: string; high: number; low: number }[] {
  const map = new Map<string, { high: number; low: number }>();
  const order: string[] = [];
  for (const b of bars) {
    if (b.high === null || b.low === null) continue;
    const d = new Date(b.ts * 1000);
    const k = keyFn(d);
    const prev = map.get(k);
    if (!prev) { map.set(k, { high: b.high, low: b.low }); order.push(k); }
    else { prev.high = Math.max(prev.high, b.high); prev.low = Math.min(prev.low, b.low); }
  }
  return order.map(k => ({ key: k, ...(map.get(k)!) }));
}

function computeFlags(symbol: string, ohlc: OHLCBar[], source: Row["source"]): Row {
  const bars = ohlc.filter(b => b.high !== null && b.low !== null).sort((a, b) => a.ts - b.ts);
  if (bars.length < 2) return { symbol, daily: null, weekly: null, monthly: null, source, error: "insufficient_history" };

  // Daily
  const d1 = bars[bars.length - 1];
  const d0 = bars[bars.length - 2];
  const daily = (d1.high as number) <= (d0.high as number) && (d1.low as number) >= (d0.low as number);

  // Weekly
  const weeks = aggregateByKey(bars, isoWeekKey);
  let weekly: boolean | null = null;
  if (weeks.length >= 2) {
    const w1 = weeks[weeks.length - 1];
    const w0 = weeks[weeks.length - 2];
    weekly = w1.high <= w0.high && w1.low >= w0.low;
  }

  // Monthly
  const months = aggregateByKey(bars, (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  let monthly: boolean | null = null;
  if (months.length >= 2) {
    const m1 = months[months.length - 1];
    const m0 = months[months.length - 2];
    monthly = m1.high <= m0.high && m1.low >= m0.low;
  }

  return { symbol, daily, weekly, monthly, source };
}

async function fetchYahoo(symbol: string): Promise<OHLCBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const r = j?.chart?.result?.[0]; if (!r) return null;
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const opens: (number|null)[] = q.open ?? [];
    const highs: (number|null)[] = q.high ?? [];
    const lows: (number|null)[] = q.low ?? [];
    const closes: (number|null)[] = q.close ?? [];
    const vols: (number|null)[] = q.volume ?? [];
    const out: OHLCBar[] = ts.map((t, i) => ({
      ts: t,
      open: Number.isFinite(opens[i] as number) ? (opens[i] as number) : null,
      high: Number.isFinite(highs[i] as number) ? (highs[i] as number) : null,
      low: Number.isFinite(lows[i] as number) ? (lows[i] as number) : null,
      close: Number.isFinite(closes[i] as number) ? (closes[i] as number) : null,
      volume: Number.isFinite(vols[i] as number) ? (vols[i] as number) : null,
    })).filter(b => b.close !== null);
    return out.length ? out : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = sanitize(body?.symbols);
    if (symbols.length === 0) return json({ error: "symbols[] required", rows: [] }, 400);

    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_KEY) return json({ error: "Backend not configured", rows: [] }, 500);
    const sb = createClient(SB_URL, SB_KEY);

    const rows = new Map<string, Row>();
    const cacheHits = new Map<string, OHLCBar[]>();

    // Read cached OHLC in chunks — 3mo is enough for daily/weekly/monthly inside bars,
    // then fall back to richer 6mo/1y rows if already warmed by other scans.
    for (const period of ["3mo", "6mo", "1y"] as const) {
      const missing = symbols.filter(s => !cacheHits.has(s));
      if (missing.length === 0) break;
      for (let i = 0; i < missing.length; i += 500) {
        const slice = missing.slice(i, i + 500);
        const { data } = await sb
          .from("yahoo_history_cache")
          .select("symbol, ohlc")
          .eq("period", period)
          .gte("fetched_at", new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString())
          .in("symbol", slice);
        for (const r of data ?? []) {
          if (Array.isArray(r.ohlc)) cacheHits.set(String(r.symbol).toUpperCase(), r.ohlc as OHLCBar[]);
        }
      }
    }
    for (const s of symbols) {
      const c = cacheHits.get(s);
      if (c?.length) rows.set(s, computeFlags(s, c, "cache"));
    }

    // Fetch missing from Yahoo (throttled, deadline-aware).
    const missing = symbols.filter(s => !rows.has(s));
    let idx = 0; let fetched = 0;
    const worker = async () => {
      while (idx < missing.length && Date.now() - startedAt < DEADLINE_MS) {
        const s = missing[idx++];
        const ohlc = await fetchYahoo(s);
        if (!ohlc) { rows.set(s, { symbol: s, daily: null, weekly: null, monthly: null, source: "none", error: "no_history" }); continue; }
        fetched++;
        rows.set(s, computeFlags(s, ohlc, "yahoo"));
        // Persist to canonical 6mo row for future warm hits.
        const closes = ohlc.map(b => b.close).filter((v): v is number => v !== null);
        const start = closes[0] ?? null;
        const end = closes[closes.length - 1] ?? null;
        const retPct = start && end ? Math.round(((end - start) / start) * 10000) / 100 : null;
        await sb.from("yahoo_history_cache").upsert({
          symbol: s, period: "6mo", return_pct: retPct, start_price: start, end_price: end,
          ohlc, data_points: ohlc.length, fetched_at: new Date().toISOString(),
        }, { onConflict: "symbol,period" });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, worker));

    const resultRows = symbols.map(s => rows.get(s) ?? { symbol: s, daily: null, weekly: null, monthly: null, source: "none" as const, error: "not_processed" });

    return json({
      total: symbols.length,
      cacheHits: cacheHits.size,
      fetched,
      partial: resultRows.some(r => r.error === "not_processed"),
      rows: resultRows,
    });
  } catch (e) {
    console.error("inside-candles error:", e);
    return json({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});
