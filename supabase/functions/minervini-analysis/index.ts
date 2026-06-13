import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Minervini/3.0";
const REPORT_TTL = 24 * 60 * 60 * 1000;
const DB_CACHE_TTL = 24 * 60 * 60 * 1000;
const QUOTE_TTL = 24 * 60 * 60 * 1000;
const TIMESERIES_TTL = 24 * 60 * 60 * 1000;

const reportCache = new Map<string, { ts: number; report: MinerviniReport; dataQuality: DataQuality }>();
const quoteCache = new Map<string, { ts: number; data: any }>();
const timeseriesCache = new Map<string, { ts: number; data: any }>();
const finnhubCache = new Map<string, { ts: number; data: any }>();
let cachedYahooAuth: { cookie: string; crumb: string; ts: number } | null = null;

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "object" ? Number(v.raw ?? v.reportedValue?.raw ?? v.fmt ?? NaN) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (v: number | null, d = 2): number | null => v === null || !Number.isFinite(v) ? null : Number(v.toFixed(d));
const pct = (v: number | null) => round(v === null ? null : v * 100);
const pctGrowth = (now: number | null, prior: number | null): number | null => {
  if (now === null || prior === null || prior === 0) return null;
  return round(((now - prior) / Math.abs(prior)) * 100);
};
const avg = (values: (number | null)[]) => {
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return clean.length ? round(clean.reduce((s, v) => s + v, 0) / clean.length) : null;
};

interface PeriodPoint {
  date: string;
  revenue: number | null;
  eps: number | null;
  normalizedEps: number | null;
  netIncome: number | null;
  normalizedIncome: number | null;
  operatingIncome: number | null;
  grossProfit: number | null;
  totalDebt: number | null;
  equity: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
}

interface QuarterTrend extends PeriodPoint {
  revenueYoY: number | null;
  epsYoY: number | null;
  normalizedEpsYoY: number | null;
  revenueQoQ: number | null;
  epsQoQ: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  normalizedNetMargin: number | null;
  grossMargin: number | null;
  debtToEquity: number | null;
}

interface AnnualTrend extends PeriodPoint {
  revenueYoY: number | null;
  epsYoY: number | null;
  normalizedEpsYoY: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  normalizedNetMargin: number | null;
}

interface Criterion {
  name: string;
  value: string;
  target: string;
  status: "pass" | "fail" | "neutral";
  comment: string;
}

interface MinerviniReport {
  symbol: string;
  companyName: string;
  sector: string | null;
  overallScore: number;
  verdict: "PASS" | "FAIL" | "BORDERLINE";
  headline: string;
  criteria: Criterion[];
  bullCase: string[];
  bearCase: string[];
  finalVerdict: string;
}

