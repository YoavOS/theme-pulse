// Volume data fetcher — uses Yahoo Finance via shared yahooHistory helper.
// Computes:
//   today_vol  = most recent daily volume (last bar of 3mo window)
//   avg_10d    = mean of last 10 daily volumes
//   avg_20d    = mean of last 20 daily volumes  (TRUE 20-day, not interpolated)
//   avg_3m     = mean of last ~63 daily volumes (entire 3mo window)
//
// Definitions:
//   Avg Rel Vol  = today_vol / avg_20d
//   Sustained    = (avg_10d / avg_3m - 1) * 100
//
// 4-hour cache via ticker_volume_cache.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHistoricalData } from "../_shared/yahooHistory.ts";

const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h

interface VolumeResult {
  symbol: string;
  today_vol: number;
  avg_20d: number;
  avg_10d: number;
  avg_3m: number;
  today_vol_estimated?: boolean;
  vol_data_points?: number;
  error?: string;
}

function meanVolume(volumes: (number | null)[]): number {
  const valid = volumes.filter((v): v is number => typeof v === "number" && v > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function fetchVolumeForSymbol(symbol: string, sb: any): Promise<VolumeResult> {
  const result: VolumeResult = {
    symbol, today_vol: 0, avg_20d: 0, avg_10d: 0, avg_3m: 0,
    today_vol_estimated: false, vol_data_points: 0,
  };

  // Pull 3-month daily OHLC from Yahoo (cached for 24h by helper).
  const hist = await getHistoricalData(sb, symbol, "3mo", { skipEod: true });
  if (!hist || hist.ohlc.length === 0) {
    return { ...result, error: "no_data" };
  }

  // Volume series, oldest -> newest
  const vols = hist.ohlc.map(b => b.volume);
  const validCount = vols.filter(v => typeof v === "number" && v > 0).length;
  result.vol_data_points = validCount;

  if (validCount === 0) return { ...result, error: "no_volume" };

  // today_vol = last bar with positive volume
  for (let i = vols.length - 1; i >= 0; i--) {
    const v = vols[i];
    if (typeof v === "number" && v > 0) {
      result.today_vol = v;
      // If the last bar is older than 1 trading day, mark as estimated
      const lastTs = hist.ohlc[i].ts;
      const ageMs = Date.now() - lastTs * 1000;
      if (ageMs > 36 * 60 * 60 * 1000) result.today_vol_estimated = true;
      break;
    }
  }

  // Sliding window means (excluding today_vol from the window so today vs avg is meaningful).
  // Actually: standard convention is that "20-day avg" includes today. We follow that.
  result.avg_10d = meanVolume(vols.slice(-10));
  result.avg_20d = meanVolume(vols.slice(-20));
  result.avg_3m  = meanVolume(vols);

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols");
    const forceRefresh = url.searchParams.get("refresh") === "1";

    if (!symbolsParam) {
      return new Response(JSON.stringify({ error: "Missing symbols param" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ error: "Empty symbols" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cachedMap = new Map<string, VolumeResult>();
    if (!forceRefresh) {
      const cutoff = new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString();
      const { data: cached } = await sb
        .from("ticker_volume_cache").select("*")
        .in("symbol", symbols).gte("last_updated", cutoff);
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
    }

    const uncached = symbols.filter(s => !cachedMap.has(s));
    const results: VolumeResult[] = [...cachedMap.values()];

    // Fetch in parallel batches of 5 (Yahoo can handle this comfortably)
    const BATCH = 5;
    for (let i = 0; i < uncached.length; i += BATCH) {
      const slice = uncached.slice(i, i + BATCH);
      const settled = await Promise.all(slice.map(s => fetchVolumeForSymbol(s, sb)));
      for (const vol of settled) {
        results.push(vol);
        if (!vol.error && (vol.avg_10d > 0 || vol.avg_3m > 0 || vol.today_vol > 0)) {
          await sb.from("ticker_volume_cache").upsert({
            symbol: vol.symbol,
            today_vol: vol.today_vol,
            avg_20d: vol.avg_20d,
            avg_10d: vol.avg_10d,
            avg_3m: vol.avg_3m,
            last_updated: new Date().toISOString(),
          }, { onConflict: "symbol" });
        }
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-volume error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
