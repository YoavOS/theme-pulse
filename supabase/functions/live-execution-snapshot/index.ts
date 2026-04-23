// Live Execution snapshot — pulls a real-time quote + options chain from Yahoo Finance
// (free, no API key) and computes beginner-friendly summary metrics.
//
// Returns:
//   quote: { price, changePct, dayHigh, dayLow, volume, avgVolume }
//   benchmark: { symbol, price, changePct, return1w, return1m, return3m }
//   options: { put_call_ratio, total_call_volume, total_put_volume,
//              avg_iv, sentiment, unusual_activity, expiration }

import { getHistoricalData, makeServiceClient, type YahooPeriod } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const ALLOWED_BENCHMARKS = new Set(["SPY", "QQQ"]);

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

interface BenchmarkSnapshot {
  symbol: string;
  price: number | null;
  changePct: number | null;       // 1D % change (live, intraday)
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
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

export interface PeriodGrowth {
  eps: number | null;       // decimal
  revenue: number | null;   // decimal
}

interface FundamentalsSnapshot {
  available: boolean;
  pe: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
  epsGrowth: number | null;       // earningsQuarterlyGrowth (yoy %, decimal) — kept for back-compat
  revenueGrowth: number | null;   // revenueGrowth TTM YoY (decimal) — kept for back-compat
  profitMargin: number | null;    // decimal
  sector: string | null;
  industry: string | null;
  // Growth broken down by period — null entries mean "not reported / not enough data"
  growthByPeriod: {
    ttm_yoy: PeriodGrowth;
    annual_yoy: PeriodGrowth;
    quarterly_yoy: PeriodGrowth;
    quarterly_qoq: PeriodGrowth;
  };
  source: string;
}

interface IndustrySnapshot {
  available: boolean;
  etfSymbol: string | null;
  sectorName: string | null;
  changePct: number | null;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
}

async function fetchYahooQuote(symbol: string): Promise<QuoteSnapshot | null> {
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

async function fetchBenchmarkSnapshot(symbol: string, forceRefresh = false): Promise<BenchmarkSnapshot> {
  const sb = makeServiceClient();
  const quote = await fetchYahooQuote(symbol);
  const periods: YahooPeriod[] = ["5d", "1mo", "3mo"];
  const hist = await Promise.all(
    periods.map((p) =>
      getHistoricalData(sb, symbol, p, { todayPrice: quote?.price ?? null, skipCache: forceRefresh })
    )
  );
  const [w, m, q] = hist;
  return {
    symbol,
    price: quote?.price ?? null,
    changePct: quote?.changePct ?? null,
    return1w: w.returnPct,
    return1m: m.returnPct,
    return3m: q.returnPct,
  };
}

// Cache the Yahoo (cookie, crumb) pair across invocations within the same warm container.
let cachedAuth: { cookie: string; crumb: string; ts: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000; // 30 min

async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedAuth && Date.now() - cachedAuth.ts < AUTH_TTL_MS) {
    return { cookie: cachedAuth.cookie, crumb: cachedAuth.crumb };
  }
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "manual",
    });
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";
    const a3Match = setCookie.match(/A3=([^;]+)/);
    if (!a3Match) return null;
    const cookie = `A3=${a3Match[1]}`;

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
    const totalContractVol = totalCallVol + totalPutVol;
    const MIN_VOL_FOR_SENTIMENT = 500;

    let sentiment: "Bullish" | "Bearish" | "Neutral" = "Neutral";
    let sentimentExp =
      "Calls and puts are roughly balanced — no clear directional lean from today's flow.";
    if (totalContractVol < MIN_VOL_FOR_SENTIMENT) {
      sentimentExp =
        "Today's options volume is too low to draw a reliable directional read.";
    } else if (pcr !== null) {
      if (pcr < 0.7) {
        sentiment = "Bullish";
        sentimentExp =
          "Today's flow leans toward calls (bullish bets) more than puts — a mildly optimistic tilt, not a guarantee of direction.";
      } else if (pcr > 1.3) {
        sentiment = "Bearish";
        sentimentExp =
          "Today's flow leans toward puts (bearish bets / hedges) more than calls — a mildly cautious tilt, not a guarantee of direction.";
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
        ? "Not enough data to estimate expected movement."
        : highIv
        ? `Options are pricing in larger-than-usual moves (avg IV ${(avgIv * 100).toFixed(0)}%) — premiums are expensive.`
        : `Options premiums look normal (avg IV ${(avgIv * 100).toFixed(0)}%) — market expects typical movement.`;

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

// Sector → SPDR sector ETF mapping. Accepts either a broad GICS sector name or
// the granular "industry" string Finnhub stores (we substring-match keywords).
const SECTOR_ETF_MAP: Array<{ etf: string; name: string; keywords: string[] }> = [
  { etf: "XLK", name: "Information Technology", keywords: ["technolog", "software", "semicond", "it services", "hardware", "electronic equipment"] },
  { etf: "XLV", name: "Health Care", keywords: ["health", "biotech", "pharma", "life sciences"] },
  { etf: "XLF", name: "Financials", keywords: ["financ", "bank", "insurance", "capital markets", "consumer finance", "mortgage"] },
  { etf: "XLY", name: "Consumer Discretionary", keywords: ["auto", "retail", "leisure", "hotel", "restaurant", "apparel", "household durab", "consumer products"] },
  { etf: "XLP", name: "Consumer Staples", keywords: ["beverage", "food", "household products", "personal products", "tobacco", "staples"] },
  { etf: "XLE", name: "Energy", keywords: ["energy", "oil", "gas"] },
  { etf: "XLI", name: "Industrials", keywords: ["industrial", "aerospace", "airline", "logistics", "machinery", "construction", "transportation", "commercial services", "professional services"] },
  { etf: "XLB", name: "Materials", keywords: ["material", "chemical", "metal", "mining", "paper", "packaging"] },
  { etf: "XLU", name: "Utilities", keywords: ["utilit", "electric", "renewable energy"] },
  { etf: "XLRE", name: "Real Estate", keywords: ["real estate", "reit"] },
  { etf: "XLC", name: "Communication Services", keywords: ["media", "entertainment", "telecom", "interactive media", "communication"] },
];

function resolveSectorEtf(sector: string | null | undefined): { etf: string; name: string } | null {
  if (!sector) return null;
  const s = sector.toLowerCase();
  for (const m of SECTOR_ETF_MAP) {
    if (m.keywords.some((k) => s.includes(k))) return { etf: m.etf, name: m.name };
  }
  return null;
}

async function fetchIndustrySnapshot(sector: string | null | undefined, forceRefresh = false): Promise<IndustrySnapshot> {
  const empty: IndustrySnapshot = {
    available: false, etfSymbol: null, sectorName: null,
    changePct: null, return1w: null, return1m: null, return3m: null,
  };
  const map = resolveSectorEtf(sector);
  if (!map) return empty;
  try {
    const sb = makeServiceClient();
    const quote = await fetchYahooQuote(map.etf);
    const periods: YahooPeriod[] = ["5d", "1mo", "3mo"];
    const hist = await Promise.all(
      periods.map((p) => getHistoricalData(sb, map.etf, p, { todayPrice: quote?.price ?? null, skipCache: forceRefresh }))
    );
    return {
      available: true,
      etfSymbol: map.etf,
      sectorName: map.name,
      changePct: quote?.changePct ?? null,
      return1w: hist[0].returnPct,
      return1m: hist[1].returnPct,
      return3m: hist[2].returnPct,
    };
  } catch {
    return empty;
  }
}

async function fetchFundamentalsSnapshot(symbol: string): Promise<FundamentalsSnapshot> {
  const emptyPg: PeriodGrowth = { eps: null, revenue: null };
  const empty: FundamentalsSnapshot = {
    available: false, pe: null, forwardPe: null, pegRatio: null,
    epsGrowth: null, revenueGrowth: null, profitMargin: null,
    sector: null, industry: null,
    growthByPeriod: {
      ttm_yoy: { ...emptyPg },
      annual_yoy: { ...emptyPg },
      quarterly_yoy: { ...emptyPg },
      quarterly_qoq: { ...emptyPg },
    },
    source: "yahoo",
  };
  const auth = await getYahooAuth();
  if (!auth) return empty;
  const modules = [
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "assetProfile",
    "price",
    "earnings",
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
  ].join(",");
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" },
    });
    if (!res.ok) return empty;
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return empty;
    const sd = result.summaryDetail ?? {};
    const ks = result.defaultKeyStatistics ?? {};
    const fd = result.financialData ?? {};
    const ps = result.price ?? {};
    const profile = result.assetProfile ?? {};
    const earnings = result.earnings ?? {};
    const annualHist: any[] = result.incomeStatementHistory?.incomeStatementHistory ?? [];
    const qHist: any[] = result.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];

    const raw = (x: any): number | null => {
      if (x === null || x === undefined) return null;
      const v = typeof x === "object" ? x.raw : x;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    const safeGrowth = (curr: number | null, prev: number | null): number | null => {
      if (curr === null || prev === null || !Number.isFinite(prev) || prev === 0) return null;
      // For negatives we use absolute value of the base so the sign of growth still makes sense
      return (curr - prev) / Math.abs(prev);
    };

    // ── TTM YoY (from financialData) ──
    const ttm: PeriodGrowth = {
      eps: raw(fd.earningsGrowth) ?? null,       // TTM YoY
      revenue: raw(fd.revenueGrowth) ?? null,    // TTM YoY
    };

    // ── Annual YoY (from incomeStatementHistory: latest vs prior fiscal year) ──
    const annual: PeriodGrowth = { eps: null, revenue: null };
    if (annualHist.length >= 2) {
      const a0 = annualHist[0];
      const a1 = annualHist[1];
      annual.revenue = safeGrowth(raw(a0?.totalRevenue), raw(a1?.totalRevenue));
      annual.eps = safeGrowth(raw(a0?.netIncome), raw(a1?.netIncome));
    }

    // ── Quarterly QoQ (from incomeStatementHistoryQuarterly: latest vs prior quarter) ──
    const qoq: PeriodGrowth = { eps: null, revenue: null };
    if (qHist.length >= 2) {
      const q0 = qHist[0];
      const q1 = qHist[1];
      qoq.revenue = safeGrowth(raw(q0?.totalRevenue), raw(q1?.totalRevenue));
      qoq.eps = safeGrowth(raw(q0?.netIncome), raw(q1?.netIncome));
    }

    // ── Quarterly YoY ──
    // EPS: defaultKeyStatistics.earningsQuarterlyGrowth is precisely this.
    // Revenue: try financialData.revenueQuarterlyGrowth (some responses), otherwise compute
    //   from earnings.financialsChart.quarterly which contains 4 quarters labelled like "1Q2024".
    let qyoyEps = raw(ks.earningsQuarterlyGrowth) ?? null;
    let qyoyRev = raw((fd as any).revenueQuarterlyGrowth) ?? null;
    if (qyoyRev === null) {
      const qChart: any[] = earnings?.financialsChart?.quarterly ?? [];
      // Find latest quarter and the same quarter a year earlier
      if (qChart.length >= 2) {
        const last = qChart[qChart.length - 1];
        const lastDate: string = last?.date ?? "";
        const m = lastDate.match(/^(\d)Q(\d{4})$/i);
        if (m) {
          const wantPrev = `${m[1]}Q${parseInt(m[2]) - 1}`;
          const prior = qChart.find((q) => (q?.date ?? "").toLowerCase() === wantPrev.toLowerCase());
          if (prior) {
            qyoyRev = safeGrowth(raw(last?.revenue), raw(prior?.revenue));
            if (qyoyEps === null) qyoyEps = safeGrowth(raw(last?.earnings), raw(prior?.earnings));
          }
        }
      }
    }
    const quarterlyYoy: PeriodGrowth = { eps: qyoyEps, revenue: qyoyRev };

    return {
      available: true,
      pe: raw(sd.trailingPE) ?? raw(ks.trailingPE) ?? null,
      forwardPe: raw(sd.forwardPE) ?? raw(ks.forwardPE) ?? null,
      pegRatio: raw(ks.pegRatio) ?? null,
      epsGrowth: quarterlyYoy.eps ?? raw(fd.earningsGrowth) ?? null,
      revenueGrowth: ttm.revenue ?? null,
      profitMargin: raw(fd.profitMargins) ?? null,
      sector: (profile.sector as string | undefined) ?? (ps.sector as string | undefined) ?? null,
      industry: (profile.industry as string | undefined) ?? (ps.industry as string | undefined) ?? null,
      growthByPeriod: {
        ttm_yoy: ttm,
        annual_yoy: annual,
        quarterly_yoy: quarterlyYoy,
        quarterly_qoq: qoq,
      },
      source: "yahoo",
    };
  } catch {
    return empty;
  }
}

