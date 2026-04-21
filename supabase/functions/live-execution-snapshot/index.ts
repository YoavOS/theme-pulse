// Live Execution snapshot — pulls a real-time quote + options chain from Yahoo Finance
// (free, no API key) and computes beginner-friendly summary metrics.
//
// Returns:
//   quote: { price, changePct, dayHigh, dayLow, volume, avgVolume }
//   options: { put_call_ratio, total_call_volume, total_put_volume,
//              avg_iv, sentiment, unusual_activity, expiration }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface QuoteSnapshot {
  symbol: string;
  price: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  shortName: string | null;
}

interface OptionsSnapshot {
  available: boolean;
  expiration: string | null;
  total_call_volume: number;
  total_put_volume: number;
  total_call_oi: number;
  total_put_oi: number;
  put_call_ratio: number | null;
  avg_iv: number | null;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  sentiment_explanation: string;
  unusual_activity: string[];
  high_iv_alert: boolean;
  iv_explanation: string;
}

async function fetchYahooQuote(symbol: string): Promise<QuoteSnapshot | null> {
  // Use the chart endpoint — no crumb cookie required, includes meta with live price.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const changePct = price !== null && prevClose && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null;
    return {
      symbol: meta.symbol ?? symbol,
      price,
      changePct,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      volume: meta.regularMarketVolume ?? null,
      avgVolume: meta.averageDailyVolume3Month ?? meta.averageDailyVolume10Day ?? null,
      marketCap: null,
      shortName: meta.shortName ?? meta.longName ?? null,
    };
  } catch {
    return null;
  }
}

