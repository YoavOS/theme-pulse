// Computes weighted contribution of top constituents to QQQ / SPY index move.
// GET /?index=QQQ|SPY&timeframe=today|1w|1m
// Uses static top-50 weight tables (approximate, refresh periodically) and
// fetches today's % change from Yahoo Finance for each symbol.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0";

// Approximate top-50 weights (% of index). Updated late-2025 snapshot.
// QQQ holdings (Invesco) — top contributors by weight
const QQQ_WEIGHTS: Array<[string, string, number]> = [
  ["NVDA", "NVIDIA Corp", 9.1], ["MSFT", "Microsoft Corp", 8.4], ["AAPL", "Apple Inc", 7.8],
  ["AMZN", "Amazon.com Inc", 5.7], ["AVGO", "Broadcom Inc", 5.2], ["META", "Meta Platforms", 4.8],
  ["GOOGL", "Alphabet Inc Class A", 2.7], ["GOOG", "Alphabet Inc Class C", 2.6], ["TSLA", "Tesla Inc", 3.4],
  ["NFLX", "Netflix Inc", 2.3], ["COST", "Costco Wholesale", 2.6], ["PLTR", "Palantir Technologies", 1.4],
  ["TMUS", "T-Mobile US", 1.6], ["CSCO", "Cisco Systems", 1.6], ["LIN", "Linde plc", 1.4],
  ["AZN", "AstraZeneca plc", 1.3], ["AMD", "Advanced Micro Devices", 1.3], ["INTU", "Intuit Inc", 1.3],
  ["PEP", "PepsiCo Inc", 1.2], ["ISRG", "Intuitive Surgical", 1.2], ["QCOM", "Qualcomm Inc", 1.1],
  ["ADBE", "Adobe Inc", 1.1], ["BKNG", "Booking Holdings", 1.1], ["TXN", "Texas Instruments", 1.0],
  ["AMGN", "Amgen Inc", 1.0], ["AMAT", "Applied Materials", 0.9], ["HON", "Honeywell International", 0.8],
  ["CMCSA", "Comcast Corp", 0.8], ["VRTX", "Vertex Pharmaceuticals", 0.8], ["PANW", "Palo Alto Networks", 0.9],
  ["MU", "Micron Technology", 0.9], ["LRCX", "Lam Research", 0.7], ["GILD", "Gilead Sciences", 0.7],
  ["ADI", "Analog Devices", 0.7], ["KLAC", "KLA Corp", 0.7], ["MELI", "MercadoLibre Inc", 0.7],
  ["MDLZ", "Mondelez International", 0.6], ["ADP", "Automatic Data Processing", 0.7], ["CRWD", "CrowdStrike Holdings", 0.7],
  ["SBUX", "Starbucks Corp", 0.6], ["CTAS", "Cintas Corp", 0.6], ["SNPS", "Synopsys Inc", 0.5],
  ["CDNS", "Cadence Design Systems", 0.5], ["MRVL", "Marvell Technology", 0.5], ["ORLY", "O'Reilly Automotive", 0.5],
  ["FTNT", "Fortinet Inc", 0.5], ["ASML", "ASML Holding", 0.6], ["REGN", "Regeneron Pharmaceuticals", 0.4],
  ["ABNB", "Airbnb Inc", 0.5], ["WDAY", "Workday Inc", 0.4],
];

// SPY (SPDR S&P 500) — top 50 by weight. Approximate late-2025 snapshot.
const SPY_WEIGHTS: Array<[string, string, number]> = [
  ["NVDA", "NVIDIA Corp", 7.5], ["MSFT", "Microsoft Corp", 6.8], ["AAPL", "Apple Inc", 6.4],
  ["AMZN", "Amazon.com Inc", 4.0], ["META", "Meta Platforms", 2.6], ["GOOGL", "Alphabet Inc A", 2.0],
  ["GOOG", "Alphabet Inc C", 1.8], ["AVGO", "Broadcom Inc", 2.4], ["BRK.B", "Berkshire Hathaway B", 1.7],
  ["TSLA", "Tesla Inc", 1.9], ["JPM", "JPMorgan Chase", 1.4], ["LLY", "Eli Lilly", 1.3],
  ["V", "Visa Inc", 1.0], ["WMT", "Walmart Inc", 1.0], ["UNH", "UnitedHealth Group", 0.9],
  ["XOM", "Exxon Mobil", 1.0], ["MA", "Mastercard Inc", 0.9], ["JNJ", "Johnson & Johnson", 0.8],
  ["ORCL", "Oracle Corp", 0.9], ["COST", "Costco Wholesale", 0.9], ["PG", "Procter & Gamble", 0.8],
  ["HD", "Home Depot", 0.7], ["NFLX", "Netflix Inc", 0.8], ["BAC", "Bank of America", 0.7],
  ["ABBV", "AbbVie Inc", 0.7], ["KO", "Coca-Cola Co", 0.6], ["PLTR", "Palantir Technologies", 0.5],
  ["CVX", "Chevron Corp", 0.6], ["TMUS", "T-Mobile US", 0.5], ["CRM", "Salesforce Inc", 0.6],
  ["WFC", "Wells Fargo", 0.6], ["CSCO", "Cisco Systems", 0.5], ["MRK", "Merck & Co", 0.5],
  ["MCD", "McDonald's Corp", 0.5], ["ADBE", "Adobe Inc", 0.4], ["LIN", "Linde plc", 0.5],
  ["AMD", "Advanced Micro Devices", 0.5], ["IBM", "IBM Corp", 0.4], ["PEP", "PepsiCo Inc", 0.4],
  ["DIS", "Walt Disney", 0.4], ["AXP", "American Express", 0.4], ["GS", "Goldman Sachs", 0.4],
  ["GE", "General Electric", 0.4], ["TMO", "Thermo Fisher Scientific", 0.4], ["ISRG", "Intuitive Surgical", 0.4],
  ["NOW", "ServiceNow Inc", 0.4], ["CAT", "Caterpillar Inc", 0.4], ["MS", "Morgan Stanley", 0.4],
  ["INTU", "Intuit Inc", 0.4], ["VZ", "Verizon Communications", 0.4],
];

