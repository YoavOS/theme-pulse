const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const TICKERS_PER_CHUNK = 12; // tickers per edge function invocation
const CALL_DELAY_MS = 200; // 200ms between API calls ≈ 5 calls/sec (safe for 30/sec limit)
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTimestampsFromCandles(
  timestamps: number[],
  opens: number[],
  closes: number[],
  daysAgo: number
): { firstOpen: number; lastClose: number } | null {
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86400;
  let startIdx = -1;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= cutoff) { startIdx = i; break; }
  }
  if (startIdx === -1 || timestamps.length === 0) return null;
  return { firstOpen: opens[startIdx], lastClose: closes[closes.length - 1] };
}

function calcPct(firstOpen: number, lastClose: number): number {
  if (firstOpen === 0) return 0;
  return Math.round(((lastClose - firstOpen) / firstOpen) * 10000) / 100;
}

async function fetchTickerData(symbol: string): Promise<{
  perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number; perf_ytd: number; price: number; error?: string;
}> {
  const result = { perf_1d: 0, perf_1w: 0, perf_1m: 0, perf_3m: 0, perf_ytd: 0, price: 0 };

  // 1. Fetch daily quote
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

  await delay(CALL_DELAY_MS);

  // 2. Fetch YTD candles (longest range — derive 1W, 1M, 3M from same data)
  const jan1 = new Date(new Date().getFullYear(), 0, 1);
  const fromTs = Math.floor(jan1.getTime() / 1000);
  const toTs = Math.floor(Date.now() / 1000);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${FINNHUB_KEY}`
      );
      if (res.status === 429) {
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
        // Keep daily data, skip historical
        return { ...result, error: "rate_limited_candle" };
      }
      if (!res.ok) return { ...result, error: `candle_http_${res.status}` };
      const data = await res.json();
      if (!data || data.s === "no_data" || !data.o || !data.c || data.t?.length === 0) {
        // No candle data — keep daily, historical stays 0
        break;
      }

      const t = data.t as number[];
      const o = data.o as number[];
      const c = data.c as number[];

      // YTD: first open vs last close
      if (o.length > 0) result.perf_ytd = calcPct(o[0], c[c.length - 1]);

      // 3M
      const d3m = getTimestampsFromCandles(t, o, c, 90);
      if (d3m) result.perf_3m = calcPct(d3m.firstOpen, d3m.lastClose);

      // 1M
      const d1m = getTimestampsFromCandles(t, o, c, 30);
      if (d1m) result.perf_1m = calcPct(d1m.firstOpen, d1m.lastClose);

      // 1W
      const d1w = getTimestampsFromCandles(t, o, c, 7);
      if (d1w) result.perf_1w = calcPct(d1w.firstOpen, d1w.lastClose);

      break;
    } catch (e) {
      if (attempt >= MAX_RETRIES) return { ...result, error: `candle_error: ${e}` };
      await delay(5000);
    }
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
      console.log(`START: populating ${uniqueSymbols.length} unique symbols`);

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
        const data = await fetchTickerData(symbol);

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
