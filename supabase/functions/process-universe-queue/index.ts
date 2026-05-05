import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// Speed strategy
// ------------------------------------------------------------
// Finnhub free tier = 60 calls/min. Previously we made 3 Finnhub
// calls per stock (quote+profile+metric) → ~20 stocks/min cap.
//
// New approach uses only ONE Finnhub call per stock (profile2),
// and gets price / avg-volume / ADR from Yahoo (no published cap).
// We also fetch Yahoo in parallel batches to maximize throughput.
//
// Target: ~55 stocks/min sustained, well under the 60/min limit.
// ============================================================

const BATCH_SIZE = 50;             // claim size per inner loop
const YAHOO_PARALLEL = 10;         // parallel Yahoo fetches
const FINNHUB_DELAY_MS = 1200;     // ~50 req/min — safe target under 60/min cap
const ADR_LOOKBACK_DAYS = 14;      // ~10 trading days of data
const TICK_DEADLINE_MS = 115_000;  // edge functions allow ~150s; leave headroom

const FILTERS = {
  MIN_MARKET_CAP_M: 1000,
  MIN_PRICE: 6,
  MIN_DOLLAR_VOLUME: 10_000_000,
  MIN_ADR_PCT: 3,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface YahooStats {
  price: number | null;
  avgVolume10d: number | null;
  adrPct: number | null;
  source: string;
}

async function fetchYahooStats(symbol: string): Promise<YahooStats> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_fail" };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const meta = result?.meta;
    if (!quote || !meta) return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_fail" };

    const price = meta.regularMarketPrice ?? null;
    const highs: number[] = quote.high || [];
    const lows: number[] = quote.low || [];
    const closes: number[] = quote.close || [];
    const vols: number[] = quote.volume || [];

    // ADR over last 14 valid bars
    const dailyAdr: number[] = [];
    for (let i = highs.length - 1; i >= 0 && dailyAdr.length < ADR_LOOKBACK_DAYS; i--) {
      const h = highs[i], l = lows[i], c = closes[i];
      if (h != null && l != null && c != null && c > 0) {
        dailyAdr.push(((h - l) / c) * 100);
      }
    }
    const adrPct = dailyAdr.length >= 5
      ? Math.round((dailyAdr.reduce((s, v) => s + v, 0) / dailyAdr.length) * 100) / 100
      : null;

    // 10-day avg volume from last 10 valid bars
    const recentVols: number[] = [];
    for (let i = vols.length - 1; i >= 0 && recentVols.length < 10; i--) {
      if (vols[i] != null && vols[i] > 0) recentVols.push(vols[i]);
    }
    const avgVolume10d = recentVols.length >= 5
      ? Math.round(recentVols.reduce((s, v) => s + v, 0) / recentVols.length)
      : null;

    return { price, avgVolume10d, adrPct, source: "yahoo" };
  } catch (e) {
    console.error(`Yahoo error ${symbol}:`, e);
    return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_error" };
  }
}

