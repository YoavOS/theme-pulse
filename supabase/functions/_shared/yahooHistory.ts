// Shared Yahoo Finance historical-data helper for all edge functions.
// Order of operations:
//   1. yahoo_history_cache (24h TTL) — instant
//   2. eod_prices (when period is daily-resolvable) — instant, internal data
//   3. Yahoo Finance chart API — network call, then cached
//
// Yahoo is the default source for ALL historical / multi-timeframe data
// because Finnhub's free tier no longer returns /stock/candle (HTTP 403).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type YahooPeriod = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "ytd";

export interface OHLCBar {
  ts: number;       // unix seconds
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface HistoricalResult {
  symbol: string;
  period: YahooPeriod;
  startPrice: number | null;
  endPrice: number | null;
  returnPct: number | null;
  ohlc: OHLCBar[];
  dataPoints: number;
  source: "cache" | "eod" | "yahoo" | "none";
  fetchedAt: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const YAHOO_DELAY_MS = 400;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// (legacy periodCutoffDate removed — cutoffs now derive from periodCutoffSeconds below.)

// Period → seconds cutoff (used for slicing 6mo OHLC).
function periodCutoffSeconds(period: YahooPeriod): number {
  const now = Math.floor(Date.now() / 1000);
  switch (period) {
    case "1d":  return now - 1 * 86400;
    case "5d":  return now - 7 * 86400;
    case "1mo": return now - 30 * 86400;
    case "3mo": return now - 90 * 86400;
    case "6mo": return now - 180 * 86400;
    case "1y":  return now - 365 * 86400;
    case "ytd": return Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  }
}

// Cache helper: which row to read for a given requested period.
// We always persist a single "6mo" row per symbol and derive 1d/5d/1mo/3mo/ytd
// from it. "1y" still gets its own row because it needs a longer history.
function storagePeriodFor(p: YahooPeriod): YahooPeriod {
  return p === "1y" ? "1y" : "6mo";
}

function buildResultFromOhlc(symbol: string, period: YahooPeriod, ohlc: OHLCBar[], source: HistoricalResult["source"], fetchedAt: string): HistoricalResult {
  if (period === storagePeriodFor(period)) {
    // Full window — no slicing.
    const start = ohlc.find(b => b.close !== null)?.close ?? null;
    const end = [...ohlc].reverse().find(b => b.close !== null)?.close ?? null;
    const ret = start && end && start > 0 ? Math.round(((end - start) / start) * 10000) / 100 : null;
    return { symbol, period, startPrice: start, endPrice: end, returnPct: ret, ohlc, dataPoints: ohlc.length, source, fetchedAt };
  }
  const cutoff = periodCutoffSeconds(period);
  const slice = ohlc.filter(b => b.ts >= cutoff && b.close !== null);
  const start = slice[0]?.close ?? null;
  const end = slice[slice.length - 1]?.close ?? null;
  const ret = start && end && start > 0 ? Math.round(((end - start) / start) * 10000) / 100 : null;
  return { symbol, period, startPrice: start, endPrice: end, returnPct: ret, ohlc: slice, dataPoints: slice.length, source, fetchedAt };
}

// 1. Cache lookup — reads the canonical (6mo / 1y) row and slices for shorter requests.
async function readCache(
  sb: SupabaseClient,
  symbol: string,
  period: YahooPeriod
): Promise<HistoricalResult | null> {
  const storagePeriod = storagePeriodFor(period);
  const { data } = await sb
    .from("yahoo_history_cache")
    .select("ohlc, fetched_at")
    .eq("symbol", symbol)
    .eq("period", storagePeriod)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .maybeSingle();

  if (!data) return null;
  const ohlc = Array.isArray(data.ohlc) ? (data.ohlc as OHLCBar[]) : [];
  if (ohlc.length === 0) return null;
  return buildResultFromOhlc(symbol, period, ohlc, "cache", data.fetched_at);
}

// 2. EOD lookup — unchanged.
async function readEod(
  sb: SupabaseClient,
  symbol: string,
  period: YahooPeriod,
  todayPrice: number | null
): Promise<HistoricalResult | null> {
  if (!todayPrice || todayPrice <= 0) return null;
  const cutoff = new Date(periodCutoffSeconds(period) * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data: row } = await sb
    .from("eod_prices")
    .select("date, close_price")
    .eq("symbol", symbol)
    .lte("date", cutoffStr)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row || !row.close_price || Number(row.close_price) <= 0) return null;
  const start = Number(row.close_price);
  const ret = Math.round(((todayPrice - start) / start) * 10000) / 100;

  return {
    symbol, period, startPrice: start, endPrice: todayPrice, returnPct: ret,
    ohlc: [], dataPoints: 1, source: "eod", fetchedAt: new Date().toISOString(),
  };
}

// 3. Yahoo network call — always fetches the storage period (6mo / 1y), never the short period.
async function fetchFromYahoo(symbol: string, fetchPeriod: YahooPeriod): Promise<HistoricalResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${fetchPeriod}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = q.open ?? [];
    const highs: (number | null)[] = q.high ?? [];
    const lows: (number | null)[] = q.low ?? [];
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];

    const ohlc: OHLCBar[] = ts.map((t, i) => ({
      ts: t, open: opens[i] ?? null, high: highs[i] ?? null,
      low: lows[i] ?? null, close: closes[i] ?? null, volume: vols[i] ?? null,
    })).filter((b) => b.close !== null);

    if (ohlc.length < 2) return null;

    return buildResultFromOhlc(symbol, fetchPeriod, ohlc, "yahoo", new Date().toISOString());
  } catch {
    return null;
  }
}

