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

async function fetchVolumeFromCandles(symbol: string): Promise<VolumeResult> {
  const result: VolumeResult = { symbol, today_vol: 0, avg_20d: 0, avg_10d: 0, avg_3m: 0 };

  const now = Math.floor(Date.now() / 1000);
  const from = now - 100 * 86400; // ~100 days back for 63 trading days

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${FINNHUB_KEY}`
    );

    if (res.status === 429) {
      return { ...result, error: "rate_limited" };
    }
    if (res.status === 403) {
      return { ...result, error: "unsupported" };
    }
    if (!res.ok) {
      return { ...result, error: `http_${res.status}` };
    }

    const data = await res.json();
    if (!data || data.s === "no_data" || !data.v || data.v.length === 0) {
      return { ...result, error: "no_data" };
    }

    const volumes = data.v as number[];
    const len = volumes.length;

    // Today's volume = last entry
    result.today_vol = volumes[len - 1] || 0;

    // 20-day average (last 20 entries excluding today)
    const last20 = volumes.slice(Math.max(0, len - 21), len - 1);
    if (last20.length > 0) {
      result.avg_20d = Math.round(last20.reduce((a, b) => a + b, 0) / last20.length);
    }

    // 10-day average (last 10 entries excluding today)
    const last10 = volumes.slice(Math.max(0, len - 11), len - 1);
    if (last10.length > 0) {
      result.avg_10d = Math.round(last10.reduce((a, b) => a + b, 0) / last10.length);
    }

    // 3-month average (~63 trading days, excluding today)
    const last63 = volumes.slice(Math.max(0, len - 64), len - 1);
    if (last63.length > 0) {
      result.avg_3m = Math.round(last63.reduce((a, b) => a + b, 0) / last63.length);
    }

    return result;
  } catch (e) {
    return { ...result, error: String(e) };
  }
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

    // Fetch uncached symbols sequentially with rate limiting (250ms = 4/sec)
    for (let i = 0; i < uncached.length; i++) {
      const vol = await fetchVolumeFromCandles(uncached[i]);

      if (vol.error === "rate_limited") {
        // Wait 60s then retry once
        console.log(`Rate limited on ${uncached[i]}, waiting 60s...`);
        await delay(60000);
        const retry = await fetchVolumeFromCandles(uncached[i]);
        if (!retry.error) {
          results.push(retry);
          // Upsert to cache
          await sb.from("ticker_volume_cache").upsert({
            symbol: retry.symbol,
            today_vol: retry.today_vol,
            avg_20d: retry.avg_20d,
            avg_10d: retry.avg_10d,
            avg_3m: retry.avg_3m,
            last_updated: new Date().toISOString(),
          }, { onConflict: "symbol" });
        } else {
          results.push(retry);
        }
      } else if (!vol.error) {
        results.push(vol);
        await sb.from("ticker_volume_cache").upsert({
          symbol: vol.symbol,
          today_vol: vol.today_vol,
          avg_20d: vol.avg_20d,
          avg_10d: vol.avg_10d,
          avg_3m: vol.avg_3m,
          last_updated: new Date().toISOString(),
        }, { onConflict: "symbol" });
      } else {
        results.push(vol);
      }

      if (i < uncached.length - 1) {
        await delay(270); // ~4/sec
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
