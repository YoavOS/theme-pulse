const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHistoricalData } from "../_shared/yahooHistory.ts";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const TICKERS_PER_CHUNK = 12; // tickers per edge function invocation
const CALL_DELAY_MS = 1100; // 1100ms between API calls ≈ 1 call/sec (safe for 60/min free tier)
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function calcPct(start: number, end: number): number {
  if (start === 0) return 0;
  return Math.round(((end - start) / start) * 10000) / 100;
}

// Find the close price N days ago in an OHLC array (closest bar at or before cutoff).
function closeNDaysAgo(ohlc: { ts: number; close: number | null }[], daysAgo: number): number | null {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86400;
  // Walk backward to find the last bar with ts <= cutoff
  for (let i = ohlc.length - 1; i >= 0; i--) {
    if (ohlc[i].ts <= cutoff && ohlc[i].close !== null) return ohlc[i].close as number;
  }
  return null;
}

async function fetchYahooQuote(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice);
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (!price || !prevClose) return null;
    return { price, prevClose };
  } catch { return null; }
}

async function fetchTickerData(
  sb: ReturnType<typeof createClient>,
  symbol: string
): Promise<{
  perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number; perf_ytd: number; price: number; error?: string;
}> {
  const result = { perf_1d: 0, perf_1w: 0, perf_1m: 0, perf_3m: 0, perf_ytd: 0, price: 0 };

  // 1. Live quote — Yahoo first, Finnhub fallback.
  const yq = await fetchYahooQuote(symbol);
  if (yq) {
    result.price = yq.price;
    result.perf_1d = Math.round(((yq.price - yq.prevClose) / yq.prevClose) * 10000) / 100;
  } else {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`);
        if (res.status === 429) {
          if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
          return { ...result, error: "rate_limited_quote" };
        }
        if (!res.ok) return { ...result, error: `http_${res.status}` };
        const data = await res.json();
        if (!data || (data.c === 0 && data.pc === 0)) return { ...result, error: "no_data" };
        result.perf_1d = Math.round((data.dp ?? ((data.c - data.pc) / data.pc) * 100) * 100) / 100;
        result.price = data.c;
        break;
      } catch (e) {
        if (attempt >= MAX_RETRIES) return { ...result, error: String(e) };
        await delay(5000);
      }
    }
  }

  // 2. Historical (1W/1M/3M/YTD) via Yahoo (cache → Yahoo).
  try {
    const hist = await getHistoricalData(sb, symbol, "ytd", {
      todayPrice: result.price,
      skipCache: true,
      skipEod: true,
    });
    if (hist.ohlc && hist.ohlc.length > 1) {
      const ohlc = hist.ohlc;
      const lastClose = (ohlc[ohlc.length - 1].close as number) ?? result.price;
      const firstClose = ohlc[0].close as number;
      if (firstClose) result.perf_ytd = calcPct(firstClose, lastClose);
      const c3m = closeNDaysAgo(ohlc, 90);
      if (c3m) result.perf_3m = calcPct(c3m, lastClose);
      const c1m = closeNDaysAgo(ohlc, 30);
      if (c1m) result.perf_1m = calcPct(c1m, lastClose);
      const c1w = closeNDaysAgo(ohlc, 7);
      if (c1w) result.perf_1w = calcPct(c1w, lastClose);
    } else if (hist.returnPct !== null) {
      result.perf_ytd = hist.returnPct;
    } else {
      console.log(`No historical data for ${symbol} (source=${hist.source})`);
    }
  } catch (e) {
    console.log(`Historical fetch failed for ${symbol}: ${e}`);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // --- STATUS: Return scan progress ---
    if (action === "status") {
      const { count: totalCount } = await sb.from("ticker_performance").select("*", { count: "exact", head: true });
      const { count: doneCount } = await sb.from("ticker_performance").select("*", { count: "exact", head: true }).eq("status", "done");
      const { count: failedCount } = await sb.from("ticker_performance").select("*", { count: "exact", head: true }).eq("status", "failed");
      const { count: pendingCount } = await sb.from("ticker_performance").select("*", { count: "exact", head: true }).eq("status", "pending");

      // Get theme count from themes table
      const { data: themes } = await sb.from("themes").select("id");
      const themeCount = themes?.length || 0;

      return new Response(JSON.stringify({
        total: totalCount || 0,
        done: doneCount || 0,
        failed: failedCount || 0,
        pending: pendingCount || 0,
        themes: themeCount,
        scanning: (pendingCount || 0) > 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- RESET: Clear all scan data ---
    if (action === "reset") {
      await sb.from("ticker_performance").delete().neq("symbol", "");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- RESULTS: Return all completed ticker data (for dashboard) ---
    if (action === "results") {
      const { data: allPerf } = await sb.from("ticker_performance").select("*").eq("status", "done");
      return new Response(JSON.stringify({ tickers: allPerf || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- START: Populate ticker_performance with all unique symbols, reset to pending ---
    if (action === "start") {
      const { data: dbTickers } = await sb.from("theme_tickers").select("ticker_symbol");
      if (!dbTickers) throw new Error("Failed to read tickers");

      const uniqueSymbols = [...new Set(dbTickers.map(t => t.ticker_symbol))];
      
      // Always include SPY as benchmark
      if (!uniqueSymbols.includes("SPY")) uniqueSymbols.push("SPY");
      
      console.log(`START: populating ${uniqueSymbols.length} unique symbols (including SPY benchmark)`);

      // Clear existing
      await sb.from("ticker_performance").delete().neq("symbol", "");

      // Insert all as pending (batch insert)
      const rows = uniqueSymbols.map(s => ({ symbol: s, status: "pending", perf_1d: 0, perf_1w: 0, perf_1m: 0, perf_3m: 0, perf_ytd: 0, price: 0 }));
      // Insert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        await sb.from("ticker_performance").insert(rows.slice(i, i + 50));
      }

      return new Response(JSON.stringify({ ok: true, total: uniqueSymbols.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- CHUNK: Process next batch of pending tickers ---
    if (action === "chunk") {
      const { data: pending } = await sb
        .from("ticker_performance")
        .select("symbol")
        .in("status", ["pending", "failed"])
        .order("symbol")
        .limit(TICKERS_PER_CHUNK);

      if (!pending || pending.length === 0) {
        return new Response(JSON.stringify({ done: true, processed: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`CHUNK: processing ${pending.length} tickers: ${pending.map(p => p.symbol).join(", ")}`);

      let processed = 0;
      let failed = 0;
      const results: { symbol: string; status: string }[] = [];

      // Process tickers SEQUENTIALLY — one at a time
      for (const { symbol } of pending) {
        const data = await fetchTickerData(sb, symbol);

        if (data.error) {
          console.log(`FAILED ${symbol}: ${data.error}`);
          await sb.from("ticker_performance").update({
            status: "failed",
            perf_1d: data.perf_1d,
            perf_1w: data.perf_1w,
            perf_1m: data.perf_1m,
            perf_3m: data.perf_3m,
            perf_ytd: data.perf_ytd,
            price: data.price,
            last_scanned: new Date().toISOString(),
          }).eq("symbol", symbol);
          failed++;
          results.push({ symbol, status: "failed" });
        } else {
          await sb.from("ticker_performance").update({
            status: "done",
            perf_1d: data.perf_1d,
            perf_1w: data.perf_1w,
            perf_1m: data.perf_1m,
            perf_3m: data.perf_3m,
            perf_ytd: data.perf_ytd,
            price: data.price,
            last_scanned: new Date().toISOString(),
          }).eq("symbol", symbol);
          processed++;
          results.push({ symbol, status: "done" });
          console.log(`OK ${symbol}: 1D=${data.perf_1d}% 1W=${data.perf_1w}% 1M=${data.perf_1m}% price=${data.price}`);
        }

        // Delay between tickers
        await delay(CALL_DELAY_MS);
      }

      // Check remaining
      const { count: remainingCount } = await sb.from("ticker_performance").select("*", { count: "exact", head: true }).in("status", ["pending"]);

      return new Response(JSON.stringify({
        done: (remainingCount || 0) === 0,
        processed,
        failed,
        remaining: remainingCount || 0,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Full scan error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
