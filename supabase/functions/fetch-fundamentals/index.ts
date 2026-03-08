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

function computeValuation(pe: number | null, peg: number | null) {
  const peVal = pe ?? -1;
  const valuationRaw = peVal < 0 ? 0 : peVal < 15 ? 20 : peVal < 25 ? 15 : peVal < 40 ? 8 : peVal < 60 ? 3 : 0;
  const pegBonus = peg != null && peg > 0 ? (peg < 1 ? 8 : peg < 2 ? 4 : 0) : 0;
  const valuationScore = Math.min(20, valuationRaw + pegBonus);

  const valuationLabel =
    peVal < 0 ? "Not yet profitable" :
    peVal < 15 ? "Undervalued" :
    peVal < 25 ? "Fairly valued" :
    peVal < 40 ? "Premium valuation" :
    peVal < 60 ? "Expensive" :
    "Very expensive";

  return { valuationScore, valuationLabel };
}

function computeSmartMoney(instPct: number | null, instChange: number | null, avgMSPR: number | null, buys: number, sells: number) {
  // Institutional ownership score (0-40)
  const instScore = instPct == null ? 0 : instPct > 70 ? 40 : instPct > 50 ? 30 : instPct > 30 ? 20 : instPct > 10 ? 10 : 0;
  // Institutional change score (0-30)
  const instChangeScore = instChange == null ? 0 : instChange > 5 ? 30 : instChange > 0 ? 20 : instChange > -5 ? 10 : 0;

  // Insider score (0-30) — use MSPR if available, otherwise derive from buy/sell ratio
  let insiderScore = 0;
  if (avgMSPR != null) {
    insiderScore = avgMSPR > 0.5 ? 30 : avgMSPR > 0 ? 20 : avgMSPR > -0.5 ? 10 : 0;
  } else if (buys + sells > 0) {
    const buyRatio = buys / (buys + sells);
    insiderScore = buyRatio > 0.6 ? 30 : buyRatio > 0.4 ? 20 : buyRatio > 0.2 ? 10 : 0;
  }

  const smartMoneyScore = instScore + instChangeScore + insiderScore;
  const smartMoneyLabel =
    smartMoneyScore > 75 ? "Strong institutional backing" :
    smartMoneyScore > 50 ? "Good institutional interest" :
    smartMoneyScore > 25 ? "Moderate institutional presence" :
    "Low institutional backing";

  const insiderSentimentLabel =
    avgMSPR != null ? (
      avgMSPR > 0.5 ? "Strong net buying" :
      avgMSPR > 0 ? "Mild net buying" :
      avgMSPR > -0.5 ? "Mild net selling" :
      "Heavy net selling"
    ) : buys + sells > 0 ? (
      buys > sells ? "Net buying" :
      buys === sells ? "Neutral" :
      "Net selling"
    ) : "No data";

  return { smartMoneyScore, smartMoneyLabel, insiderSentimentLabel };
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
  const pe = m.pe_ratio ?? null;

  const growthScore =
    (revenueGrowth1y > 20 ? 10 : revenueGrowth1y > 10 ? 7 : revenueGrowth1y > 0 ? 4 : 0) +
    (epsGrowth1y > 20 ? 10 : epsGrowth1y > 10 ? 7 : epsGrowth1y > 0 ? 4 : 0) +
    (revenueGrowth3y > 15 ? 5 : revenueGrowth3y > 5 ? 3 : 0);

  const profitScore =
    (netMargin > 20 ? 10 : netMargin > 10 ? 7 : netMargin > 0 ? 4 : 0) +
    (roe > 20 ? 10 : roe > 10 ? 7 : roe > 0 ? 4 : 0) +
    (grossMargin > 50 ? 5 : grossMargin > 30 ? 3 : 0);

  const healthScore =
    (currentRatio > 2 ? 10 : currentRatio > 1 ? 7 : 0) +
    (debtToEquity === null ? 5 : debtToEquity < 0.5 ? 10 : debtToEquity < 1 ? 7 : debtToEquity < 2 ? 4 : 0) +
    (freeCashFlow > 0 ? 5 : 0);

  const upsidePct = price > 0 && targetMean > 0 ? ((targetMean - price) / price) * 100 : 0;
  const analystScore =
    (analystRating === "Strong Buy" ? 20 : analystRating === "Buy" ? 15 :
     analystRating === "Hold" ? 10 : analystRating === "Sell" ? 3 : 8) +
    (upsidePct > 20 ? 5 : upsidePct > 10 ? 3 : 0);

  // Valuation
  const { valuationScore, valuationLabel } = computeValuation(pe, m.peg_ratio ?? null);

  // Total score now includes valuation (max 120 → normalize to 100)
  const rawTotal = growthScore + profitScore + healthScore + analystScore + valuationScore;
  const fundamentalScore = Math.min(100, Math.max(0, Math.round(rawTotal * (100 / 120))));

  // Stock Type — now uses P/E
  const stockType =
    revenueGrowth1y > 20 && (pe == null || pe > 30) ? "growth" :
    (pe != null && pe > 0 && pe < 15) && netMargin > 10 ? "value" :
    revenueGrowth1y > 10 && (pe == null || pe < 25) ? "blend" :
    revenueGrowth1y < 0 || netMargin < 0 ? "speculative" :
    "blend";

  return { fundamentalScore, stockType, growthScore, profitScore, healthScore, analystScore, valuationScore, valuationLabel };
}

