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

// Map a YahooPeriod → approximate cutoff date (for EOD lookup).
function periodCutoffDate(period: YahooPeriod): Date {
  const d = new Date();
  switch (period) {
    case "1d":  d.setDate(d.getDate() - 1); break;
    case "5d":  d.setDate(d.getDate() - 7); break;
    case "1mo": d.setDate(d.getDate() - 30); break;
    case "3mo": d.setDate(d.getDate() - 90); break;
    case "6mo": d.setDate(d.getDate() - 180); break;
    case "1y":  d.setFullYear(d.getFullYear() - 1); break;
    case "ytd": return new Date(new Date().getFullYear(), 0, 1);
  }
  return d;
}

// 1. Cache lookup
async function readCache(
  sb: SupabaseClient,
  symbol: string,
  period: YahooPeriod
): Promise<HistoricalResult | null> {
  const { data } = await sb
    .from("yahoo_history_cache")
    .select("symbol, period, return_pct, start_price, end_price, ohlc, data_points, fetched_at")
    .eq("symbol", symbol)
    .eq("period", period)
    .gte("fetched_at", new Date(Date.now() - CACHE_TTL_MS).toISOString())
    .maybeSingle();

  if (!data) return null;
  return {
    symbol,
    period,
    startPrice: data.start_price !== null ? Number(data.start_price) : null,
    endPrice: data.end_price !== null ? Number(data.end_price) : null,
    returnPct: data.return_pct !== null ? Number(data.return_pct) : null,
    ohlc: Array.isArray(data.ohlc) ? (data.ohlc as OHLCBar[]) : [],
    dataPoints: data.data_points ?? 0,
    source: "cache",
    fetchedAt: data.fetched_at,
  };
}

// 2. EOD lookup — returns return_pct only (not full OHLC).
//    Used for short, recent periods where we already have internal data.
async function readEod(
  sb: SupabaseClient,
  symbol: string,
  period: YahooPeriod,
  todayPrice: number | null
): Promise<HistoricalResult | null> {
  if (!todayPrice || todayPrice <= 0) return null;
  const cutoff = periodCutoffDate(period);
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
    symbol,
    period,
    startPrice: start,
    endPrice: todayPrice,
    returnPct: ret,
    ohlc: [],
    dataPoints: 1,
    source: "eod",
    fetchedAt: new Date().toISOString(),
  };
}

// 3. Yahoo network call
async function fetchFromYahoo(
  symbol: string,
  period: YahooPeriod
): Promise<HistoricalResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${period}&interval=1d&includePrePost=false`;
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
      ts: t,
      open: opens[i] ?? null,
      high: highs[i] ?? null,
      low: lows[i] ?? null,
      close: closes[i] ?? null,
      volume: vols[i] ?? null,
    })).filter((b) => b.close !== null);

    if (ohlc.length < 2) return null;
    const start = ohlc[0].close as number;
    const end = ohlc[ohlc.length - 1].close as number;
    if (start <= 0) return null;
    const ret = Math.round(((end - start) / start) * 10000) / 100;

    return {
      symbol,
      period,
      startPrice: start,
      endPrice: end,
      returnPct: ret,
      ohlc,
      dataPoints: ohlc.length,
      source: "yahoo",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function writeCache(sb: SupabaseClient, r: HistoricalResult) {
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
 * Order: cache → eod (if todayPrice given) → Yahoo.
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

  // 3. Yahoo
  await sleep(YAHOO_DELAY_MS);
  const fromYahoo = await fetchFromYahoo(symbol, period);
  if (fromYahoo) {
    await writeCache(sb, fromYahoo);
    return fromYahoo;
  }

  return {
    symbol,
    period,
    startPrice: null,
    endPrice: null,
    returnPct: null,
    ohlc: [],
    dataPoints: 0,
    source: "none",
    fetchedAt: new Date().toISOString(),
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