// Cache the Yahoo (cookie, crumb) pair across invocations within the same warm container.
let cachedAuth: { cookie: string; crumb: string; ts: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000; // 30 min

async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedAuth && Date.now() - cachedAuth.ts < AUTH_TTL_MS) {
    return { cookie: cachedAuth.cookie, crumb: cachedAuth.crumb };
  }
  try {
    // Step 1: hit fc.yahoo.com to get the A3 consent cookie
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "manual",
    });
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";
    const a3Match = setCookie.match(/A3=([^;]+)/);
    if (!a3Match) return null;
    const cookie = `A3=${a3Match[1]}`;

    // Step 2: exchange the cookie for a crumb
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return null;

    cachedAuth = { cookie, crumb, ts: Date.now() };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function fetchYahooOptions(symbol: string): Promise<OptionsSnapshot> {
  const empty: OptionsSnapshot = {
    available: false,
    expiration: null,
    total_call_volume: 0,
    total_put_volume: 0,
    total_call_oi: 0,
    total_put_oi: 0,
    put_call_ratio: null,
    avg_iv: null,
    sentiment: "Neutral",
    sentiment_explanation: "Options data not available for this ticker.",
    unusual_activity: [],
    high_iv_alert: false,
    iv_explanation: "",
  };

  const auth = await getYahooAuth();
  if (!auth) return empty;

  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      // crumb stale — clear cache and retry once
      cachedAuth = null;
      const fresh = await getYahooAuth();
      if (!fresh) return empty;
      const retryUrl = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(fresh.crumb)}`;
      const retry = await fetch(retryUrl, {
        headers: { "User-Agent": UA, Cookie: fresh.cookie, Accept: "application/json" },
      });
      if (!retry.ok) return empty;
      return parseOptionsResponse(await retry.json(), empty);
    }
    if (!res.ok) return empty;
    return parseOptionsResponse(await res.json(), empty);
  } catch {
    return empty;
  }
}

function parseOptionsResponse(json: any, empty: OptionsSnapshot): OptionsSnapshot {
  try {
    const result = json?.optionChain?.result?.[0];
    if (!result) return empty;
    const expirationTs: number | undefined = result.options?.[0]?.expirationDate;
    const calls: any[] = result.options?.[0]?.calls ?? [];
    const puts: any[] = result.options?.[0]?.puts ?? [];

    const totalCallVol = calls.reduce((s, c) => s + (c.volume ?? 0), 0);
    const totalPutVol = puts.reduce((s, p) => s + (p.volume ?? 0), 0);
    const totalCallOI = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0);
    const totalPutOI = puts.reduce((s, p) => s + (p.openInterest ?? 0), 0);

    const ivValues = [...calls, ...puts]
      .map((c) => c.impliedVolatility)
      .filter((v) => typeof v === "number" && v > 0 && v < 5);
    const avgIv =
      ivValues.length > 0 ? ivValues.reduce((s, v) => s + v, 0) / ivValues.length : null;

    const pcr = totalCallVol > 0 ? totalPutVol / totalCallVol : null;

    let sentiment: "Bullish" | "Bearish" | "Neutral" = "Neutral";
    let sentimentExp = "Calls and puts are roughly balanced — no strong directional bet.";
    if (pcr !== null) {
      if (pcr < 0.7) {
        sentiment = "Bullish";
        sentimentExp = "More traders are buying calls than puts — leaning optimistic.";
      } else if (pcr > 1.3) {
        sentiment = "Bearish";
        sentimentExp = "More traders are buying puts than calls — leaning cautious.";
      }
    }

    const unusualCalls = calls.filter(
      (c) => (c.volume ?? 0) > 500 && c.openInterest > 0 && (c.volume ?? 0) > 3 * c.openInterest,
    );
    const unusualPuts = puts.filter(
      (p) => (p.volume ?? 0) > 500 && p.openInterest > 0 && (p.volume ?? 0) > 3 * p.openInterest,
    );

    const unusual: string[] = [];
    if (unusualCalls.length > 0) {
      const top = unusualCalls.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
      unusual.push(
        `Large call buying detected at $${top.strike} strike (${(top.volume ?? 0).toLocaleString()} contracts vs ${(top.openInterest ?? 0).toLocaleString()} open interest).`,
      );
    }
    if (unusualPuts.length > 0) {
      const top = unusualPuts.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
      unusual.push(
        `Unusual put volume at $${top.strike} strike (${(top.volume ?? 0).toLocaleString()} contracts vs ${(top.openInterest ?? 0).toLocaleString()} open interest).`,
      );
    }

    const highIv = avgIv !== null && avgIv > 0.6;
    const ivExp =
      avgIv === null
        ? ""
        : highIv
        ? `High options premium today — traders expect big movement (avg IV ${(avgIv * 100).toFixed(0)}%).`
        : `Options premiums look normal (avg IV ${(avgIv * 100).toFixed(0)}%).`;

    return {
      available: true,
      expiration: expirationTs ? new Date(expirationTs * 1000).toISOString().slice(0, 10) : null,
      total_call_volume: totalCallVol,
      total_put_volume: totalPutVol,
      total_call_oi: totalCallOI,
      total_put_oi: totalPutOI,
      put_call_ratio: pcr !== null ? Math.round(pcr * 100) / 100 : null,
      avg_iv: avgIv !== null ? Math.round(avgIv * 10000) / 10000 : null,
      sentiment,
      sentiment_explanation: sentimentExp,
      unusual_activity: unusual,
      high_iv_alert: highIv,
      iv_explanation: ivExp,
    };
  } catch {
    return empty;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const rawSymbol = (body?.symbol ?? "").toString().trim().toUpperCase();
    if (!rawSymbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(rawSymbol)) {
      return new Response(JSON.stringify({ error: "Invalid symbol" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [quote, options] = await Promise.all([
      fetchYahooQuote(rawSymbol),
      fetchYahooOptions(rawSymbol),
    ]);

    if (!quote || quote.price === null) {
      return new Response(
        JSON.stringify({ error: `No live quote available for ${rawSymbol}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ symbol: rawSymbol, quote, options, fetchedAt: new Date().toISOString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("live-execution-snapshot error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
