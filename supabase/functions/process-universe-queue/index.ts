import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tunable constants
const BATCH_SIZE = 25;            // claim size per inner loop
const FINNHUB_DELAY_MS = 1050;    // ~57 req/min, just under the 60/min cap
const YAHOO_DELAY_MS = 250;
const ADR_LOOKBACK_DAYS = 14;
// Run the worker as a long loop within a single invocation to avoid the
// 1-tick-per-minute cron throttle. Edge functions allow ~150s; leave headroom.
const TICK_DEADLINE_MS = 115_000;

const FILTERS = {
  MIN_MARKET_CAP_M: 1000,
  MIN_PRICE: 6,
  MIN_DOLLAR_VOLUME: 10_000_000,
  MIN_ADR_PCT: 3,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchYahooOHLC(symbol: string): Promise<{ adrPct: number | null; source: string }> {
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

  const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SB_URL, SB_KEY);

  // Helper: finalize this tick (recompute counters from DB; swap if done)
  async function finalize(extra: Record<string, unknown> = {}) {
    // Always recompute counters from authoritative DB state
    await supabase.rpc("recompute_rs_scan_progress");

    // Re-read to determine if scan is now complete
    const { data: prog } = await supabase
      .from("rs_scan_progress").select("status, processed, qualified, total_queued, failed")
      .eq("id", 1).maybeSingle();

    let swapped: number | null = null;
    if (prog?.status === "complete") {
      // Only swap if staging has rows (RPC raises otherwise — caught silently)
      try {
        const { data: c, error } = await supabase.rpc("swap_qualified_rs_universe");
        if (error) {
          if (!String(error.message || "").includes("refusing to swap")) {
            console.error("swap_qualified_rs_universe error:", error);
          }
        } else {
          swapped = Number(c ?? 0);
          console.log(`Swap complete: published ${swapped} symbols to live universe`);
        }
      } catch (e) { console.error("swap rpc threw:", e); }
      // Disable cron so it stops ticking
      try { await supabase.rpc("set_universe_cron_active", { p_active: false }); } catch (_) {}
    }

    return new Response(
      JSON.stringify({ ok: true, progress: prog, swapped, ...extra }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    // Advisory lock — only one tick runs at a time
    const { data: gotLock } = await supabase.rpc("try_universe_scan_lock");
    if (!gotLock) {
      return new Response(
        JSON.stringify({ ok: true, message: "another tick is running" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      // Recover symbols stuck in "processing" for >5 min (dead worker)
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      await supabase
        .from("stock_scan_queue")
        .update({ status: "pending" })
        .eq("status", "processing")
        .lt("enqueued_at", fiveMinAgo);

      // Respect pause
      const { data: prog } = await supabase
        .from("rs_scan_progress").select("status").eq("id", 1).maybeSingle();
      if (prog?.status === "paused") {
        return await finalize({ message: "scan paused" });
      }

      // Atomic claim
      const { data: claimed, error: claimErr } = await supabase.rpc("claim_scan_batch", { p_limit: BATCH_SIZE });
      if (claimErr) throw claimErr;
      const claimedSymbols: string[] = (claimed ?? []).map((r: any) => r.symbol);

      if (claimedSymbols.length === 0) {
        // Nothing to claim — finalize will mark complete if processing=0
        return await finalize({ message: "no pending symbols" });
      }

      for (const sym of claimedSymbols) {
        try {
          // Stage A: quote
          const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`);
          if (quoteRes.status === 429) {
            await supabase.from("stock_scan_queue").update({ status: "pending" }).eq("symbol", sym);
            console.log("Rate limited, releasing remaining symbols");
            // release any other claimed symbols not yet processed
            break;
          }
          const quote = await quoteRes.json();
          const price = quote?.c;
          await sleep(FINNHUB_DELAY_MS);

          if (!price || price < FILTERS.MIN_PRICE) {
            await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
            continue;
          }

          // Stage B: profile
          const profRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`);
          if (profRes.status === 429) {
            await supabase.from("stock_scan_queue").update({ status: "pending" }).eq("symbol", sym);
            break;
          }
          const prof = await profRes.json();
          const mcM = prof?.marketCapitalization;
          await sleep(FINNHUB_DELAY_MS);

          const exch = String(prof?.exchange ?? "").toUpperCase();
          const isOtc =
            /OTC|PINK|GREY|GRAY|OOTC|OTCBB|OTCMKTS|OTCPK/.test(exch) ||
            (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F"));
          if (isOtc) {
            await supabase.from("stock_scan_queue").update({ status: "skipped", last_error: `otc:${exch}`, processed_at: new Date().toISOString() }).eq("symbol", sym);
            continue;
          }
          if (!mcM || mcM < FILTERS.MIN_MARKET_CAP_M) {
            await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
            continue;
          }

          // Stage C: volume
          const metRes = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`);
          if (metRes.status === 429) {
            await supabase.from("stock_scan_queue").update({ status: "pending" }).eq("symbol", sym);
            break;
          }
          const met = await metRes.json();
          const avgVol10d = met?.metric?.["10DayAverageTradingVolume"];
          await sleep(FINNHUB_DELAY_MS);

          const sharesPerDay = avgVol10d ? avgVol10d * 1_000_000 : 0;
          const dollarVolume = sharesPerDay * price;
          if (!dollarVolume || dollarVolume < FILTERS.MIN_DOLLAR_VOLUME) {
            await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
            continue;
          }

          // Stage D: ADR
          const { adrPct, source: adrSrc } = await fetchYahooOHLC(sym);
          await sleep(YAHOO_DELAY_MS);
          if (adrPct === null || adrPct < FILTERS.MIN_ADR_PCT) {
            await supabase.from("stock_scan_queue").update({ status: "skipped", processed_at: new Date().toISOString() }).eq("symbol", sym);
            continue;
          }

          // Qualified → staging
          await supabase.from("qualified_rs_universe_staging").upsert({
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
        } catch (e) {
          console.error(`Error processing ${sym}:`, e);
          await supabase.from("stock_scan_queue")
            .update({ status: "failed", last_error: String(e), processed_at: new Date().toISOString() })
            .eq("symbol", sym);
        }
      }

      // Release any symbols still in "processing" from this claim (e.g., we broke out on 429)
      if (claimedSymbols.length > 0) {
        await supabase
          .from("stock_scan_queue")
          .update({ status: "pending" })
          .eq("status", "processing")
          .in("symbol", claimedSymbols);
      }

      return await finalize({ batch: claimedSymbols.length });
    } finally {
      try { await supabase.rpc("release_universe_scan_lock"); } catch (_) {}
    }
  } catch (err) {
    console.error("process-universe-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
