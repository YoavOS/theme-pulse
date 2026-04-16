import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tunable constants
const BATCH_SIZE = 50;            // symbols per cron tick (~50/min => safely under 60/min Finnhub)
const FINNHUB_DELAY_MS = 1100;
const YAHOO_DELAY_MS = 500;
const ADR_LOOKBACK_DAYS = 14;

const FILTERS = {
  MIN_MARKET_CAP_M: 1000,         // $1B in millions (Finnhub units)
  MIN_PRICE: 6,
  MIN_DOLLAR_VOLUME: 10_000_000,  // $10M/day
  MIN_ADR_PCT: 3,                 // 3%
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchYahooOHLC(symbol: string): Promise<{ adrPct: number | null; source: string }> {
  // Get ~1 month of daily OHLC; we need ADR_LOOKBACK_DAYS trading days
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return { adrPct: null, source: "yahoo_fail" };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!quote) return { adrPct: null, source: "yahoo_fail" };

    const highs: number[] = quote.high || [];
    const lows: number[] = quote.low || [];
    const closes: number[] = quote.close || [];

    // Take last N valid days
    const daily: number[] = [];
    for (let i = highs.length - 1; i >= 0 && daily.length < ADR_LOOKBACK_DAYS; i--) {
      const h = highs[i], l = lows[i], c = closes[i];
      if (h != null && l != null && c != null && c > 0) {
        daily.push(((h - l) / c) * 100);
      }
    }
    if (daily.length < 5) return { adrPct: null, source: "yahoo_insufficient" };
    const avg = daily.reduce((s, v) => s + v, 0) / daily.length;
    return { adrPct: Math.round(avg * 100) / 100, source: "ohlc" };
  } catch (e) {
    console.error(`Yahoo OHLC error ${symbol}:`, e);
    return { adrPct: null, source: "yahoo_error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const supabase = createClient(SB_URL, SB_KEY);

    // 0. Recover symbols stuck in "processing" for >5 min (dead worker)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    await supabase
      .from("stock_scan_queue")
      .update({ status: "pending" })
      .eq("status", "processing")
      .lt("enqueued_at", fiveMinAgo);

    // 0b. Respect pause: if progress.status = 'paused', do nothing
    const { data: prog } = await supabase
      .from("rs_scan_progress")
      .select("status")
      .eq("id", 1)
      .maybeSingle();
    if (prog?.status === "paused") {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "scan paused" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Claim a batch of pending symbols
    const { data: pending } = await supabase
      .from("stock_scan_queue")
      .select("symbol")
      .eq("status", "pending")
      .limit(BATCH_SIZE);

    if (!pending || pending.length === 0) {
      // Mark progress complete if nothing left
      await supabase
        .from("rs_scan_progress")
        .update({ status: "complete", last_updated: new Date().toISOString() })
        .eq("id", 1);
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "queue empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claimedSymbols = pending.map((p) => p.symbol);
    await supabase
      .from("stock_scan_queue")
      .update({ status: "processing" })
      .in("symbol", claimedSymbols);

    let qualifiedCount = 0;
    let processedCount = 0;
    let failedCount = 0;

    for (const sym of claimedSymbols) {
      try {
        // --- Stage A: Finnhub quote (price) ---
        const quoteRes = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        if (quoteRes.status === 429) {
          // rate limited — release symbol back to pending
          await supabase
            .from("stock_scan_queue")
            .update({ status: "pending", attempts: (pending.find(p => p.symbol === sym) as any)?.attempts ?? 0 })
            .eq("symbol", sym);
          console.log("Rate limited, releasing remaining symbols");
          break;
        }
        const quote = await quoteRes.json();
        const price = quote?.c;
        await sleep(FINNHUB_DELAY_MS);

        if (!price || price < FILTERS.MIN_PRICE) {
          await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
          processedCount++;
          continue;
        }

        // --- Stage B: Finnhub profile (market cap, name, sector) ---
        const profRes = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        if (profRes.status === 429) {
          await supabase.from("stock_scan_queue").update({ status: "pending" }).eq("symbol", sym);
          break;
        }
        const prof = await profRes.json();
        const mcM = prof?.marketCapitalization; // in millions
        await sleep(FINNHUB_DELAY_MS);

        if (!mcM || mcM < FILTERS.MIN_MARKET_CAP_M) {
          await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
          processedCount++;
          continue;
        }

        // --- Stage C: Volume (use Finnhub basic financial /stock/metric) ---
        // Use 10-day avg volume from /stock/metric?metric=all
        const metRes = await fetch(
          `https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`
        );
        if (metRes.status === 429) {
          await supabase.from("stock_scan_queue").update({ status: "pending" }).eq("symbol", sym);
          break;
        }
        const met = await metRes.json();
        const avgVol10d = met?.metric?.["10DayAverageTradingVolume"]; // in millions of shares
        await sleep(FINNHUB_DELAY_MS);

        // avgVol10d is in millions of shares per Finnhub
        const sharesPerDay = avgVol10d ? avgVol10d * 1_000_000 : 0;
        const dollarVolume = sharesPerDay * price;

        if (!dollarVolume || dollarVolume < FILTERS.MIN_DOLLAR_VOLUME) {
          await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
          processedCount++;
          continue;
        }

        // --- Stage D: ADR% via Yahoo OHLC (only for survivors!) ---
        const { adrPct, source: adrSrc } = await fetchYahooOHLC(sym);
        await sleep(YAHOO_DELAY_MS);

        if (adrPct === null || adrPct < FILTERS.MIN_ADR_PCT) {
          await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
          processedCount++;
          continue;
        }

        // --- All filters passed: insert into qualified universe ---
        await supabase.from("qualified_rs_universe").upsert({
          symbol: sym,
          company_name: prof?.name || sym,
          sector: prof?.finnhubIndustry || null,
          market_cap: mcM,
          current_price: price,
          avg_dollar_volume: dollarVolume,
          adr_percent: adrPct,
          adr_source: adrSrc,
          qualified_at: new Date().toISOString(),
        }, { onConflict: "symbol" });

        await supabase.from("stock_scan_queue").update({ status: "done", processed_at: new Date().toISOString() }).eq("symbol", sym);
        qualifiedCount++;
        processedCount++;
      } catch (e) {
        console.error(`Error processing ${sym}:`, e);
        failedCount++;
        processedCount++;
        await supabase
          .from("stock_scan_queue")
          .update({ status: "failed", last_error: String(e), processed_at: new Date().toISOString() })
          .eq("symbol", sym);
      }
    }

    // Update progress tracker
    const { data: progRow } = await supabase.from("rs_scan_progress").select("*").eq("id", 1).maybeSingle();
    const newProcessed = (progRow?.processed ?? 0) + processedCount;
    const newQualified = (progRow?.qualified ?? 0) + qualifiedCount;
    const newFailed = (progRow?.failed ?? 0) + failedCount;

    // Check if queue empty after this batch
    const { count: remaining } = await supabase
      .from("stock_scan_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    // Preserve "paused" status if it was set during this run; otherwise mark running/complete.
    const newStatus =
      progRow?.status === "paused"
        ? "paused"
        : (remaining ?? 0) === 0
          ? "complete"
          : "running";

    await supabase
      .from("rs_scan_progress")
      .update({
        processed: newProcessed,
        qualified: newQualified,
        failed: newFailed,
        status: newStatus,
        last_updated: new Date().toISOString(),
      })
      .eq("id", 1);

    return new Response(
      JSON.stringify({
        ok: true,
        batch: claimedSymbols.length,
        processed: processedCount,
        qualified: qualifiedCount,
        failed: failedCount,
        remaining_pending: remaining,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-universe-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