const INDEX_SYMBOL: Record<string, string> = { QQQ: "QQQ", SPY: "SPY" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface QuoteResult {
  symbol: string;
  pctChange: number | null;
  price: number | null;
}

async function fetchQuotes(symbols: string[]): Promise<Map<string, QuoteResult>> {
  const out = new Map<string, QuoteResult>();
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return out;
    const json = await res.json().catch(() => null);
    const rows = json?.quoteResponse?.result ?? [];
    for (const r of rows) {
      const sym = String(r.symbol || "").toUpperCase();
      const pct = typeof r.regularMarketChangePercent === "number" ? r.regularMarketChangePercent : null;
      const price = typeof r.regularMarketPrice === "number" ? r.regularMarketPrice : null;
      out.set(sym, { symbol: sym, pctChange: pct, price });
    }
  } catch {
    // ignore — caller will see missing entries
  }
  return out;
}

async function fetchHistoricalPct(symbol: string, days: number): Promise<number | null> {
  const range = days <= 7 ? "1mo" : "3mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const r = json?.chart?.result?.[0];
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    const clean = closes.filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);
    if (clean.length < days + 1) return null;
    const last = clean[clean.length - 1];
    const ref = clean[clean.length - 1 - days];
    if (!ref) return null;
    return ((last - ref) / ref) * 100;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const indexParam = (url.searchParams.get("index") || "QQQ").toUpperCase();
    const timeframe = (url.searchParams.get("timeframe") || "today").toLowerCase();
    if (!INDEX_SYMBOL[indexParam]) return jsonResponse({ error: "index must be QQQ or SPY" }, 400);

    const weights = indexParam === "QQQ" ? QQQ_WEIGHTS : SPY_WEIGHTS;
    const indexSymbol = INDEX_SYMBOL[indexParam];

    let perRow: Array<{ symbol: string; name: string; weight: number; pctChange: number | null }>;
    let indexPct: number | null = null;
    let indexPrice: number | null = null;

    if (timeframe === "today") {
      const symbols = [indexSymbol, ...weights.map((w) => w[0])];
      const quotes = await fetchQuotes(symbols);
      const idx = quotes.get(indexSymbol);
      indexPct = idx?.pctChange ?? null;
      indexPrice = idx?.price ?? null;
      perRow = weights.map(([sym, name, weight]) => ({
        symbol: sym, name, weight,
        pctChange: quotes.get(sym)?.pctChange ?? null,
      }));
    } else {
      const days = timeframe === "1m" ? 21 : 5;
      const symbols = [indexSymbol, ...weights.map((w) => w[0])];
      const results = await Promise.all(symbols.map((s) => fetchHistoricalPct(s, days).catch(() => null)));
      const map = new Map<string, number | null>();
      symbols.forEach((s, i) => map.set(s, results[i]));
      indexPct = map.get(indexSymbol) ?? null;
      perRow = weights.map(([sym, name, weight]) => ({
        symbol: sym, name, weight, pctChange: map.get(sym) ?? null,
      }));
    }

    // Compute weighted contribution (in % points) and cumulative
    const enriched = perRow.map((r) => ({
      ...r,
      weightedContribution:
        r.pctChange === null ? null : Math.round(((r.weight / 100) * r.pctChange) * 1000) / 1000,
    }));
    // Sort by absolute contribution to get the biggest movers (positive or negative)
    const sortedByAbs = [...enriched].sort(
      (a, b) => Math.abs(b.weightedContribution ?? 0) - Math.abs(a.weightedContribution ?? 0),
    );
    let cum = 0;
    const totalAbsContrib = sortedByAbs.reduce((s, r) => s + Math.abs(r.weightedContribution ?? 0), 0);
    const rows = sortedByAbs.map((r, i) => {
      cum += Math.abs(r.weightedContribution ?? 0);
      return {
        rank: i + 1,
        symbol: r.symbol,
        name: r.name,
        weight: r.weight,
        pctChange: r.pctChange,
        weightedContribution: r.weightedContribution,
        cumulative: Math.round(cum * 1000) / 1000,
        cumulativeShare: totalAbsContrib > 0 ? Math.round((cum / totalAbsContrib) * 1000) / 10 : null,
      };
    });

    const top10AbsContrib = rows.slice(0, 10).reduce((s, r) => s + Math.abs(r.weightedContribution ?? 0), 0);
    const top10ContributionPct = totalAbsContrib > 0 ? Math.round((top10AbsContrib / totalAbsContrib) * 1000) / 10 : null;
    const top5AbsContrib = rows.slice(0, 5).reduce((s, r) => s + Math.abs(r.weightedContribution ?? 0), 0);
    const top5ContributionPct = totalAbsContrib > 0 ? Math.round((top5AbsContrib / totalAbsContrib) * 1000) / 10 : null;

    const advancers = enriched.filter((r) => (r.pctChange ?? 0) > 0).length;
    const decliners = enriched.filter((r) => (r.pctChange ?? 0) < 0).length;

    return jsonResponse({
      index: indexParam,
      timeframe,
      indexPct: indexPct === null ? null : Math.round(indexPct * 100) / 100,
      indexPrice,
      rows,
      top5ContributionPct,
      top10ContributionPct,
      breadth: { advancers, decliners, total: enriched.length },
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("index-drivers error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
