const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getHistoricalData } from "../_shared/yahooHistory.ts";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const TICKERS_PER_CHUNK = 100; // tickers per edge function invocation (Yahoo-first → safe to parallelize)
const CONCURRENCY = 25;        // concurrent in-flight Yahoo requests
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 15000;

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
    // range=5d gives us several daily closes so we can derive the true
    // previous-trading-day close from the chart itself.
    // meta.chartPreviousClose is the close BEFORE the chart window starts
    // (i.e. ~5 trading days ago for range=5d) — DO NOT use that for 1D perf.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice);

    // Prefer the actual previous trading-day close from the chart bars.
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    const ts: number[] = r?.timestamp ?? [];
    let prevClose = NaN;
    // Walk from the end, skipping the current/most-recent bar that matches today's price.
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (c == null) continue;
      // skip the bar representing the current session
      if (Number.isFinite(price) && Math.abs(c - price) < 0.0001 && i === closes.length - 1) continue;
      prevClose = Number(c);
      break;
    }
    // Fallbacks: regularMarketPreviousClose / previousClose are the true prior close.
    if (!Number.isFinite(prevClose) || !prevClose) {
      prevClose = Number(meta.regularMarketPreviousClose ?? meta.previousClose);
    }
    if (!price || !prevClose || !Number.isFinite(prevClose)) return null;
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
      // Paginate: the API returns at most 1,000 rows per request.
      const allPerf: Record<string, unknown>[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("ticker_performance").select("*").eq("status", "done")
          .order("symbol").range(from, from + 999);
        if (error) throw error;
        if (!data?.length) break;
        allPerf.push(...data);
        if (data.length < 1000) break;
      }
      return new Response(JSON.stringify({ tickers: allPerf }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- START: Populate ticker_performance with all unique symbols, reset to pending ---
    if (action === "start") {
      const { data: dbTickers } = await sb.from("theme_tickers").select("ticker_symbol");
      if (!dbTickers) throw new Error("Failed to read tickers");

      // Also scan every stock in the qualified stock list, so the Dashboard's
      // Industry / Sub-Industry / Sector views get their own fresh numbers
      // (independent of RS Alpha's calculations). Only the symbol list is read.
      const universeSymbols: string[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("qualified_rs_universe").select("symbol").order("symbol").range(from, from + 999);
        if (error || !data?.length) break;
        universeSymbols.push(...data.map((r: { symbol: string }) => r.symbol));
        if (data.length < 1000) break;
      }

      const uniqueSymbols = [...new Set([
        ...dbTickers.map(t => t.ticker_symbol),
        ...universeSymbols,
      ].map(s => String(s).toUpperCase().trim()).filter(Boolean))];
      
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

      // Process tickers IN PARALLEL — Yahoo-first means we don't need the Finnhub 1/sec gate.
      // Fan out CONCURRENCY at a time.
      const pendingSymbols = pending.map(p => p.symbol);
      const inFlight: Promise<void>[] = [];
      let cursor = 0;

      const runOne = async (symbol: string) => {
        const data = await fetchTickerData(sb, symbol);
        const isFailed = !!data.error;
        await sb.from("ticker_performance").update({
          status: isFailed ? "failed" : "done",
          perf_1d: data.perf_1d,
          perf_1w: data.perf_1w,
          perf_1m: data.perf_1m,
          perf_3m: data.perf_3m,
          perf_ytd: data.perf_ytd,
          price: data.price,
          last_scanned: new Date().toISOString(),
        }).eq("symbol", symbol);
        if (isFailed) {
          failed++;
          results.push({ symbol, status: "failed" });
          console.log(`FAILED ${symbol}: ${data.error}`);
        } else {
          processed++;
          results.push({ symbol, status: "done" });
        }
      };

      const worker = async () => {
        while (cursor < pendingSymbols.length) {
          const idx = cursor++;
          await runOne(pendingSymbols[idx]);
        }
      };

      for (let i = 0; i < Math.min(CONCURRENCY, pendingSymbols.length); i++) {
        inFlight.push(worker());
      }
      await Promise.all(inFlight);

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
