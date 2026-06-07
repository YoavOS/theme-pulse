// Volume edge function — Yahoo-only.
//
// Two shapes:
//   - Legacy:  ?symbols=A,B,C            → [{ symbol, today_vol, avg_20d, avg_10d, avg_3m, ... }]
//   - Smart:   ?period={today|1W|1M|3M}  → [{ symbol, rel_vol, vol_trend_pct, vol_consistency,
//                                             sustained_score, vol_sparkline, today_vol_estimated }]
//
// Both paths derive everything from a single Yahoo 6mo daily-OHLC pull per symbol
// and also persist today_vol/avg_20d/avg_10d/avg_3m into ticker_volume_cache.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CONCURRENCY = 20;

type Period = "today" | "1W" | "1M" | "3M" | null;

interface Bar { ts: number; close: number | null; volume: number | null; }

async function fetchYahoo6mo(symbol: string): Promise<Bar[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];
    const bars: Bar[] = ts.map((t, i) => ({ ts: t, close: closes[i] ?? null, volume: vols[i] ?? null }))
      .filter(b => b.close !== null);
    return bars;
  } catch { return null; }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function periodWindow(period: Period): number {
  switch (period) {
    case "1W": return 5;
    case "1M": return 20;
    case "3M": return 60;
    default:   return 20; // "today" uses a 20-day reference window for trend/consistency
  }
}

function periodBaseline(period: Period, avg10: number, avg20: number, avg3m: number): number {
  switch (period) {
    case "1W": return avg10;
    case "1M": return avg20;
    case "3M": return avg3m;
    default:   return avg20;
  }
}

async function computeForSymbol(
  sb: ReturnType<typeof createClient>,
  symbol: string,
  period: Period,
) {
  const bars = await fetchYahoo6mo(symbol);
  if (!bars || bars.length < 30) {
    return { symbol, error: "no_data" as const };
  }

  const vols = bars.map(b => b.volume ?? 0);
  const n = vols.length;
  const last = (k: number) => vols.slice(Math.max(0, n - k));
  const avg_10d = Math.round(avg(last(10)));
  const avg_20d = Math.round(avg(last(20)));
  const avg_30d = Math.round(avg(last(30)));
  const avg_3m  = Math.round(avg(last(60)));
  const avg_60d = avg_3m;

  // Today's volume — use the most recent bar; if 0 (weekend), use yesterday and flag estimated.
  let today_vol = vols[n - 1] ?? 0;
  let today_vol_estimated = false;
  if (!today_vol || today_vol <= 0) {
    today_vol = vols[n - 2] ?? 0;
    today_vol_estimated = true;
  }

  // Persist the legacy cache row (best-effort).
  try {
    await sb.from("ticker_volume_cache").upsert({
      symbol,
      today_vol,
      avg_20d,
      avg_10d,
      avg_3m,
      updated_at: new Date().toISOString(),
    }, { onConflict: "symbol" });
  } catch { /* non-fatal */ }

  if (!period) {
    return {
      symbol,
      today_vol,
      avg_20d,
      avg_10d,
      avg_3m,
      today_vol_estimated,
      vol_data_points: n,
    };
  }

  // Smart metrics — period-aware.
  const w = Math.min(periodWindow(period), n);
  const window = vols.slice(n - w);
  const baseline = periodBaseline(period, avg_10d, avg_20d, avg_3m);
  const rel_vol = baseline > 0 ? Math.round((today_vol / baseline) * 100) / 100 : null;

  // Vol Trend %: second half vs first half of the window.
  let vol_trend_pct: number | null = null;
  if (window.length >= 4) {
    const mid = Math.floor(window.length / 2);
    const first = avg(window.slice(0, mid));
    const second = avg(window.slice(mid));
    if (first > 0) {
      vol_trend_pct = Math.round(((second / first) - 1) * 1000) / 10;
    }
  }

  // Consistency: % of window days where volume > avg_60d.
  let vol_consistency: number | null = null;
  if (window.length > 0 && avg_60d > 0) {
    const above = window.filter(v => v > avg_60d).length;
    vol_consistency = Math.round((above / window.length) * 100);
  }

  // Sustained: (avg_10d / avg_30d) * (avg_20d / avg_60d).
  let sustained_score: number | null = null;
  if (avg_30d > 0 && avg_60d > 0) {
    sustained_score = Math.round(((avg_10d / avg_30d) * (avg_20d / avg_60d)) * 100) / 100;
  }

  // Last-30-day sparkline (oldest → newest).
  const vol_sparkline = vols.slice(Math.max(0, n - 30));

  return {
    symbol,
    rel_vol,
    vol_trend_pct,
    vol_consistency,
    sustained_score,
    vol_sparkline,
    today_vol_estimated,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const symbolsParam = url.searchParams.get("symbols") || "";
    const periodParam = url.searchParams.get("period");
    const period: Period =
      periodParam === "today" || periodParam === "1W" || periodParam === "1M" || periodParam === "3M"
        ? periodParam : null;

    const symbols = symbolsParam.split(",").map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: any[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < symbols.length) {
        const idx = cursor++;
        const r = await computeForSymbol(sb, symbols[idx], period);
        results.push(r);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, () => worker()));

    return new Response(JSON.stringify({ results, period, fetched_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-volume error:", e);
    return new Response(JSON.stringify({ error: String(e), results: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