interface DataQuality {
  sources: string[];
  warnings: string[];
  yahooCalls: number;
  finnhubCalls: number;
  dbCacheHit: boolean;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function valueFromTimeseriesItem(item: any): number | null {
  return num(item?.reportedValue ?? item);
}

function mapTimeseries(result: any[]): Record<string, { date: string; value: number | null }[]> {
  const out: Record<string, { date: string; value: number | null }[]> = {};
  for (const row of result ?? []) {
    const type = row?.meta?.type?.[0];
    if (!type || !Array.isArray(row[type])) continue;
    out[type] = row[type]
      .map((p: any) => ({ date: p.asOfDate, value: valueFromTimeseriesItem(p) }))
      .filter((p: any) => p.date)
      .sort((a: any, b: any) => b.date.localeCompare(a.date));
  }
  return out;
}

function pointFor(date: string, series: Record<string, { date: string; value: number | null }[]>, prefix: "quarterly" | "annual"): PeriodPoint {
  const get = (field: string) => series[`${prefix}${field}`]?.find(p => p.date === date)?.value ?? null;
  return {
    date,
    revenue: get("TotalRevenue"),
    eps: get("DilutedEPS"),
    normalizedEps: get("NormalizedDilutedEPS"),
    netIncome: get("NetIncome"),
    normalizedIncome: get("NormalizedIncome"),
    operatingIncome: get("OperatingIncome"),
    grossProfit: get("GrossProfit"),
    totalDebt: get("TotalDebt"),
    equity: get("StockholdersEquity"),
    operatingCashFlow: get("OperatingCashFlow"),
    freeCashFlow: get("FreeCashFlow"),
  };
}

function allDates(series: Record<string, { date: string; value: number | null }[]>, prefix: "quarterly" | "annual") {
  const dates = new Set<string>();
  for (const [key, points] of Object.entries(series)) {
    if (key.startsWith(prefix)) points.forEach(p => dates.add(p.date));
  }
  return [...dates].sort((a, b) => b.localeCompare(a));
}

function enrichQuarters(points: PeriodPoint[], yahooGrowth: { revenueYoY: number | null; epsYoY: number | null }): QuarterTrend[] {
  return points.map((p, i) => {
    const yearAgo = points[i + 4];
    const prev = points[i + 1];
    const normalizedEpsYoY = pctGrowth(p.normalizedEps ?? p.eps, yearAgo?.normalizedEps ?? yearAgo?.eps ?? null);
    const epsYoY = normalizedEpsYoY ?? pctGrowth(p.eps, yearAgo?.eps ?? null);
    return {
      ...p,
      revenueYoY: pctGrowth(p.revenue, yearAgo?.revenue ?? null) ?? (i === 0 ? yahooGrowth.revenueYoY : null),
      epsYoY: epsYoY ?? (i === 0 ? yahooGrowth.epsYoY : null),
      normalizedEpsYoY,
      revenueQoQ: pctGrowth(p.revenue, prev?.revenue ?? null),
      epsQoQ: pctGrowth(p.normalizedEps ?? p.eps, prev?.normalizedEps ?? prev?.eps ?? null),
      operatingMargin: p.revenue ? pct((p.operatingIncome ?? null) !== null ? p.operatingIncome! / p.revenue : null) : null,
      netMargin: p.revenue ? pct((p.netIncome ?? null) !== null ? p.netIncome! / p.revenue : null) : null,
      normalizedNetMargin: p.revenue ? pct((p.normalizedIncome ?? null) !== null ? p.normalizedIncome! / p.revenue : null) : null,
      grossMargin: p.revenue ? pct((p.grossProfit ?? null) !== null ? p.grossProfit! / p.revenue : null) : null,
      debtToEquity: p.equity && p.equity > 0 && p.totalDebt !== null ? round(p.totalDebt / p.equity) : null,
    };
  });
}

function enrichAnnual(points: PeriodPoint[]): AnnualTrend[] {
  return points.map((p, i) => {
    const prev = points[i + 1];
    const normalizedEpsYoY = pctGrowth(p.normalizedEps ?? p.eps, prev?.normalizedEps ?? prev?.eps ?? null);
    return {
      ...p,
      revenueYoY: pctGrowth(p.revenue, prev?.revenue ?? null),
      epsYoY: normalizedEpsYoY ?? pctGrowth(p.eps, prev?.eps ?? null),
      normalizedEpsYoY,
      operatingMargin: p.revenue ? pct((p.operatingIncome ?? null) !== null ? p.operatingIncome! / p.revenue : null) : null,
      netMargin: p.revenue ? pct((p.netIncome ?? null) !== null ? p.netIncome! / p.revenue : null) : null,
      normalizedNetMargin: p.revenue ? pct((p.normalizedIncome ?? null) !== null ? p.normalizedIncome! / p.revenue : null) : null,
    };
  });
}

function normalizeRatio(value: number | null): number | null {
  if (value === null) return null;
  return round(value > 10 ? value / 100 : value);
}

function normalizeOwnershipPct(value: number | null): number | null {
  if (value === null) return null;
  const pctValue = value <= 1.5 ? value * 100 : value;
  return round(Math.max(0, Math.min(100, pctValue)));
}

async function fetchQuoteSummary(symbol: string, quality: DataQuality) {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.ts < QUOTE_TTL) return hit.data;

