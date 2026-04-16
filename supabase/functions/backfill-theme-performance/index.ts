// Backfill ticker_performance.perf_1w/1m/3m/ytd for ALL theme tickers + SPY
// using the shared Yahoo helper. This is what unblocks the Theme Intelligence
// tab (Momentum, Breadth, Trends, Heatmap, Volume Leaders, Insights) when
// EOD history is too short and Finnhub /candle is broken (403 free tier).
//
// POST /backfill-theme-performance  { offset?: number, limit?: number }
//   - If offset/limit omitted, processes all symbols in one go (chunked internally).
//   - Uses cache → eod → Yahoo via getHistoricalBatch.
//   - Preserves existing perf_1d & price (those come from Finnhub live quote).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHistoricalBatch, makeServiceClient, YahooPeriod } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PERIODS: { period: YahooPeriod; col: "perf_1w" | "perf_1m" | "perf_3m" | "perf_ytd" }[] = [
  { period: "5d",  col: "perf_1w" },
  { period: "1mo", col: "perf_1m" },
  { period: "3mo", col: "perf_3m" },
  { period: "ytd", col: "perf_ytd" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = makeServiceClient();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const offset = Number(body.offset ?? 0);
    const chunk = Number(body.limit ?? 40); // 40 symbols * 4 periods = 160 Yahoo calls/chunk

    // 1. Build target symbol list: distinct theme tickers + SPY
    const { data: ttRows, error: ttErr } = await sb
      .from("theme_tickers")
      .select("ticker_symbol");
    if (ttErr) throw ttErr;
    const allSymbols = [...new Set([
      ...(ttRows ?? []).map((r) => r.ticker_symbol).filter(Boolean),
      "SPY",
    ])].sort();

    const total = allSymbols.length;
    const slice = allSymbols.slice(offset, offset + chunk);
    if (slice.length === 0) {
      return new Response(
        JSON.stringify({ done: true, processed: offset, total }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Get current prices (perf_1d/price) so we can use them as todayPrice
    //    for the Yahoo helper's EOD fast-path.
    const { data: perfRows } = await sb
      .from("ticker_performance")
      .select("symbol, price, perf_1d")
      .in("symbol", slice);
    const priceMap: Record<string, number | null> = {};
    const perfMap = new Map<string, { price: number; perf_1d: number }>();
    for (const r of perfRows ?? []) {
      priceMap[r.symbol] = r.price ?? null;
      perfMap.set(r.symbol, { price: r.price ?? 0, perf_1d: r.perf_1d ?? 0 });
    }

    // 3. Fetch each period in parallel via shared helper
    const periodResults: Record<string, Record<string, number | null>> = {};
    for (const { period, col } of PERIODS) {
      const batch = await getHistoricalBatch(sb, slice, period, {
        todayPrices: priceMap,
        batchSize: 5,
      });
      const map: Record<string, number | null> = {};
      for (const sym of slice) map[sym] = batch[sym]?.returnPct ?? null;
      periodResults[col] = map;
    }

    // 4. Upsert each symbol
    let updated = 0;
    let skipped = 0;
    for (const sym of slice) {
      const existing = perfMap.get(sym);
      const row: Record<string, unknown> = {
        symbol: sym,
        perf_1w: periodResults.perf_1w[sym],
        perf_1m: periodResults.perf_1m[sym],
        perf_3m: periodResults.perf_3m[sym],
        perf_ytd: periodResults.perf_ytd[sym],
        last_scanned: new Date().toISOString(),
      };
      // Don't clobber price/perf_1d/status if we already have them
      if (existing) {
        row.price = existing.price;
        row.perf_1d = existing.perf_1d;
      } else {
        row.status = "pending"; // we don't have a quote, but populate timeframe data anyway
      }

      const allNull = row.perf_1w === null && row.perf_1m === null && row.perf_3m === null && row.perf_ytd === null;
      if (allNull) { skipped++; continue; }

      const { error: upErr } = await sb
        .from("ticker_performance")
        .upsert(row, { onConflict: "symbol" });
      if (!upErr) updated++;
    }

    const nextOffset = offset + slice.length;
    const done = nextOffset >= total;
    return new Response(
      JSON.stringify({
        done,
        processed: nextOffset,
        total,
        chunkUpdated: updated,
        chunkSkipped: skipped,
        next_offset: done ? null : nextOffset,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("backfill-theme-performance error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
