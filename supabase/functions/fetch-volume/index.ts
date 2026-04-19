// Volume data fetcher — uses Yahoo Finance via shared yahooHistory helper.
//
// Pulls 6 months of daily OHLC and computes BOTH the legacy fields (today_vol,
// avg_10d, avg_20d, avg_3m) and the new "smart volume" metrics:
//   relVol           = today_vol / avg_for_period
//   volTrendPct      = % change of avg daily volume (first half vs second half of window)
//   volConsistency   = % of days in window where volume > avg_60d (long-term baseline)
//   sustainedScore   = (avg_10d / avg_30d) * (avg_20d / avg_60d)
//
// Period query param: today | 1W | 1M | 3M  (drives the window used for trend/consistency
// and which average is used as the rel-vol denominator).
//
// 4-hour cache via ticker_volume_cache for the legacy fields. Smart metrics are
// always computed live from the (cached 24h) Yahoo OHLC payload.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHistoricalData } from "../_shared/yahooHistory.ts";

const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4h

type Period = "today" | "1W" | "1M" | "3M";

interface VolumeResult {
  symbol: string;
  // legacy
  today_vol: number;
  avg_10d: number;
  avg_20d: number;
  avg_3m: number;
  today_vol_estimated?: boolean;
  vol_data_points?: number;
  // smart metrics (period-aware)
  rel_vol: number | null;        // today / avg-for-period
  vol_trend_pct: number | null;  // % change of avg daily volume across window
  vol_consistency: number | null;// % of days in window above avg_60d
  sustained_score: number | null;// (avg_10/avg_30)*(avg_20/avg_60)
  vol_sparkline: number[];       // last 30 daily volumes (raw, oldest→newest)
  error?: string;
}

function meanVolume(volumes: (number | null)[]): number {
  const valid = volumes.filter((v): v is number => typeof v === "number" && v > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function periodWindowDays(p: Period): number {
  if (p === "1W") return 5;
  if (p === "1M") return 21;
  if (p === "3M") return 63;
  return 1; // today
}

function periodAvgKey(p: Period): "avg_10d" | "avg_20d" | "avg_3m" {
  if (p === "1W") return "avg_10d";
  if (p === "1M") return "avg_20d";
  return "avg_3m"; // 3M and today
}

async function fetchVolumeForSymbol(symbol: string, sb: any, period: Period): Promise<VolumeResult> {
  const empty: VolumeResult = {
    symbol, today_vol: 0, avg_20d: 0, avg_10d: 0, avg_3m: 0,
    today_vol_estimated: false, vol_data_points: 0,
    rel_vol: null, vol_trend_pct: null, vol_consistency: null, sustained_score: null,
  };

  // Pull 6-month daily OHLC from Yahoo (cached for 24h by helper) — gives us
  // enough bars for a true 60-day baseline.
  const hist = await getHistoricalData(sb, symbol, "6mo", { skipEod: true });
  if (!hist || hist.ohlc.length === 0) return { ...empty, error: "no_data" };

  const vols = hist.ohlc.map(b => b.volume);
  const validCount = vols.filter(v => typeof v === "number" && v > 0).length;
  empty.vol_data_points = validCount;
  if (validCount === 0) return { ...empty, error: "no_volume" };

  const result: VolumeResult = { ...empty };

  // today_vol = last bar with positive volume
  for (let i = vols.length - 1; i >= 0; i--) {
    const v = vols[i];
    if (typeof v === "number" && v > 0) {
      result.today_vol = v;
      const lastTs = hist.ohlc[i].ts;
      if (Date.now() - lastTs * 1000 > 36 * 60 * 60 * 1000) result.today_vol_estimated = true;
      break;
    }
  }

  // Sliding window means
  result.avg_10d = meanVolume(vols.slice(-10));
  result.avg_20d = meanVolume(vols.slice(-20));
  const avg_30d = meanVolume(vols.slice(-30));
  const avg_60d = meanVolume(vols.slice(-60));
  result.avg_3m  = meanVolume(vols);

  // ── Smart metrics ──────────────────────────────────────────────
  // Rel Vol for the selected period
  const denomKey = periodAvgKey(period);
  const denom = denomKey === "avg_10d" ? result.avg_10d : denomKey === "avg_20d" ? result.avg_20d : result.avg_3m;
  result.rel_vol = denom > 0 && result.today_vol > 0
    ? Math.round((result.today_vol / denom) * 100) / 100
    : null;

  // Vol Trend % — split window in half, compare avg daily volume
  const win = periodWindowDays(period);
  const window = vols.slice(-Math.max(win, 4));
  if (window.length >= 4) {
    const mid = Math.floor(window.length / 2);
    const first = meanVolume(window.slice(0, mid));
    const second = meanVolume(window.slice(mid));
    if (first > 0) result.vol_trend_pct = Math.round(((second / first - 1) * 100) * 10) / 10;
  }

  // Vol Consistency — % of days in window with volume above 60d avg
  if (avg_60d > 0 && window.length > 0) {
    const above = window.filter(v => typeof v === "number" && v > avg_60d).length;
    result.vol_consistency = Math.round((above / window.length) * 100);
  }

  // Sustained Score — (avg_10/avg_30)*(avg_20/avg_60)
  if (avg_30d > 0 && avg_60d > 0 && result.avg_10d > 0 && result.avg_20d > 0) {
    const s = (result.avg_10d / avg_30d) * (result.avg_20d / avg_60d);
    result.sustained_score = Math.round(s * 100) / 100;
  }

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
    const periodRaw = (url.searchParams.get("period") || "today").toLowerCase();
    const period: Period =
      periodRaw === "1w" ? "1W" :
      periodRaw === "1m" ? "1M" :
      periodRaw === "3m" ? "3M" : "today";

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

    // Always compute smart metrics live from the cached OHLC (since they depend on `period`),
    // so we never short-circuit on the volume cache for those. The DB cache is still updated
    // for the legacy aggregated values used elsewhere.
    const results: VolumeResult[] = [];
    const BATCH = 5;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const slice = symbols.slice(i, i + BATCH);
      const settled = await Promise.all(slice.map(s => fetchVolumeForSymbol(s, sb, period)));
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

    return new Response(JSON.stringify({ results, period }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-volume error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