  const modules = [
    "assetProfile", "summaryProfile", "price", "defaultKeyStatistics", "financialData", "summaryDetail",
    "incomeStatementHistory", "incomeStatementHistoryQuarterly", "balanceSheetHistory", "balanceSheetHistoryQuarterly",
    "cashflowStatementHistory", "cashflowStatementHistoryQuarterly", "earningsHistory", "earningsTrend",
  ].join(",");
  const auth = await yahooAuth();
  const crumb = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}${crumb}`;
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  if (auth?.cookie) headers.Cookie = auth.cookie;
  const r = await fetch(url, { headers });
  quality.yahooCalls++;
  if (r.status === 401 || r.status === 403) cachedYahooAuth = null;
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const data = j?.quoteSummary?.result?.[0] ?? null;
  if (data) quoteCache.set(symbol, { ts: Date.now(), data });
  return data;
}

async function yahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedYahooAuth && Date.now() - cachedYahooAuth.ts < 30 * 60 * 1000) {
    return { cookie: cachedYahooAuth.cookie, crumb: cachedYahooAuth.crumb };
  }
  try {
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    const sc = r.headers.get("set-cookie") ?? "";
    const a3 = sc.match(/A3=([^;]+)/);
    if (!a3) return null;
    const cookie = `A3=${a3[1]}`;
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    if (!cr.ok) return null;
    const crumb = (await cr.text()).trim();
    if (!crumb) return null;
    cachedYahooAuth = { cookie, crumb, ts: Date.now() };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function fetchTimeseries(symbol: string, quality: DataQuality) {
  const hit = timeseriesCache.get(symbol);
  if (hit && Date.now() - hit.ts < TIMESERIES_TTL) return hit.data;

  const types = [
    "quarterlyTotalRevenue", "quarterlyDilutedEPS", "quarterlyNormalizedDilutedEPS", "quarterlyNetIncome", "quarterlyNormalizedIncome",
    "quarterlyOperatingIncome", "quarterlyGrossProfit", "quarterlyTotalDebt", "quarterlyStockholdersEquity",
    "quarterlyOperatingCashFlow", "quarterlyFreeCashFlow", "annualTotalRevenue", "annualDilutedEPS", "annualNormalizedDilutedEPS",
    "annualNetIncome", "annualNormalizedIncome", "annualOperatingIncome", "annualGrossProfit", "annualTotalDebt", "annualStockholdersEquity",
    "annualOperatingCashFlow", "annualFreeCashFlow",
  ].join(",");
  const period2 = Math.floor(Date.now() / 1000) + 86400 * 40;
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=493590046&period2=${period2}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  quality.yahooCalls++;
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const data = mapTimeseries(j?.timeseries?.result ?? []);
  if (Object.keys(data).length) timeseriesCache.set(symbol, { ts: Date.now(), data });
  return Object.keys(data).length ? data : null;
}

async function fetchFinnhubMetric(symbol: string, quality: DataQuality) {
  if (!FINNHUB_KEY) return null;
  const hit = finnhubCache.get(symbol);
  if (hit && Date.now() - hit.ts < DB_CACHE_TTL) return hit.data;
  const r = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_KEY}`);
  quality.finnhubCalls++;
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  if (data) finnhubCache.set(symbol, { ts: Date.now(), data });
  return data;
}

async function readCachedFundamentals(sb: any, symbol: string, quality: DataQuality) {
  const cutoff = new Date(Date.now() - DB_CACHE_TTL).toISOString();
  const [{ data: stockFund }, { data: fundCache }] = await Promise.all([
    sb.from("stock_fundamentals").select("*").eq("symbol", symbol).gte("fetched_at", cutoff).maybeSingle(),
    sb.from("fundamentals_cache").select("*").eq("symbol", symbol).gte("last_updated", cutoff).maybeSingle(),
  ]);
  quality.dbCacheHit = !!(stockFund || fundCache);
  if (stockFund) quality.sources.push("stock_fundamentals cache");
  if (fundCache) quality.sources.push("fundamentals_cache");
  return { stockFund, fundCache };
}

function fallbackQuartersFromQuote(root: any, yahooGrowth: { revenueYoY: number | null; epsYoY: number | null }) {
  const incQ = root?.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
  const bsQ = root?.balanceSheetHistoryQuarterly?.balanceSheetStatements ?? [];
  const cfQ = root?.cashflowStatementHistoryQuarterly?.cashflowStatements ?? [];
  const byDate = new Map<string, PeriodPoint>();
  for (const x of incQ) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    byDate.set(date, {
      date, revenue: num(x.totalRevenue), eps: num(x.dilutedEPS), normalizedEps: null, netIncome: num(x.netIncome), normalizedIncome: null,
      operatingIncome: num(x.operatingIncome), grossProfit: num(x.grossProfit), totalDebt: null, equity: null, operatingCashFlow: null, freeCashFlow: null,
    });
  }
  for (const x of bsQ) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? { date } as PeriodPoint;
    row.totalDebt = (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0) || null;
    row.equity = num(x.totalStockholderEquity);
    byDate.set(date, row);
  }
  for (const x of cfQ) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? { date } as PeriodPoint;
    row.operatingCashFlow = num(x.totalCashFromOperatingActivities);
    row.freeCashFlow = (num(x.totalCashFromOperatingActivities) !== null && num(x.capitalExpenditures) !== null)
      ? num(x.totalCashFromOperatingActivities)! + num(x.capitalExpenditures)! : null;
    byDate.set(date, row);
  }
  return enrichQuarters([...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)), yahooGrowth);
}