async function fetchHistoricalForTicker(symbol: string, todayPrice: number | null, forceRefresh = false) {
  const sb = makeServiceClient();
  const periods: YahooPeriod[] = ["5d", "1mo", "3mo"];
  const hist = await Promise.all(
    periods.map((p) => getHistoricalData(sb, symbol, p, { todayPrice, skipCache: forceRefresh }))
  );
  return {
    return1w: hist[0].returnPct,
    return1m: hist[1].returnPct,
    return3m: hist[2].returnPct,
  };
}

// Rough sector-average forward P/E benchmarks (long-term S&P 500 sector medians).
// Used so we can show "P/E vs sector avg" without fetching every peer.
const SECTOR_PE_BENCHMARK: Record<string, number> = {
  XLK: 28, XLV: 18, XLF: 14, XLY: 24, XLP: 21,
  XLE: 13, XLI: 20, XLB: 18, XLU: 17, XLRE: 30, XLC: 19,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const rawSymbol = (body?.symbol ?? "").toString().trim().toUpperCase();
    const benchmarkSymbol = (() => {
      const b = (body?.benchmark ?? "SPY").toString().trim().toUpperCase();
      return ALLOWED_BENCHMARKS.has(b) ? b : "SPY";
    })();
    const sectorHint = typeof body?.sector === "string" ? body.sector : null;
    const forceRefresh = body?.forceRefresh === true;

    if (!rawSymbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(rawSymbol)) {
      return new Response(JSON.stringify({ error: "Invalid symbol" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [quote, options, benchmark, fundamentals] = await Promise.all([
      fetchYahooQuote(rawSymbol),
      fetchYahooOptions(rawSymbol),
      fetchBenchmarkSnapshot(benchmarkSymbol, forceRefresh),
      fetchFundamentalsSnapshot(rawSymbol),
    ]);

    if (!quote || quote.price === null) {
      return new Response(
        JSON.stringify({ error: `No live quote available for ${rawSymbol}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resolvedSectorHint = sectorHint ?? fundamentals.industry ?? fundamentals.sector ?? null;
    const industry = await fetchIndustrySnapshot(resolvedSectorHint, forceRefresh);
    const tickerHist = await fetchHistoricalForTicker(rawSymbol, quote.price, forceRefresh);

    const sectorPeAvg =
      industry?.etfSymbol && SECTOR_PE_BENCHMARK[industry.etfSymbol] !== undefined
        ? SECTOR_PE_BENCHMARK[industry.etfSymbol]
        : null;

    return new Response(
      JSON.stringify({
        symbol: rawSymbol,
        quote,
        options,
        benchmark,
        industry,
        fundamentals,
        sectorPeAvg,
        tickerHistory: tickerHist,
        fetchedAt: new Date().toISOString(),
      }),
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
