import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CALL_DELAY_MS = 1100;
const CACHE_TTL_HOURS = 24;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function computeScores(m: any) {
  const revenueGrowth1y = m.revenue_growth_1y ?? 0;
  const revenueGrowth3y = m.revenue_growth_3y ?? 0;
  const epsGrowth1y = m.eps_growth_1y ?? 0;
  const netMargin = m.net_margin ?? 0;
  const grossMargin = m.gross_margin ?? 0;
  const roe = m.roe ?? 0;
  const currentRatio = m.current_ratio ?? 0;
  const debtToEquity = m.debt_to_equity ?? null;
  const freeCashFlow = m.free_cash_flow ?? 0;
  const analystRating = m.analyst_rating || "Hold";
  const targetMean = m.target_mean ?? 0;
  const price = m.price ?? 0;

  // Growth Score (0-25)
  const growthScore =
    (revenueGrowth1y > 20 ? 10 : revenueGrowth1y > 10 ? 7 : revenueGrowth1y > 0 ? 4 : 0) +
    (epsGrowth1y > 20 ? 10 : epsGrowth1y > 10 ? 7 : epsGrowth1y > 0 ? 4 : 0) +
    (revenueGrowth3y > 15 ? 5 : revenueGrowth3y > 5 ? 3 : 0);

  // Profitability Score (0-25)
  const profitScore =
    (netMargin > 20 ? 10 : netMargin > 10 ? 7 : netMargin > 0 ? 4 : 0) +
    (roe > 20 ? 10 : roe > 10 ? 7 : roe > 0 ? 4 : 0) +
    (grossMargin > 50 ? 5 : grossMargin > 30 ? 3 : 0);

  // Financial Health Score (0-25)
  const healthScore =
    (currentRatio > 2 ? 10 : currentRatio > 1 ? 7 : 0) +
    (debtToEquity === null ? 5 : debtToEquity < 0.5 ? 10 : debtToEquity < 1 ? 7 : debtToEquity < 2 ? 4 : 0) +
    (freeCashFlow > 0 ? 5 : 0);

  // Analyst Score (0-25)
  const upsidePct = price > 0 && targetMean > 0 ? ((targetMean - price) / price) * 100 : 0;
  const analystScore =
    (analystRating === "Strong Buy" ? 20 : analystRating === "Buy" ? 15 :
     analystRating === "Hold" ? 10 : analystRating === "Sell" ? 3 : 8) +
    (upsidePct > 20 ? 5 : upsidePct > 10 ? 3 : 0);

  const fundamentalScore = Math.min(100, Math.max(0, growthScore + profitScore + healthScore + analystScore));

  // Stock Type
  const stockType =
    revenueGrowth1y > 20 && netMargin < 10 ? "growth" :
    revenueGrowth1y < 5 && netMargin > 15 && roe > 15 ? "value" :
    revenueGrowth1y > 10 && netMargin > 10 ? "blend" :
    revenueGrowth1y < 0 || netMargin < 0 ? "speculative" :
    "blend";

  return { fundamentalScore, stockType, growthScore, profitScore, healthScore, analystScore };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!FINNHUB_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "config_error", message: "Missing required secrets" }, 500);
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON" }, 400);
    }

    const { symbols } = payload;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return jsonResponse({ error: "bad_request", message: "symbols array required" }, 400);
    }

    // Check cache first
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const { data: cached } = await sb
      .from("fundamentals_cache")
      .select("*")
      .in("symbol", symbols)
      .gte("last_updated", cutoff);

    const cachedMap: Record<string, any> = {};
    const cachedSymbols = new Set<string>();
    if (cached) {
      for (const row of cached) {
        cachedMap[row.symbol] = row;
        cachedSymbols.add(row.symbol);
      }
    }

    const toFetch = symbols.filter((s: string) => !cachedSymbols.has(s));
    console.log(`Fundamentals: ${cachedSymbols.size} cached, ${toFetch.length} to fetch`);

    const results: Record<string, any> = { ...cachedMap };

    for (let i = 0; i < toFetch.length; i++) {
      const symbol = toFetch[i];
      if (i > 0) await sleep(CALL_DELAY_MS);

      try {
        const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`;
        const resp = await fetch(url);

        if (resp.status === 429) {
          console.warn(`Rate limited at ${symbol}, pausing 60s`);
          await sleep(60000);
          i--; // retry
          continue;
        }

        if (!resp.ok) {
          console.warn(`Finnhub error for ${symbol}: ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const metric = data.metric || {};

        // Also fetch price for upside calc
        let price = 0;
        try {
          const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
          if (quoteResp.ok) {
            const quote = await quoteResp.json();
            price = quote.c || 0;
          }
          await sleep(CALL_DELAY_MS);
        } catch {}

        // Map Finnhub metric keys
        const row: any = {
          symbol,
          revenue_growth_1y: metric.revenueGrowthQuarterlyYoy ?? metric.revenueGrowthTTMYoy ?? null,
          revenue_growth_3y: metric.revenueGrowth3Y ?? null,
          eps_growth_1y: metric.epsGrowthQuarterlyYoy ?? metric.epsGrowthTTMYoy ?? null,
          eps_growth_3y: metric.epsGrowth3Y ?? null,
          gross_margin: metric.grossMarginTTM ?? metric.grossMarginAnnual ?? null,
          net_margin: metric.netProfitMarginTTM ?? metric.netProfitMarginAnnual ?? null,
          roe: metric.roeTTM ?? metric.roeRfy ?? null,
          roa: metric.roaTTM ?? metric.roaRfy ?? null,
          debt_to_equity: metric.totalDebtToEquityQuarterly ?? metric.totalDebtToEquityAnnual ?? null,
          current_ratio: metric.currentRatioQuarterly ?? metric.currentRatioAnnual ?? null,
          cash_per_share: metric.cashPerSharePerShareQuarterly ?? metric.cashPerSharePerShareAnnual ?? null,
          free_cash_flow: metric.freeCashFlowTTM ?? metric.freeCashFlowAnnual ?? null,
          target_high: metric.targetHigh ?? null,
          target_low: metric.targetLow ?? null,
          target_mean: metric.targetMean ?? null,
          analyst_rating: metric.recommendationMean != null
            ? (metric.recommendationMean <= 1.5 ? "Strong Buy" :
               metric.recommendationMean <= 2.5 ? "Buy" :
               metric.recommendationMean <= 3.5 ? "Hold" :
               metric.recommendationMean <= 4.5 ? "Sell" : "Strong Sell")
            : null,
          market_cap: metric.marketCapitalization ?? null,
          sector: null,
          price,
          last_updated: new Date().toISOString(),
        };

        const scores = computeScores({ ...row, price });
        row.fundamental_score = scores.fundamentalScore;
        row.stock_type = scores.stockType;

        // Remove price before upsert — not a column in fundamentals_cache
        const upsertRow = { ...row };
        delete upsertRow.price;

        // Upsert
        const { error: upsertErr } = await sb
          .from("fundamentals_cache")
          .upsert(upsertRow, { onConflict: "symbol" });

        if (upsertErr) {
          console.error(`Upsert error for ${symbol}:`, upsertErr);
        }

        results[symbol] = upsertRow;
      } catch (err) {
        console.error(`Error fetching fundamentals for ${symbol}:`, err);
      }
    }

    return jsonResponse({ fundamentals: results, fetched: toFetch.length, cached: cachedSymbols.size });
  } catch (e) {
    console.error("Unhandled error in fetch-fundamentals:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