function fallbackAnnualFromQuote(root: any) {
  const incA = root?.incomeStatementHistory?.incomeStatementHistory ?? [];
  const bsA = root?.balanceSheetHistory?.balanceSheetStatements ?? [];
  const cfA = root?.cashflowStatementHistory?.cashflowStatements ?? [];
  const byDate = new Map<string, PeriodPoint>();
  for (const x of incA) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    byDate.set(date, {
      date, revenue: num(x.totalRevenue), eps: num(x.dilutedEPS), normalizedEps: null, netIncome: num(x.netIncome), normalizedIncome: null,
      operatingIncome: num(x.operatingIncome), grossProfit: num(x.grossProfit), totalDebt: null, equity: null, operatingCashFlow: null, freeCashFlow: null,
    });
  }
  for (const x of bsA) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? { date } as PeriodPoint;
    row.totalDebt = (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0) || null;
    row.equity = num(x.totalStockholderEquity);
    byDate.set(date, row);
  }
  for (const x of cfA) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? { date } as PeriodPoint;
    row.operatingCashFlow = num(x.totalCashFromOperatingActivities);
    row.freeCashFlow = (num(x.totalCashFromOperatingActivities) !== null && num(x.capitalExpenditures) !== null)
      ? num(x.totalCashFromOperatingActivities)! + num(x.capitalExpenditures)! : null;
    byDate.set(date, row);
  }
  return enrichAnnual([...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)));
}

function summarizeTrend(values: (number | null)[]) {
  const clean = values.filter((v): v is number => v !== null);
  if (clean.length < 2) return "insufficient";
  const recent = clean[0];
  const priorAvg = avg(clean.slice(1, Math.min(clean.length, 4))) ?? clean[1];
  if (recent > priorAvg + 5) return "accelerating";
  if (recent < priorAvg - 5) return "decelerating";
  return "stable";
}

function fmtPct(v: number | null) { return v === null ? "N/A" : `${v.toFixed(1)}%`; }
function fmtRatio(v: number | null) { return v === null ? "N/A" : `${v.toFixed(2)}x`; }
function fmtTrend(values: (number | null)[]) { return values.map(fmtPct).join(" / "); }
function statusFrom(value: number | null, pass: boolean, fail: boolean): "pass" | "fail" | "neutral" {
  if (value === null) return "neutral";
  if (pass) return "pass";
  if (fail) return "fail";
  return "neutral";
}

