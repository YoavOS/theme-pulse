const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface VolumeResult {
  symbol: string;
  today_vol: number;
  avg_20d: number;
  avg_10d: number;
  avg_3m: number;
  error?: string;
}

async function fetchVolumeForSymbol(symbol: string): Promise<VolumeResult> {
  const result: VolumeResult = { symbol, today_vol: 0, avg_20d: 0, avg_10d: 0, avg_3m: 0 };

  // 1. Fetch /quote for today's volume
  try {
    const quoteRes = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    if (quoteRes.status === 429) {
      return { ...result, error: "rate_limited" };
    }
    if (quoteRes.ok) {
      const q = await quoteRes.json();
      // Finnhub quote doesn't include volume directly in free tier
      // but some endpoints do - check if 'v' exists
      if (q && typeof q.v === 'number') {
        result.today_vol = q.v;
      }
    }
  } catch (e) {
    console.log(`Quote error for ${symbol}: ${e}`);
  }

  await delay(280); // rate limit: ~4/sec

  // 2. Fetch /stock/metric for volume averages
  try {
    const metricRes = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_KEY}`
    );
    if (metricRes.status === 429) {
      // Keep what we have from quote
      console.log(`Metric rate-limited for ${symbol}`);
      return result;
    }
    if (metricRes.ok) {
      const data = await metricRes.json();
      const m = data?.metric;
      if (m) {
        // 10DayAverageTradingVolume is in millions on Finnhub
        if (typeof m["10DayAverageTradingVolume"] === "number") {
          result.avg_10d = Math.round(m["10DayAverageTradingVolume"] * 1_000_000);
        }
        if (typeof m["3MonthAverageTradingVolume"] === "number") {
          result.avg_3m = Math.round(m["3MonthAverageTradingVolume"] * 1_000_000);
        }
        // Use 3-month as proxy for 20-day if we don't have a specific 20-day metric
        // Finnhub provides 10-day and 3-month; interpolate 20-day as avg of both
        if (result.avg_10d > 0 && result.avg_3m > 0) {
          result.avg_20d = Math.round((result.avg_10d + result.avg_3m) / 2);
        } else if (result.avg_10d > 0) {
          result.avg_20d = result.avg_10d;
        } else if (result.avg_3m > 0) {
          result.avg_20d = result.avg_3m;
        }
      }
    }
  } catch (e) {
    console.log(`Metric error for ${symbol}: ${e}`);
  }

  // If we got metric data but no today_vol from quote, estimate from averages
  if (result.today_vol === 0 && result.avg_10d > 0) {
    // Can't estimate today's vol - leave as 0, the frontend handles N/A
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
    const symbolsParam = url.searchParams.get("symbols");

    if (!symbolsParam) {
      return new Response(JSON.stringify({ error: "Missing symbols param" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ error: "Empty symbols" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check cache first
    const cutoff = new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString();
    const { data: cached } = await sb
      .from("ticker_volume_cache")
      .select("*")
      .in("symbol", symbols)
      .gte("last_updated", cutoff);

    const cachedMap = new Map<string, VolumeResult>();
    if (cached) {
      for (const c of cached) {
        cachedMap.set(c.symbol, {
          symbol: c.symbol,
          today_vol: c.today_vol || 0,
          avg_20d: c.avg_20d || 0,
          avg_10d: c.avg_10d || 0,
          avg_3m: c.avg_3m || 0,
        });
      }
    }

    const uncached = symbols.filter(s => !cachedMap.has(s));
    const results: VolumeResult[] = [...cachedMap.values()];

    // Fetch uncached symbols sequentially with rate limiting
    for (let i = 0; i < uncached.length; i++) {
      const vol = await fetchVolumeForSymbol(uncached[i]);

      if (vol.error === "rate_limited") {
        console.log(`Rate limited on ${uncached[i]}, waiting 60s...`);
        await delay(60000);
        const retry = await fetchVolumeForSymbol(uncached[i]);
        results.push(retry);
        if (!retry.error && (retry.avg_10d > 0 || retry.avg_3m > 0)) {
          await sb.from("ticker_volume_cache").upsert({
            symbol: retry.symbol, today_vol: retry.today_vol,
            avg_20d: retry.avg_20d, avg_10d: retry.avg_10d, avg_3m: retry.avg_3m,
            last_updated: new Date().toISOString(),
          }, { onConflict: "symbol" });
        }
      } else if (vol.avg_10d > 0 || vol.avg_3m > 0) {
        results.push(vol);
        await sb.from("ticker_volume_cache").upsert({
          symbol: vol.symbol, today_vol: vol.today_vol,
          avg_20d: vol.avg_20d, avg_10d: vol.avg_10d, avg_3m: vol.avg_3m,
          last_updated: new Date().toISOString(),
        }, { onConflict: "symbol" });
      } else {
        results.push(vol);
      }

      if (i < uncached.length - 1) {
        await delay(280); // ~4/sec between symbols (each symbol makes 2 calls internally)
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-volume error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
