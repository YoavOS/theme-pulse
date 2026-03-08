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
  today_vol_estimated?: boolean;   // true if today_vol is a proxy, not live
  vol_data_points?: number;        // how many EOD rows had volume data
  error?: string;
}

async function fetchVolumeForSymbol(symbol: string, sb: any): Promise<VolumeResult> {
  const result: VolumeResult = { symbol, today_vol: 0, avg_20d: 0, avg_10d: 0, avg_3m: 0, today_vol_estimated: false, vol_data_points: 0 };

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
      if (q && typeof q.v === 'number' && q.v > 0) {
        result.today_vol = q.v;
      }
    }
  } catch (e) {
    console.log(`Quote error for ${symbol}: ${e}`);
  }

  await delay(280);

  // 2. Fetch /stock/metric for volume averages
  try {
    const metricRes = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_KEY}`
    );
    if (metricRes.status === 429) {
      console.log(`Metric rate-limited for ${symbol}`);
      return result;
    }
    if (metricRes.ok) {
      const data = await metricRes.json();
      const m = data?.metric;
      if (m) {
        if (typeof m["10DayAverageTradingVolume"] === "number") {
          result.avg_10d = Math.round(m["10DayAverageTradingVolume"] * 1_000_000);
        }
        if (typeof m["3MonthAverageTradingVolume"] === "number") {
          result.avg_3m = Math.round(m["3MonthAverageTradingVolume"] * 1_000_000);
        }
        // Interpolate 20-day from 10-day and 3-month
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

  // 3. If today_vol is still 0 (weekend/after hours), try eod_prices fallback
  if (result.today_vol === 0) {
    try {
      const { data: recentEod } = await sb
        .from("eod_prices")
        .select("volume, date")
        .eq("symbol", symbol)
        .not("volume", "is", null)
        .gt("volume", 0)
        .order("date", { ascending: false })
        .limit(1);

      if (recentEod && recentEod.length > 0 && recentEod[0].volume > 0) {
        result.today_vol = recentEod[0].volume;
        result.today_vol_estimated = true;
        console.log(`${symbol}: using eod_prices volume from ${recentEod[0].date} = ${recentEod[0].volume}`);
      }
    } catch (e) {
      console.log(`EOD fallback error for ${symbol}: ${e}`);
    }
  }

  // 4. If still no today_vol, use avg_10d as proxy (recent daily average)
  if (result.today_vol === 0 && result.avg_10d > 0) {
    result.today_vol = result.avg_10d;
    result.today_vol_estimated = true;
  }

  // 5. Check how many EOD data points we have with volume for this symbol
  try {
    const { count } = await sb
      .from("eod_prices")
      .select("*", { count: "exact", head: true })
      .eq("symbol", symbol)
      .not("volume", "is", null)
      .gt("volume", 0);

    result.vol_data_points = count || 0;
  } catch (e) {
    // Non-critical, leave as 0
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
          today_vol_estimated: (c as any).today_vol_estimated ?? false,
          vol_data_points: (c as any).vol_data_points ?? 0,
        });
      }
    }

    const uncached = symbols.filter(s => !cachedMap.has(s));
    const results: VolumeResult[] = [...cachedMap.values()];

    // Fetch uncached symbols sequentially with rate limiting
    for (let i = 0; i < uncached.length; i++) {
      const vol = await fetchVolumeForSymbol(uncached[i], sb);

      if (vol.error === "rate_limited") {
        console.log(`Rate limited on ${uncached[i]}, waiting 60s...`);
        await delay(60000);
        const retry = await fetchVolumeForSymbol(uncached[i], sb);
        results.push(retry);
        if (!retry.error && (retry.avg_10d > 0 || retry.avg_3m > 0)) {
          await sb.from("ticker_volume_cache").upsert({
            symbol: retry.symbol, today_vol: retry.today_vol,
            avg_20d: retry.avg_20d, avg_10d: retry.avg_10d, avg_3m: retry.avg_3m,
            last_updated: new Date().toISOString(),
          }, { onConflict: "symbol" });
        }
      } else if (vol.avg_10d > 0 || vol.avg_3m > 0 || vol.today_vol > 0) {
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
        await delay(280);
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