function makeReport(symbol: string, profile: any, derived: any): MinerviniReport {
  const q = derived.quarters as QuarterTrend[];
  const a = derived.annual as AnnualTrend[];
  const latest = q[0];
  const revTrend = q.slice(0, 5).map(x => x.revenueYoY);
  const epsTrend = q.slice(0, 5).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const opMarginTrend = q.slice(0, 5).map(x => x.operatingMargin ?? x.normalizedNetMargin ?? x.netMargin);
  const annRev = a.slice(0, 4).map(x => x.revenueYoY);
  const annEps = a.slice(0, 4).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const revAccel = summarizeTrend(revTrend);
  const epsAccel = summarizeTrend(epsTrend);
  const marginAccel = summarizeTrend(opMarginTrend);

  const criteria: Criterion[] = [
    {
      name: "Quarterly EPS Growth Trend",
      value: fmtTrend(epsTrend), target: "≥25% YoY, consistent/accelerating",
      status: statusFrom(epsTrend[0], (epsTrend[0] ?? -999) >= 25 && epsAccel !== "decelerating", (epsTrend[0] ?? 999) < 0),
      comment: `Latest ${latest?.date ?? "quarter"}; trend is ${epsAccel}. Uses normalized/non-GAAP EPS where available.`,
    },
    {
      name: "Quarterly Sales Growth Trend",
      value: fmtTrend(revTrend), target: "≥20% YoY, consistent/accelerating",
      status: statusFrom(revTrend[0], (revTrend[0] ?? -999) >= 20 || ((revTrend[0] ?? -999) >= 8 && revAccel === "accelerating"), (revTrend[0] ?? 999) < 0),
      comment: `Latest ${latest?.date ?? "quarter"}; trend is ${revAccel} across available reported quarters.`,
    },
    {
      name: "Annual EPS Growth",
      value: fmtTrend(annEps), target: "Positive multi-year EPS growth",
      status: statusFrom(annEps[0], (annEps[0] ?? -999) > 0 && annEps.filter(v => (v ?? -1) > 0).length >= 1, (annEps[0] ?? 999) < 0),
      comment: "Annual trend uses normalized EPS when Yahoo exposes it; GAAP EPS is the fallback.",
    },
    {
      name: "Annual Sales Growth",
      value: fmtTrend(annRev), target: "Positive and preferably accelerating",
      status: statusFrom(annRev[0], (annRev[0] ?? -999) > 10 || annRev.filter(v => (v ?? -1) > 0).length >= 2, (annRev[0] ?? 999) < 0),
      comment: "Annual revenue growth is calculated from reported annual statements.",
    },
    {
      name: "ROE",
      value: fmtPct(derived.roePct), target: "≥17%",
      status: statusFrom(derived.roePct, (derived.roePct ?? 0) >= 17, (derived.roePct ?? 100) < 8),
      comment: "ROE is normalized from Yahoo/Fundamentals cache and treated as a percentage, not a fraction.",
    },
    {
      name: "Profit Margin Trend",
      value: fmtTrend(opMarginTrend), target: "Positive and expanding",
      status: statusFrom(opMarginTrend[0], (opMarginTrend[0] ?? -999) > 10 && marginAccel !== "decelerating", (opMarginTrend[0] ?? 999) < 0),
      comment: `Uses operating margin first as a non-GAAP proxy; trend is ${marginAccel}. Net margin is ${fmtPct(latest?.netMargin ?? null)}.`,
    },
    {
      name: "Debt / Equity",
      value: fmtRatio(derived.debtToEquity), target: "<1.5x preferred",
      status: statusFrom(derived.debtToEquity, (derived.debtToEquity ?? 99) < 1.5, (derived.debtToEquity ?? 0) > 3),
      comment: "Ratio is normalized to x (Yahoo percent values are divided by 100; balance sheet calculation is fallback).",
    },
    {
      name: "Balance Sheet / Cash Flow",
      value: `${derived.positiveCashFlowCount}/${derived.cashFlowPoints} positive OCF periods`, target: "Mostly positive operating cash flow",
      status: derived.cashFlowPoints === 0 ? "neutral" : derived.positiveCashFlowCount >= Math.max(1, derived.cashFlowPoints - 1) ? "pass" : "fail",
      comment: `Current ratio ${fmtRatio(derived.currentRatio)}; free cash flow latest ${derived.latestFreeCashFlow === null ? "N/A" : Intl.NumberFormat("en", { notation: "compact" }).format(derived.latestFreeCashFlow)}.`,
    },
    {
      name: "Institutional Sponsorship",
      value: fmtPct(derived.institutionalOwnershipPct), target: ">40%, ideal >70%",
      status: statusFrom(derived.institutionalOwnershipPct, (derived.institutionalOwnershipPct ?? 0) > 70, (derived.institutionalOwnershipPct ?? 100) < 20),
      comment: "Ownership is normalized from fraction/percent formats and capped at 100% to avoid parser blow-ups.",
    },
    {
      name: "Earnings Stability / Surprises",
      value: derived.epsBeatRatePct === null ? "N/A" : `${derived.epsBeatRatePct}% beat rate`, target: "Consistent beats / positive surprises",
      status: statusFrom(derived.epsBeatRatePct, (derived.epsBeatRatePct ?? 0) >= 70, (derived.epsBeatRatePct ?? 100) < 40),
      comment: `Recent surprises: ${derived.epsSurprisesRecent.length ? derived.epsSurprisesRecent.map(fmtPct).join(" / ") : "N/A"}.`,
    },
    {
      name: "Overall Fundamental Quality",
      value: derived.qualityLabel, target: "Clear growth, profitability, and balance-sheet support",
      status: derived.score >= 80 ? "pass" : derived.score < 60 ? "fail" : "neutral",
      comment: "Score emphasizes multi-quarter EPS/sales growth, acceleration, margins, ROE, debt, cash flow, and sponsorship.",
    },
  ];

  const bullCase = [
    revTrend[0] !== null ? `Latest quarterly sales growth is ${fmtPct(revTrend[0])}, with a ${revAccel} multi-quarter profile.` : "Revenue trend data is limited and should be verified against filings.",
    epsTrend[0] !== null ? `Latest normalized EPS growth is ${fmtPct(epsTrend[0])}, with ${epsAccel} momentum.` : "EPS trend data is limited or distorted by losses/one-time items.",
    opMarginTrend[0] !== null ? `Operating/non-GAAP margin proxy is ${fmtPct(opMarginTrend[0])}.` : "Margin data is incomplete.",
  ];
  const bearCase = [
    derived.debtToEquity !== null && derived.debtToEquity > 1.5 ? `Debt/equity is elevated at ${fmtRatio(derived.debtToEquity)}.` : "Debt/equity is not the primary weakness based on available data.",
    revAccel === "decelerating" || epsAccel === "decelerating" ? "Growth trend is decelerating across recent quarters." : "Main risk is whether current growth consistency can persist.",
    derived.warnings.length ? `Data caution: ${derived.warnings[0]}` : "No major parser warning triggered, but verify latest filings for final decisions.",
  ];
  const verdict = derived.score >= 80 ? "PASS" : derived.score >= 60 ? "BORDERLINE" : "FAIL";
  return {
    symbol,
    companyName: profile.name ?? symbol,
    sector: profile.sector ?? null,
    overallScore: derived.score,
    verdict,
    headline: `${symbol} scores ${derived.score}/100: ${derived.qualityLabel}. Latest quarter ${latest?.date ?? "N/A"} shows sales ${fmtPct(revTrend[0])} and normalized EPS ${fmtPct(epsTrend[0])}.`,
    criteria,
    bullCase,
    bearCase,
    finalVerdict: verdict === "PASS"
      ? `This stock passes Minervini fundamentals based on reported multi-quarter growth, profitability, and balance-sheet checks.`
      : verdict === "BORDERLINE"
        ? `This stock is borderline: there are constructive traits, but growth consistency, margins, debt, or earnings quality need confirmation.`
        : `This stock fails Minervini fundamentals due to insufficient growth consistency, profitability, balance-sheet quality, or data support.`,
  };
}