async function fetchYahooBatch(symbols: string[]): Promise<Record<string, YahooStats>> {
  const out: Record<string, YahooStats> = {};
  for (let i = 0; i < symbols.length; i += YAHOO_PARALLEL) {
    const slice = symbols.slice(i, i + YAHOO_PARALLEL);
    const results = await Promise.all(slice.map((s) => fetchYahooStats(s)));
    slice.forEach((s, idx) => { out[s] = results[idx]; });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SB_URL, SB_KEY);

  async function finalize(extra: Record<string, unknown> = {}) {
    await supabase.rpc("recompute_rs_scan_progress");
    const { data: prog } = await supabase
      .from("rs_scan_progress").select("status, processed, qualified, total_queued, failed")
      .eq("id", 1).maybeSingle();

    let swapped: number | null = null;
    if (prog?.status === "complete") {
      try {
        const { data: c, error } = await supabase.rpc("swap_qualified_rs_universe");
        if (error) {
          if (!String(error.message || "").includes("refusing to swap")) {
            console.error("swap_qualified_rs_universe error:", error);
          }
        } else {
          swapped = Number(c ?? 0);
          console.log(`Swap complete: published ${swapped} symbols to live universe`);
          // Kick off RS recalculation across the new universe (fire-and-forget loop)
          (async () => {
            try {
              let offset = 0;
              for (let i = 0; i < 500; i++) {
                const { data: rsData, error: rsErr } = await supabase.functions.invoke(
                  "calculate-rs-scores",
                  { body: { offset } },
                );
                if (rsErr) { console.error("calculate-rs-scores invoke error:", rsErr); break; }
                if (rsData?.done || rsData?.next_offset == null) {
                  console.log(`RS recalc complete: ${rsData?.processed}/${rsData?.total}`);
                  break;
                }
                offset = rsData.next_offset;
              }
            } catch (e) { console.error("RS recalc loop error:", e); }
          })();
        }
      } catch (e) { console.error("swap rpc threw:", e); }
      try { await supabase.rpc("set_universe_cron_active", { p_active: false }); } catch (_) {}
    }

    return new Response(
      JSON.stringify({ ok: true, progress: prog, swapped, ...extra }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const { data: gotLock } = await supabase.rpc("try_universe_scan_lock");
    if (!gotLock) {
      return new Response(
        JSON.stringify({ ok: true, message: "another tick is running" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      // Recover dead workers
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      await supabase.from("stock_scan_queue")
        .update({ status: "pending" })
        .eq("status", "processing")
        .lt("enqueued_at", fiveMinAgo);

      const { data: prog } = await supabase
        .from("rs_scan_progress").select("status").eq("id", 1).maybeSingle();
      if (prog?.status === "paused") {
        return await finalize({ message: "scan paused" });
      }

      const tickStart = Date.now();
      let totalProcessed = 0;
      let totalQualified = 0;
      let rateLimited = false;

      while (Date.now() - tickStart < TICK_DEADLINE_MS) {
        const { data: claimed, error: claimErr } = await supabase.rpc("claim_scan_batch", { p_limit: BATCH_SIZE });
        if (claimErr) throw claimErr;
        const claimedSymbols: string[] = (claimed ?? []).map((r: any) => r.symbol);
        if (claimedSymbols.length === 0) break;

        // ---- Stage 1: Yahoo in parallel for the whole batch ----
        const yahooMap = await fetchYahooBatch(claimedSymbols);

        // Pre-filter on Yahoo data so we only spend Finnhub calls on candidates
        const skipUpdates: string[] = [];
        const candidates: string[] = [];
        for (const sym of claimedSymbols) {
          const y = yahooMap[sym];
          if (!y || y.price == null || y.price < FILTERS.MIN_PRICE) { skipUpdates.push(sym); continue; }
          if (y.adrPct == null || y.adrPct < FILTERS.MIN_ADR_PCT) { skipUpdates.push(sym); continue; }
          if (y.avgVolume10d == null) { skipUpdates.push(sym); continue; }
          const dollarVol = y.avgVolume10d * y.price;
          if (dollarVol < FILTERS.MIN_DOLLAR_VOLUME) { skipUpdates.push(sym); continue; }
          candidates.push(sym);
        }

        if (skipUpdates.length) {
          await supabase.from("stock_scan_queue")
            .update({ status: "skipped", processed_at: new Date().toISOString() })
            .in("symbol", skipUpdates);
          totalProcessed += skipUpdates.length;
        }

        // ---- Stage 2: Finnhub profile2 for candidates only (1 call/stock) ----
        for (const sym of candidates) {
          if (Date.now() - tickStart >= TICK_DEADLINE_MS) {
            const remaining = candidates.slice(candidates.indexOf(sym));
            await supabase.from("stock_scan_queue")
              .update({ status: "pending" })
              .eq("status", "processing")
              .in("symbol", remaining);
            return await finalize({ batch: totalProcessed, qualified: totalQualified, message: "deadline" });
          }
          const y = yahooMap[sym];
          try {
            const profRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`);
            if (profRes.status === 429) { rateLimited = true; break; }
            const prof = await profRes.json();
            await sleep(FINNHUB_DELAY_MS);

            const exch = String(prof?.exchange ?? "").toUpperCase();
            const isOtc =
              /OTC|PINK|GREY|GRAY|OOTC|OTCBB|OTCMKTS|OTCPK/.test(exch) ||
              (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F"));
            const mcM = prof?.marketCapitalization;

            if (isOtc) {
              await supabase.from("stock_scan_queue")
                .update({ status: "skipped", last_error: `otc:${exch}`, processed_at: new Date().toISOString() })
                .eq("symbol", sym);
              totalProcessed++; continue;
            }
            if (!mcM || mcM < FILTERS.MIN_MARKET_CAP_M) {
              await supabase.from("stock_scan_queue")
                .update({ status: "skipped", processed_at: new Date().toISOString() })
                .eq("symbol", sym);
              totalProcessed++; continue;
            }

            const dollarVolume = (y.avgVolume10d as number) * (y.price as number);
            await supabase.from("qualified_rs_universe_staging").upsert({
              symbol: sym,
              company_name: prof?.name || sym,
              sector: prof?.finnhubIndustry || null,
              market_cap: mcM,
              current_price: y.price,
              avg_dollar_volume: dollarVolume,
              adr_percent: y.adrPct,
              adr_source: y.source,
              qualified_at: new Date().toISOString(),
            }, { onConflict: "symbol" });

            await supabase.from("stock_scan_queue")
              .update({ status: "done", processed_at: new Date().toISOString() })
              .eq("symbol", sym);
            totalProcessed++;
            totalQualified++;
          } catch (e) {
            console.error(`Error processing ${sym}:`, e);
            await supabase.from("stock_scan_queue")
              .update({ status: "failed", last_error: String(e), processed_at: new Date().toISOString() })
              .eq("symbol", sym);
            totalProcessed++;
          }
        }

        // Any leftover "processing" rows from this claim → release
        await supabase.from("stock_scan_queue")
          .update({ status: "pending" })
          .eq("status", "processing")
          .in("symbol", claimedSymbols);

        if (rateLimited) {
          console.log("Rate limited — pausing 60s");
          await sleep(60_000);
          rateLimited = false;
        }
      }

      return await finalize({ batch: totalProcessed, qualified: totalQualified });
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