async function fetchSmartMoney(symbol: string, apiKey: string): Promise<{
  institutional_ownership_pct: number | null;
  institutional_change: number | null;
  top_institutions: any[] | null;
  insider_sentiment_score: number | null;
  recent_insider_buys: number;
  recent_insider_sells: number;
}> {
  const result: any = {
    institutional_ownership_pct: null,
    institutional_change: null,
    top_institutions: null,
    insider_sentiment_score: null,
    recent_insider_buys: 0,
    recent_insider_sells: 0,
  };

  // 1. Mutual fund ownership (free tier alternative to institutional-ownership)
  try {
    const resp = await fetch(`https://finnhub.io/api/v1/mutual-fund/ownership?symbol=${symbol}&token=${apiKey}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.ownership && Array.isArray(data.ownership) && data.ownership.length > 0) {
        // Sum up percentage held by all mutual funds as proxy for institutional ownership
        const totalPct = data.ownership.reduce((sum: number, fund: any) => sum + (fund.percentage || 0), 0);
        result.institutional_ownership_pct = Math.round(totalPct * 100) / 100;

        // Top 3 holders
        const sorted = [...data.ownership].sort((a: any, b: any) => (b.percentage || 0) - (a.percentage || 0));
        result.top_institutions = sorted.slice(0, 3).map((fund: any) => ({
          name: fund.name || "Unknown Fund",
          pct: fund.percentage != null ? Math.round(fund.percentage * 100) / 100 : null,
          shares: fund.share || null,
        }));

        // Change vs prior period — check if there's a portfolioDate we can compare
        // For now, just mark change as null (would need historical calls)
      }
    }
  } catch (e) {
    console.warn(`Mutual fund ownership error for ${symbol}:`, e);
  }
  await sleep(CALL_DELAY_MS);

  // 2. Insider sentiment
  try {
    const today = new Date().toISOString().slice(0, 10);
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const resp = await fetch(`https://finnhub.io/api/v1/stock/insider-sentiment?symbol=${symbol}&from=${threeMonthsAgo}&to=${today}&token=${apiKey}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.data && data.data.length > 0) {
        const msprs = data.data.map((d: any) => d.mspr).filter((v: any) => v != null);
        if (msprs.length > 0) {
          result.insider_sentiment_score = Math.round((msprs.reduce((a: number, b: number) => a + b, 0) / msprs.length) * 100) / 100;
        }
      }
    }
  } catch (e) {
    console.warn(`Insider sentiment error for ${symbol}:`, e);
  }
  await sleep(CALL_DELAY_MS);

  // 3. Insider transactions — count buys vs sells last 90 days
  try {
    const resp = await fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${symbol}&token=${apiKey}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.data && Array.isArray(data.data)) {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        for (const tx of data.data) {
          const txDate = new Date(tx.transactionDate || tx.filingDate || "");
          if (txDate < cutoff) continue;
          const code = (tx.transactionCode || "").toUpperCase();
          if (code === "P" || code === "A") result.recent_insider_buys++;
          else if (code === "S" || code === "F") result.recent_insider_sells++;
        }
      }
    }
  } catch (e) {
    console.warn(`Insider transactions error for ${symbol}:`, e);
  }
  await sleep(CALL_DELAY_MS);

  return result;
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
        // 1. Stock metrics
        const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`;
        const resp = await fetch(url);

        if (resp.status === 429) {
          console.warn(`Rate limited at ${symbol}, pausing 60s`);
          await sleep(60000);
          i--;
          continue;
        }

        if (!resp.ok) {
          console.warn(`Finnhub error for ${symbol}: ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const metric = data.metric || {};

        // 2. Fetch price
        let price = 0;
        try {
          const quoteResp = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`);
          if (quoteResp.ok) {
            const quote = await quoteResp.json();
            price = quote.c || 0;
          }
          await sleep(CALL_DELAY_MS);
        } catch {}

        // Valuation metrics from same /stock/metric response
        const peRatio = metric.peNormalizedAnnual ?? metric.peTTM ?? null;
        const forwardPe = metric.forwardPE ?? null;
        const psRatio = metric.psTTM ?? metric.psAnnual ?? null;
        const pbRatio = metric.pbAnnual ?? metric.pbQuarterly ?? null;
        const evEbitda = metric["ev/ebitdaTTM"] ?? metric["ev/ebitdaAnnual"] ?? null;
        const revGrowth = metric.revenueGrowthQuarterlyYoy ?? metric.revenueGrowthTTMYoy ?? null;
        const pegRatio = (peRatio != null && peRatio > 0 && revGrowth != null && revGrowth > 0)
          ? Math.round((peRatio / revGrowth) * 100) / 100
          : null;

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
          pe_ratio: peRatio,
          forward_pe: forwardPe,
          ps_ratio: psRatio,
          pb_ratio: pbRatio,
          ev_ebitda: evEbitda,
          peg_ratio: pegRatio,
          last_updated: new Date().toISOString(),
        };

        // 3. Smart money data
        const smartData = await fetchSmartMoney(symbol, FINNHUB_API_KEY);
        row.institutional_ownership_pct = smartData.institutional_ownership_pct;
        row.institutional_change = smartData.institutional_change;
        row.top_institutions = smartData.top_institutions;
        row.insider_sentiment_score = smartData.insider_sentiment_score;
        row.recent_insider_buys = smartData.recent_insider_buys;
        row.recent_insider_sells = smartData.recent_insider_sells;

        // Compute scores
        const scores = computeScores({ ...row, price, peg_ratio: pegRatio });
        row.fundamental_score = scores.fundamentalScore;
        row.stock_type = scores.stockType;
        row.valuation_score = scores.valuationScore;
        row.valuation_label = scores.valuationLabel;

        // Smart money scores
        const sm = computeSmartMoney(smartData.institutional_ownership_pct, smartData.institutional_change, smartData.insider_sentiment_score, smartData.recent_insider_buys, smartData.recent_insider_sells);
        row.smart_money_score = sm.smartMoneyScore;
        row.smart_money_label = sm.smartMoneyLabel;
        row.insider_sentiment_label = sm.insiderSentimentLabel;

        // Upsert (exclude price — not in table)
        const upsertRow = { ...row };
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