function scoreDerived(derived: any) {
  const latest = derived.quarters[0] as QuarterTrend | undefined;
  const epsTrend = derived.quarters.slice(0, 5).map((x: QuarterTrend) => x.normalizedEpsYoY ?? x.epsYoY);
  const revTrend = derived.quarters.slice(0, 5).map((x: QuarterTrend) => x.revenueYoY);
  const marginTrend = derived.quarters.slice(0, 5).map((x: QuarterTrend) => x.operatingMargin ?? x.normalizedNetMargin ?? x.netMargin);
  const epsAccel = summarizeTrend(epsTrend);
  const revAccel = summarizeTrend(revTrend);
  const marginAccel = summarizeTrend(marginTrend);

  let score = 0;
  if ((epsTrend[0] ?? -999) >= 50) score += 18; else if ((epsTrend[0] ?? -999) >= 25) score += 14; else if ((epsTrend[0] ?? -999) > 0) score += 8;
  if (epsAccel === "accelerating") score += 7; else if (epsAccel === "stable") score += 4;
  if ((revTrend[0] ?? -999) >= 20) score += 16; else if ((revTrend[0] ?? -999) >= 8) score += 10; else if ((revTrend[0] ?? -999) > 0) score += 5;
  if (revAccel === "accelerating") score += 7; else if (revAccel === "stable") score += 4;
  const annRevPositive = derived.annual.slice(0, 3).filter((x: AnnualTrend) => (x.revenueYoY ?? -1) > 0).length;
  const annEpsPositive = derived.annual.slice(0, 3).filter((x: AnnualTrend) => ((x.normalizedEpsYoY ?? x.epsYoY) ?? -1) > 0).length;
  score += Math.min(8, annRevPositive * 3);
  score += Math.min(8, annEpsPositive * 3);
  const margin = latest?.operatingMargin ?? latest?.normalizedNetMargin ?? latest?.netMargin ?? null;
  if ((margin ?? -999) >= 20) score += 10; else if ((margin ?? -999) >= 10) score += 7; else if ((margin ?? -999) > 0) score += 4;
  if (marginAccel === "accelerating") score += 4;
  if ((derived.roePct ?? -999) >= 17) score += 8; else if ((derived.roePct ?? -999) > 8) score += 4;
  if ((derived.debtToEquity ?? 99) < 0.75) score += 7; else if ((derived.debtToEquity ?? 99) < 1.5) score += 5; else if ((derived.debtToEquity ?? 99) < 3) score += 2;
  if (derived.cashFlowPoints > 0) score += derived.positiveCashFlowCount >= Math.max(1, derived.cashFlowPoints - 1) ? 5 : 1;
  if ((derived.institutionalOwnershipPct ?? 0) > 70) score += 6; else if ((derived.institutionalOwnershipPct ?? 0) > 40) score += 4;
  if ((derived.epsBeatRatePct ?? 0) >= 70) score += 4; else if ((derived.epsBeatRatePct ?? 0) >= 50) score += 2;
  derived.score = Math.max(0, Math.min(100, Math.round(score)));
  derived.qualityLabel = derived.score >= 80 ? "strong Minervini fundamental profile" : derived.score >= 60 ? "mixed but investable fundamental profile" : "weak/incomplete Minervini fundamental profile";
}

