// 52-Week High detector.
// Reads cached 1y OHLC from `yahoo_history_cache` (period='1y') to compute the
// most recent date a symbol printed a new 52-week high. For symbols missing a
// fresh cache row, falls back to Yahoo (throttled, concurrency 10) and upserts
// the canonical 1y row for future calls.
//
// Cache strategy: relaxed 7-day TTL — the "last 52w high" doesn't change
// materially unless a new high just printed. Client-side hook adds an
// additional localStorage layer so a full universe scan runs at most once/day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CONCURRENCY = 10;
const MAX_SYMBOLS = 1500;
const DEADLINE_MS = 125_000;

interface OHLCBar {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface Row {
  symbol: string;
  high52w: number | null;
  latestClose: number | null;
  lastHighDaysAgo: number | null; // days since the most recent bar equal to the 52W high
  pctBelowHigh: number | null;    // (latestClose / high52w - 1) * 100
  source: "cache" | "yahoo" | "none";
  error?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function computeFromOhlc(symbol: string, ohlc: OHLCBar[], source: Row["source"]): Row {
  // Consider the last ~365 days worth of bars.
  const cutoff = Math.floor(Date.now() / 1000) - 366 * 86400;
  const bars = ohlc.filter(b => b.ts >= cutoff && b.high !== null && b.high > 0);
  if (bars.length < 20) {
    return { symbol, high52w: null, latestClose: null, lastHighDaysAgo: null, pctBelowHigh: null, source, error: "insufficient_history" };
  }
  let high = 0;
  for (const b of bars) if ((b.high as number) > high) high = b.high as number;
  // Find last bar within 0.05% of the 52W high (accounts for split-adjust rounding).
  const threshold = high * 0.9995;
  let lastHighTs = 0;
  for (const b of bars) {
    if ((b.high as number) >= threshold && b.ts > lastHighTs) lastHighTs = b.ts;
  }
  const lastClose = [...bars].reverse().find(b => b.close !== null)?.close ?? null;
  const daysAgo = lastHighTs > 0 ? Math.max(0, Math.floor((Date.now() / 1000 - lastHighTs) / 86400)) : null;
  const pctBelow = lastClose && high > 0 ? Math.round(((lastClose / high - 1) * 10000)) / 100 : null;
  return {
    symbol,
    high52w: Math.round(high * 100) / 100,
    latestClose: lastClose !== null ? Math.round(lastClose * 100) / 100 : null,
    lastHighDaysAgo: daysAgo,
    pctBelowHigh: pctBelow,
    source,
  };
}

async function fetchYahoo1y(symbol: string): Promise<OHLCBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = q.open ?? [];
    const highs: (number | null)[] = q.high ?? [];
    const lows: (number | null)[] = q.low ?? [];
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];
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

    // Step 1: read cached 1y rows in chunks.
    const cacheHits = new Map<string, OHLCBar[]>();
    for (let i = 0; i < symbols.length; i += 500) {
      const slice = symbols.slice(i, i + 500);
      const { data } = await sb
        .from("yahoo_history_cache")
        .select("symbol, ohlc, fetched_at")
        .eq("period", "1y")
        .gte("fetched_at", new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString())
        .in("symbol", slice);
      for (const r of data ?? []) {
        if (Array.isArray(r.ohlc)) cacheHits.set(String(r.symbol).toUpperCase(), r.ohlc as OHLCBar[]);
      }
    }
    for (const s of symbols) {
      const c = cacheHits.get(s);
      if (c?.length) rows.set(s, computeFromOhlc(s, c, "cache"));
    }

    // Step 2: fetch missing from Yahoo (throttled, deadline-aware).
    const missing = symbols.filter(s => !rows.has(s));
    let idx = 0;
    let fetched = 0;
    const worker = async () => {
      while (idx < missing.length && Date.now() - startedAt < DEADLINE_MS) {
        const s = missing[idx++];
        const ohlc = await fetchYahoo1y(s);
        if (!ohlc) {
          rows.set(s, { symbol: s, high52w: null, latestClose: null, lastHighDaysAgo: null, pctBelowHigh: null, source: "none", error: "no_history" });
          continue;
        }
        fetched++;
        rows.set(s, computeFromOhlc(s, ohlc, "yahoo"));
        const closes = ohlc.map(b => b.close).filter((v): v is number => v !== null);
        const start = closes[0] ?? null;
        const end = closes[closes.length - 1] ?? null;
        const retPct = start && end ? Math.round(((end - start) / start) * 10000) / 100 : null;
        await sb.from("yahoo_history_cache").upsert({
          symbol: s,
          period: "1y",
          return_pct: retPct,
          start_price: start,
          end_price: end,
          ohlc,
          data_points: ohlc.length,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "symbol,period" });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, worker));

    const resultRows = symbols.map(s => rows.get(s) ?? {
      symbol: s, high52w: null, latestClose: null, lastHighDaysAgo: null, pctBelowHigh: null, source: "none" as const, error: "not_processed",
    });

    return json({
      total: symbols.length,
      cacheHits: cacheHits.size,
      fetched,
      computed: resultRows.filter(r => r.high52w !== null).length,
      partial: resultRows.some(r => r.error === "not_processed"),
      rows: resultRows,
    });
  } catch (e) {
    console.error("fifty-two-week-highs error:", e);
    return json({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});