async function writeCache(sb: SupabaseClient, r: HistoricalResult) {
  // Only persist the canonical storage period.
  if (r.period !== storagePeriodFor(r.period)) return;
  await sb.from("yahoo_history_cache").upsert(
    {
      symbol: r.symbol,
      period: r.period,
      return_pct: r.returnPct,
      start_price: r.startPrice,
      end_price: r.endPrice,
      ohlc: r.ohlc,
      data_points: r.dataPoints,
      fetched_at: r.fetchedAt,
    },
    { onConflict: "symbol,period" }
  );
}

/**
 * Get historical data for a symbol over a period.
 * Order: cache (canonical 6mo/1y, sliced) → eod → Yahoo (fetches 6mo/1y, caches, slices).
 */
export async function getHistoricalData(
  sb: SupabaseClient,
  symbol: string,
  period: YahooPeriod,
  opts: { todayPrice?: number | null; skipEod?: boolean; skipCache?: boolean } = {}
): Promise<HistoricalResult> {
  // 1. cache
  if (!opts.skipCache) {
    const cached = await readCache(sb, symbol, period);
    if (cached && cached.returnPct !== null) return cached;
  }

  // 2. EOD (only short periods where we likely have data)
  if (!opts.skipEod && (period === "1d" || period === "5d" || period === "1mo" || period === "3mo" || period === "ytd")) {
    const eod = await readEod(sb, symbol, period, opts.todayPrice ?? null);
    if (eod && eod.returnPct !== null) return eod;
  }

  // 3. Yahoo — always pull the canonical storage period, cache it, then derive the requested slice.
  await sleep(YAHOO_DELAY_MS);
  const storagePeriod = storagePeriodFor(period);
  const fromYahoo = await fetchFromYahoo(symbol, storagePeriod);
  if (fromYahoo) {
    await writeCache(sb, fromYahoo);
    if (storagePeriod === period) return fromYahoo;
    return buildResultFromOhlc(symbol, period, fromYahoo.ohlc, "yahoo", fromYahoo.fetchedAt);
  }

  return {
    symbol, period, startPrice: null, endPrice: null, returnPct: null,
    ohlc: [], dataPoints: 0, source: "none", fetchedAt: new Date().toISOString(),
  };
}


/**
 * Helper for "fetch many symbols in parallel with throttling".
 */
export async function getHistoricalBatch(
  sb: SupabaseClient,
  symbols: string[],
  period: YahooPeriod,
  opts: {
    batchSize?: number;
    todayPrices?: Record<string, number | null>;
    skipCache?: boolean;
    skipEod?: boolean;
  } = {}
): Promise<Record<string, HistoricalResult>> {
  const batchSize = opts.batchSize ?? 5;
  const out: Record<string, HistoricalResult> = {};
  for (let i = 0; i < symbols.length; i += batchSize) {
    const slice = symbols.slice(i, i + batchSize);
    const results = await Promise.all(
      slice.map((s) => getHistoricalData(sb, s, period, {
        todayPrice: opts.todayPrices?.[s] ?? null,
        skipCache: opts.skipCache,
        skipEod: opts.skipEod,
      }))
    );
    for (const r of results) out[r.symbol] = r;
  }
  return out;
}

export function makeServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