async function buildBundle(symbol: string, force: boolean) {
  const quality: DataQuality = { sources: [], warnings: [], yahooCalls: 0, finnhubCalls: 0, dbCacheHit: false };
  const sb = createClient(SB_URL, SB_KEY);
  const { stockFund, fundCache } = force ? { stockFund: null, fundCache: null } : await readCachedFundamentals(sb, symbol, quality);
  const needNetwork = force || !stockFund || !fundCache;
  const [quote, timeseries, fh] = needNetwork
    ? await Promise.all([fetchQuoteSummary(symbol, quality), fetchTimeseries(symbol, quality), fetchFinnhubMetric(symbol, quality)])
    : [null, null, null];

  if (quote) quality.sources.push("Yahoo quoteSummary");
  if (timeseries) quality.sources.push("Yahoo fundamentals-timeseries");
  if (fh?.metric) quality.sources.push("Finnhub metric fallback");

  const fd = quote?.financialData ?? {};
  const ks = quote?.defaultKeyStatistics ?? {};
  const profile = {
    name: quote?.price?.longName ?? quote?.price?.shortName ?? stockFund?.company_name ?? symbol,
    sector: quote?.assetProfile?.sector ?? quote?.summaryProfile?.sector ?? stockFund?.sector ?? fundCache?.sector ?? null,
  };
  const yahooGrowth = {
    revenueYoY: pct(num(fd.revenueGrowth)),
    epsYoY: pct(num(fd.earningsGrowth) ?? num(ks.earningsQuarterlyGrowth)),
  };

  let quarters: QuarterTrend[] = [];
  let annual: AnnualTrend[] = [];
  if (timeseries) {
    const qDates = allDates(timeseries, "quarterly");
    const aDates = allDates(timeseries, "annual");
    quarters = enrichQuarters(qDates.map(d => pointFor(d, timeseries, "quarterly")), yahooGrowth).slice(0, 9);
    annual = enrichAnnual(aDates.map(d => pointFor(d, timeseries, "annual"))).slice(0, 5);
  }
  if (quarters.length < 4 && quote) quarters = fallbackQuartersFromQuote(quote, yahooGrowth).slice(0, 8);
  if (annual.length < 2 && quote) annual = fallbackAnnualFromQuote(quote).slice(0, 4);

  const fhMetric = fh?.metric ?? {};
  const latest = quarters[0];
  let debtToEquity = latest?.debtToEquity ?? normalizeRatio(num(fd.debtToEquity)) ?? normalizeRatio(stockFund?.debt_to_equity ?? null) ?? normalizeRatio(fundCache?.debt_to_equity ?? null) ?? normalizeRatio(num(fhMetric.totalDebtToEquityQuarterly ?? fhMetric.totalDebtToEquityAnnual ?? fhMetric["totalDebt/totalEquityQuarterly"]));
  if (debtToEquity !== null && debtToEquity > 20) {
    quality.warnings.push(`Debt/equity suspicious after normalization (${debtToEquity}x); marked unavailable.`);
    debtToEquity = null;
  }
  const roePct = pct(num(fd.returnOnEquity)) ?? stockFund?.roe ?? fundCache?.roe ?? num(fhMetric.roeTTM ?? fhMetric.roeRfy) ?? null;
  const institutionalOwnershipPct = normalizeOwnershipPct(num(ks.heldPercentInstitutions) ?? fundCache?.institutional_ownership_pct ?? num(fhMetric.institutionalOwnershipPercentage));
  const currentRatio = normalizeRatio(num(fd.currentRatio) ?? stockFund?.current_ratio ?? fundCache?.current_ratio ?? num(fhMetric.currentRatioQuarterly ?? fhMetric.currentRatioAnnual));
  const cashFlowValues = quarters.slice(0, 5).map(q => q.operatingCashFlow).filter((v): v is number => v !== null);
  const positiveCashFlowCount = cashFlowValues.filter(v => v > 0).length;
  const earningsHistory = quote?.earningsHistory?.history ?? [];
  const surprises = earningsHistory.map((e: any) => pct(num(e.surprisePercent))).filter((v: number | null) => v !== null).slice(-8);
  const beatCount = earningsHistory.filter((e: any) => num(e.epsActual) !== null && num(e.epsEstimate) !== null && num(e.epsActual)! >= num(e.epsEstimate)!).length;

  if (quarters.length < 5) quality.warnings.push(`Only ${quarters.length} recent quarters available; trend confidence reduced.`);
  if (institutionalOwnershipPct !== null && institutionalOwnershipPct < 5 && (ks.heldPercentInstitutions?.raw ?? null) !== null) quality.warnings.push("Institutional ownership appears unusually low; source may be incomplete for this ticker.");
  if ((latest?.netMargin ?? 0) < 0 && (latest?.operatingMargin ?? 0) > 10) quality.warnings.push("GAAP net margin is negative while operating margin is healthy; likely one-time/non-operating distortion.");

  const derived = {
    quarters,
    annual,
    latestQuarter: latest?.date ?? null,
    roePct: round(roePct),
    debtToEquity,
    institutionalOwnershipPct,
    currentRatio,
    positiveCashFlowCount,
    cashFlowPoints: cashFlowValues.length,
    latestFreeCashFlow: latest?.freeCashFlow ?? null,
    epsBeatRatePct: earningsHistory.length ? Math.round((beatCount / earningsHistory.length) * 100) : null,
    epsSurprisesRecent: surprises,
    warnings: quality.warnings,
  };
  scoreDerived(derived);
  return { profile, derived, quality };
}

const GROQ_SYSTEM = `You are an institutional equity analyst. Rewrite the provided deterministic Minervini report for clarity only.
Rules:
- Do not change any numeric values, units, verdict, score, statuses, order, or field names.
- Do not invent facts. Keep JSON shape identical.
- Return ONLY valid JSON.`;

async function polishWithGroq(report: MinerviniReport, derived: any): Promise<MinerviniReport> {
  if (!GROQ_KEY) return report;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GROQ_SYSTEM },
        { role: "user", content: JSON.stringify({ report, sourceMetrics: { latestQuarter: derived.latestQuarter, score: derived.score, qualityLabel: derived.qualityLabel } }).slice(0, 12000) },
      ],
    }),
  });
  if (!res.ok) return report;
  const j = await res.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content;
  if (!content) return report;
  try {
    const polished = JSON.parse(content);
    return { ...report, ...polished, overallScore: report.overallScore, verdict: report.verdict, criteria: polished.criteria ?? report.criteria };
  } catch {
    return report;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as { symbol?: string; force?: boolean; skipGroq?: boolean };
    const symbol = (body.symbol ?? "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").trim();
    const force = !!body.force;
    if (!symbol) return jsonResponse({ error: "symbol required" }, 400);

    if (!force) {
      const hit = reportCache.get(symbol);
      if (hit && Date.now() - hit.ts < REPORT_TTL) {
        return jsonResponse({ report: hit.report, cached: true, dataQuality: hit.dataQuality });
      }
    }

    const { profile, derived, quality } = await buildBundle(symbol, force);
    if (!derived.quarters.length && !derived.annual.length) return jsonResponse({ error: "No reliable fundamentals found for symbol" }, 502);

    let report = makeReport(symbol, profile, derived);
    if (!body.skipGroq && !force) report = await polishWithGroq(report, derived);
    reportCache.set(symbol, { ts: Date.now(), report, dataQuality: quality });
    return jsonResponse({ report, cached: false, dataQuality: quality, derived: body.skipGroq ? derived : undefined });
  } catch (e) {
    console.error("minervini-analysis error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});