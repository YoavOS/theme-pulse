import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const FMP_KEY = Deno.env.get("FMP_API_KEY");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Minervini/4.0";
const REPORT_TTL = 24 * 60 * 60 * 1000;
const DB_CACHE_TTL = 24 * 60 * 60 * 1000;
const QUOTE_TTL = 24 * 60 * 60 * 1000;
const TIMESERIES_TTL = 24 * 60 * 60 * 1000;
const FMP_TTL = 24 * 60 * 60 * 1000;
const TARGET_QUARTER_TREND_COUNT = 8;
const MIN_QUARTER_TREND_COUNT = 6;
const RAW_QUARTERS_FOR_YOY = TARGET_QUARTER_TREND_COUNT + 4;
const TARGET_ANNUAL_TREND_COUNT = 4;

const reportCache = new Map<string, { ts: number; report: MinerviniReport; dataQuality: DataQuality }>();
const quoteCache = new Map<string, { ts: number; data: any }>();
const timeseriesCache = new Map<string, { ts: number; data: any }>();
const finnhubCache = new Map<string, { ts: number; data: any }>();
const fmpCache = new Map<string, { ts: number; data: any }>();
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
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  grossMarginPct: number | null;
  roePct: number | null;
  currentRatio: number | null;
  debtToEquityRatio: number | null;
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
  profile: "minervini" | "oneil" | "ryan";
  profileLabel: string;
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
  fmpCalls: number;
  dbCacheHit: boolean;
  coverage?: {
    quartersAvailable: number;
    quarterTarget: number;
    quarterlyRevenueYoY: number;
    quarterlyEpsYoY: number;
    quarterlyMargins: number;
    quarterlyCashFlow: number;
    annualAvailable: number;
    annualTarget: number;
    annualRevenueYoY: number;
    annualEpsYoY: number;
  };
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

function emptyPoint(date: string): PeriodPoint {
  return {
    date,
    revenue: null,
    eps: null,
    normalizedEps: null,
    netIncome: null,
    normalizedIncome: null,
    operatingIncome: null,
    grossProfit: null,
    totalDebt: null,
    equity: null,
    operatingCashFlow: null,
    freeCashFlow: null,
    operatingMarginPct: null,
    netMarginPct: null,
    grossMarginPct: null,
    roePct: null,
    currentRatio: null,
    debtToEquityRatio: null,
  };
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
  const eps = get("DilutedEPS");
  const netIncome = get("NetIncome");
  const normalizedIncome = get("NormalizedIncome");
  const normalizedEps = get("NormalizedDilutedEPS") ?? (
    eps !== null && netIncome !== null && normalizedIncome !== null && netIncome !== 0
      ? Math.abs(eps / netIncome) * normalizedIncome
      : null
  );
  return {
    date,
    revenue: get("TotalRevenue"),
    eps,
    normalizedEps: round(normalizedEps),
    netIncome,
    normalizedIncome: get("NormalizedIncome"),
    operatingIncome: get("OperatingIncome"),
    grossProfit: get("GrossProfit"),
    totalDebt: get("TotalDebt"),
    equity: get("StockholdersEquity"),
    operatingCashFlow: get("OperatingCashFlow"),
    freeCashFlow: get("FreeCashFlow"),
    operatingMarginPct: null,
    netMarginPct: null,
    grossMarginPct: null,
    roePct: null,
    currentRatio: null,
    debtToEquityRatio: null,
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
      operatingMargin: p.operatingMarginPct ?? (p.revenue ? pct((p.operatingIncome ?? null) !== null ? p.operatingIncome! / p.revenue : null) : null),
      netMargin: p.netMarginPct ?? (p.revenue ? pct((p.netIncome ?? null) !== null ? p.netIncome! / p.revenue : null) : null),
      normalizedNetMargin: p.revenue ? pct((p.normalizedIncome ?? null) !== null ? p.normalizedIncome! / p.revenue : null) : null,
      grossMargin: p.grossMarginPct ?? (p.revenue ? pct((p.grossProfit ?? null) !== null ? p.grossProfit! / p.revenue : null) : null),
      debtToEquity: p.debtToEquityRatio ?? (p.equity && p.equity > 0 && p.totalDebt !== null ? round(p.totalDebt / p.equity) : null),
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
      operatingMargin: p.operatingMarginPct ?? (p.revenue ? pct((p.operatingIncome ?? null) !== null ? p.operatingIncome! / p.revenue : null) : null),
      netMargin: p.netMarginPct ?? (p.revenue ? pct((p.netIncome ?? null) !== null ? p.netIncome! / p.revenue : null) : null),
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

async function fmpGet(path: string, quality: DataQuality, version: "v3" | "v4" = "v3") {
  if (!FMP_KEY) return null;
  const key = `${version}:${path}`;
  const hit = fmpCache.get(key);
  if (hit && Date.now() - hit.ts < FMP_TTL) return hit.data;
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://financialmodelingprep.com/api/${version}/${path}${sep}apikey=${FMP_KEY}`;
  try {
    const r = await fetch(url);
    quality.fmpCalls++;
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (j && !(j as any).Error && !(j as any)["Error Message"]) {
      fmpCache.set(key, { ts: Date.now(), data: j });
      return j;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchFmpBundle(symbol: string, quality: DataQuality) {
  if (!FMP_KEY) return null;
  const [incQ, incA, bsQ, bsA, cfQ, cfA, kmQ, kmA, ratiosTTM, surp, profile, instOwn] = await Promise.all([
    fmpGet(`income-statement/${symbol}?period=quarter&limit=${RAW_QUARTERS_FOR_YOY}`, quality),
    fmpGet(`income-statement/${symbol}?period=annual&limit=5`, quality),
    fmpGet(`balance-sheet-statement/${symbol}?period=quarter&limit=${RAW_QUARTERS_FOR_YOY}`, quality),
    fmpGet(`balance-sheet-statement/${symbol}?period=annual&limit=5`, quality),
    fmpGet(`cash-flow-statement/${symbol}?period=quarter&limit=${RAW_QUARTERS_FOR_YOY}`, quality),
    fmpGet(`cash-flow-statement/${symbol}?period=annual&limit=5`, quality),
    fmpGet(`key-metrics/${symbol}?period=quarter&limit=${RAW_QUARTERS_FOR_YOY}`, quality),
    fmpGet(`key-metrics/${symbol}?period=annual&limit=5`, quality),
    fmpGet(`ratios-ttm/${symbol}`, quality),
    fmpGet(`earnings-surprises/${symbol}`, quality),
    fmpGet(`profile/${symbol}`, quality),
    fmpGet(`institutional-ownership/symbol-ownership-percent?symbol=${symbol}&date=&page=0`, quality, "v4"),
  ]);
  const a = (x: any) => Array.isArray(x) ? x : [];
  const first = (x: any) => Array.isArray(x) ? x[0] : x;
  return {
    incQ: a(incQ), incA: a(incA), bsQ: a(bsQ), bsA: a(bsA), cfQ: a(cfQ), cfA: a(cfA),
    kmQ: a(kmQ), kmA: a(kmA), ratiosTTM: first(ratiosTTM), surp: a(surp),
    profile: first(profile), instOwn: a(instOwn)[0] ?? null,
  };
}

function fmpToPoints(inc: any[], bs: any[], cf: any[], ratios: any[] = [], metrics: any[] = []): PeriodPoint[] {
  const byDate = new Map<string, PeriodPoint>();
  for (const x of inc) {
    const date = x?.date; if (!date) continue;
    byDate.set(date, {
      ...emptyPoint(date),
      revenue: num(x.revenue),
      eps: num(x.epsdiluted ?? x.eps),
      normalizedEps: null,
      netIncome: num(x.netIncome),
      normalizedIncome: null,
      operatingIncome: num(x.operatingIncome),
      grossProfit: num(x.grossProfit),
    });
  }
  for (const x of bs) {
    const date = x?.date; if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    const td = num(x.totalDebt);
    row.totalDebt = td !== null ? td : ((num(x.shortTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0) || null);
    row.equity = num(x.totalStockholdersEquity ?? x.totalEquity);
    byDate.set(date, row);
  }
  for (const x of cf) {
    const date = x?.date; if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    row.operatingCashFlow = num(x.operatingCashFlow ?? x.netCashProvidedByOperatingActivities);
    const fcf = num(x.freeCashFlow);
    row.freeCashFlow = fcf !== null ? fcf : (row.operatingCashFlow !== null && num(x.capitalExpenditure) !== null ? row.operatingCashFlow + num(x.capitalExpenditure)! : null);
    byDate.set(date, row);
  }
  for (const x of ratios) {
    const date = x?.date; if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    row.operatingMarginPct = pct(num(x.operatingProfitMargin ?? x.operatingMargin));
    row.netMarginPct = pct(num(x.netProfitMargin ?? x.netMargin));
    row.grossMarginPct = pct(num(x.grossProfitMargin ?? x.grossMargin));
    row.roePct = pct(num(x.returnOnEquity ?? x.roe));
    row.currentRatio = normalizeRatio(num(x.currentRatio));
    row.debtToEquityRatio = normalizeRatio(num(x.debtEquityRatio ?? x.debtToEquity));
    byDate.set(date, row);
  }
  for (const x of metrics) {
    const date = x?.date; if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    row.roePct = row.roePct ?? pct(num(x.roe));
    row.currentRatio = row.currentRatio ?? normalizeRatio(num(x.currentRatio));
    row.debtToEquityRatio = row.debtToEquityRatio ?? normalizeRatio(num(x.debtToEquity));
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function mergePoints(primary: PeriodPoint[], fallback: PeriodPoint[]): PeriodPoint[] {
  if (!fallback.length) return primary;
  const byDate = new Map<string, PeriodPoint>();
  for (const p of fallback) byDate.set(p.date, { ...p });
  for (const p of primary) {
    const existing = byDate.get(p.date);
    if (!existing) { byDate.set(p.date, { ...p }); continue; }
    const merged: any = { ...existing };
    for (const k of Object.keys(p) as (keyof PeriodPoint)[]) {
      if ((p as any)[k] !== null && (p as any)[k] !== undefined) merged[k] = (p as any)[k];
    }
    byDate.set(p.date, merged);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
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
      ...emptyPoint(date), revenue: num(x.totalRevenue), eps: num(x.dilutedEPS), normalizedEps: null, netIncome: num(x.netIncome), normalizedIncome: null,
      operatingIncome: num(x.operatingIncome), grossProfit: num(x.grossProfit),
    });
  }
  for (const x of bsQ) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    row.totalDebt = (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0) || null;
    row.equity = num(x.totalStockholderEquity);
    byDate.set(date, row);
  }
  for (const x of cfQ) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
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
      ...emptyPoint(date), revenue: num(x.totalRevenue), eps: num(x.dilutedEPS), normalizedEps: null, netIncome: num(x.netIncome), normalizedIncome: null,
      operatingIncome: num(x.operatingIncome), grossProfit: num(x.grossProfit),
    });
  }
  for (const x of bsA) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
    row.totalDebt = (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0) || null;
    row.equity = num(x.totalStockholderEquity);
    byDate.set(date, row);
  }
  for (const x of cfA) {
    const date = x.endDate?.fmt;
    if (!date) continue;
    const row = byDate.get(date) ?? emptyPoint(date);
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
function countPresent(values: (number | null | undefined)[]) { return values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v)).length; }
function statusFrom(value: number | null, pass: boolean, fail: boolean): "pass" | "fail" | "neutral" {
  if (value === null) return "neutral";
  if (pass) return "pass";
  if (fail) return "fail";
  return "neutral";
}

function computeCoverage(quarters: QuarterTrend[], annual: AnnualTrend[]): DataQuality["coverage"] {
  const qTrend = quarters.slice(0, TARGET_QUARTER_TREND_COUNT);
  const aTrend = annual.slice(0, TARGET_ANNUAL_TREND_COUNT);
  return {
    quartersAvailable: qTrend.length,
    quarterTarget: TARGET_QUARTER_TREND_COUNT,
    quarterlyRevenueYoY: countPresent(qTrend.map(q => q.revenueYoY)),
    quarterlyEpsYoY: countPresent(qTrend.map(q => q.normalizedEpsYoY ?? q.epsYoY)),
    quarterlyMargins: countPresent(qTrend.map(q => q.operatingMargin ?? q.normalizedNetMargin ?? q.netMargin)),
    quarterlyCashFlow: countPresent(qTrend.map(q => q.operatingCashFlow)),
    annualAvailable: aTrend.length,
    annualTarget: 3,
    annualRevenueYoY: countPresent(aTrend.slice(0, 3).map(a => a.revenueYoY)),
    annualEpsYoY: countPresent(aTrend.slice(0, 3).map(a => a.normalizedEpsYoY ?? a.epsYoY)),
  };
}

function makeReport(symbol: string, profile: any, derived: any): MinerviniReport {
  const q = derived.quarters as QuarterTrend[];
  const a = derived.annual as AnnualTrend[];
  const latest = q[0];
  const revTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.revenueYoY);
  const epsTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const revQoqTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.revenueQoQ);
  const epsQoqTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.epsQoQ);
  const opMarginTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.operatingMargin ?? x.normalizedNetMargin ?? x.netMargin);
  const annRev = a.slice(0, 4).map(x => x.revenueYoY);
  const annEps = a.slice(0, 4).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const revAccel = summarizeTrend(revTrend);
  const epsAccel = summarizeTrend(epsTrend);
  const revQoqAccel = summarizeTrend(revQoqTrend);
  const epsQoqAccel = summarizeTrend(epsQoqTrend);
  const marginAccel = summarizeTrend(opMarginTrend);

  const criteria: Criterion[] = [
    {
      name: "Quarterly EPS Growth Trend",
      value: `YoY ${fmtTrend(epsTrend)} | QoQ ${fmtTrend(epsQoqTrend)}`, target: "≥25% YoY, consistent/accelerating",
      status: statusFrom(epsTrend[0], (epsTrend[0] ?? -999) >= 25 && epsAccel !== "decelerating", (epsTrend[0] ?? 999) < 0),
      comment: `Latest ${latest?.date ?? "quarter"}; YoY trend is ${epsAccel}, QoQ trend is ${epsQoqAccel}. Uses normalized/non-GAAP EPS where available.`,
    },
    {
      name: "Quarterly Sales Growth Trend",
      value: `YoY ${fmtTrend(revTrend)} | QoQ ${fmtTrend(revQoqTrend)}`, target: "≥20% YoY, consistent/accelerating",
      status: statusFrom(revTrend[0], (revTrend[0] ?? -999) >= 20 || ((revTrend[0] ?? -999) >= 8 && revAccel === "accelerating"), (revTrend[0] ?? 999) < 0),
      comment: `Latest ${latest?.date ?? "quarter"}; YoY trend is ${revAccel}, QoQ trend is ${revQoqAccel} across available reported quarters.`,
    },
    {
      name: "Historical Coverage",
      value: `${derived.coverage.quarterlyRevenueYoY}/${derived.coverage.quarterTarget} revenue YoY · ${derived.coverage.quarterlyEpsYoY}/${derived.coverage.quarterTarget} EPS YoY · ${derived.coverage.annualRevenueYoY}/${derived.coverage.annualTarget} annual rev`,
      target: "6–8 quarters + 2–3 annual trends",
      status: derived.coverage.quarterlyRevenueYoY >= MIN_QUARTER_TREND_COUNT && derived.coverage.quarterlyEpsYoY >= MIN_QUARTER_TREND_COUNT ? "pass" : derived.coverage.quarterlyRevenueYoY < 4 || derived.coverage.quarterlyEpsYoY < 4 ? "fail" : "neutral",
      comment: `Raw statements target ${RAW_QUARTERS_FOR_YOY} quarters to compute full 8-quarter YoY trends; FMP is primary, Yahoo fills missing fields only when needed.`,
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
    profile: "minervini",
    profileLabel: "Mark Minervini (SEPA Fundamentals)",
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

// ============================================================================
// William O'Neil (CAN SLIM Fundamentals)
// ============================================================================
function makeOneilReport(symbol: string, profile: any, derived: any): MinerviniReport {
  const q = derived.quarters as QuarterTrend[];
  const a = derived.annual as AnnualTrend[];
  const latest = q[0];
  const epsTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const revTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.revenueYoY);
  const annEps = a.slice(0, 4).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const annRev = a.slice(0, 4).map(x => x.revenueYoY);
  const opMargin = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.operatingMargin ?? x.netMargin);
  const epsAccel = summarizeTrend(epsTrend);
  const revAccel = summarizeTrend(revTrend);
  const marginAccel = summarizeTrend(opMargin);
  const annEpsConsistent = annEps.filter(v => (v ?? -1) >= 25).length;
  const annRevConsistent = annRev.filter(v => (v ?? -1) >= 15).length;

  let score = 0;
  if ((epsTrend[0] ?? -1) >= 25) score += 18; else if ((epsTrend[0] ?? -1) > 0) score += 8;
  if (epsAccel === "accelerating") score += 8; else if (epsAccel === "stable") score += 4;
  if ((revTrend[0] ?? -1) >= 20) score += 12; else if ((revTrend[0] ?? -1) >= 8) score += 7;
  if (revAccel === "accelerating") score += 6; else if (revAccel === "stable") score += 3;
  score += Math.min(12, annEpsConsistent * 4);
  score += Math.min(8, annRevConsistent * 3);
  if ((derived.roePct ?? -1) >= 17) score += 8; else if ((derived.roePct ?? -1) >= 10) score += 4;
  const m = opMargin[0] ?? -1;
  if (m >= 15 && marginAccel !== "decelerating") score += 8; else if (m > 0) score += 4;
  if ((derived.debtToEquity ?? 99) < 1.0) score += 6; else if ((derived.debtToEquity ?? 99) < 2.0) score += 3;
  if ((derived.institutionalOwnershipPct ?? 0) > 50) score += 7; else if ((derived.institutionalOwnershipPct ?? 0) > 25) score += 4;
  if ((derived.epsBeatRatePct ?? 0) >= 75) score += 7; else if ((derived.epsBeatRatePct ?? 0) >= 50) score += 3;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const criteria: Criterion[] = [
    { name: "Current Quarter EPS Growth", value: fmtPct(epsTrend[0]), target: "≥25% YoY, accelerating",
      status: statusFrom(epsTrend[0], (epsTrend[0] ?? -1) >= 25, (epsTrend[0] ?? 99) < 10),
      comment: `EPS trend ${epsAccel}. Series: ${fmtTrend(epsTrend)}.` },
    { name: "Annual EPS Growth (Consistency)", value: fmtTrend(annEps), target: "≥25% across multiple years",
      status: statusFrom(annEps[0], annEpsConsistent >= 2, annEpsConsistent === 0 && (annEps[0] ?? 99) < 10),
      comment: `${annEpsConsistent} of ${annEps.length} reported years cleared 25%.` },
    { name: "Quarterly Sales Growth", value: fmtPct(revTrend[0]), target: "Strong & accelerating",
      status: statusFrom(revTrend[0], (revTrend[0] ?? -1) >= 20 && revAccel !== "decelerating", (revTrend[0] ?? 99) < 5),
      comment: `Sales trend ${revAccel}. Series: ${fmtTrend(revTrend)}.` },
    { name: "Annual Sales Growth", value: fmtTrend(annRev), target: "Positive & consistent",
      status: statusFrom(annRev[0], annRevConsistent >= 2, (annRev[0] ?? 99) < 0),
      comment: `${annRevConsistent} of ${annRev.length} years grew ≥15%.` },
    { name: "ROE", value: fmtPct(derived.roePct), target: "≥17%",
      status: statusFrom(derived.roePct, (derived.roePct ?? 0) >= 17, (derived.roePct ?? 99) < 8),
      comment: "O'Neil emphasizes high return on equity as a sign of capable management." },
    { name: "Net / Operating Margin Trend", value: fmtTrend(opMargin), target: "Positive & expanding",
      status: statusFrom(opMargin[0], (opMargin[0] ?? -1) > 10 && marginAccel !== "decelerating", (opMargin[0] ?? 99) < 0),
      comment: `Operating margin trend is ${marginAccel}.` },
    { name: "Debt / Equity", value: fmtRatio(derived.debtToEquity), target: "Lower is better (<1.0 ideal)",
      status: statusFrom(derived.debtToEquity, (derived.debtToEquity ?? 99) < 1.0, (derived.debtToEquity ?? 0) > 2.5),
      comment: "Lower leverage preferred for leading growth stocks." },
    { name: "Institutional Sponsorship", value: fmtPct(derived.institutionalOwnershipPct), target: ">50% (rising)",
      status: statusFrom(derived.institutionalOwnershipPct, (derived.institutionalOwnershipPct ?? 0) > 50, (derived.institutionalOwnershipPct ?? 99) < 20),
      comment: "Snapshot only; rising sponsorship is the qualitative bonus O'Neil looks for." },
    { name: "Earnings Surprise History", value: derived.epsBeatRatePct === null ? "N/A" : `${derived.epsBeatRatePct}% beat rate`, target: "Consistent positive surprises",
      status: statusFrom(derived.epsBeatRatePct, (derived.epsBeatRatePct ?? 0) >= 75, (derived.epsBeatRatePct ?? 99) < 40),
      comment: `Recent surprises: ${derived.epsSurprisesRecent.length ? derived.epsSurprisesRecent.map(fmtPct).join(" / ") : "N/A"}.` },
  ];

  const verdict = score >= 80 ? "PASS" : score >= 60 ? "BORDERLINE" : "FAIL";
  const bullCase = [
    (epsTrend[0] ?? -1) >= 25 ? `Latest EPS growth ${fmtPct(epsTrend[0])} clears the 25% CAN SLIM bar.` : `EPS growth below the 25% CAN SLIM threshold.`,
    annEpsConsistent >= 2 ? `${annEpsConsistent} recent years of ≥25% annual EPS growth show durable earnings power.` : `Annual EPS consistency below CAN SLIM ideal.`,
    (derived.roePct ?? -1) >= 17 ? `ROE of ${fmtPct(derived.roePct)} signals capital-efficient management.` : `ROE under 17% leaves room for improvement.`,
  ];
  const bearCase = [
    epsAccel === "decelerating" ? "Quarterly EPS growth is decelerating — biggest red flag for CAN SLIM." : "EPS acceleration not the primary risk.",
    (derived.debtToEquity ?? 0) > 1.5 ? `Leverage at ${fmtRatio(derived.debtToEquity)} is high for a CAN SLIM candidate.` : "Balance sheet is acceptable.",
    (derived.institutionalOwnershipPct ?? 100) < 25 ? "Limited institutional sponsorship reduces O'Neil-style edge." : "Sponsorship is adequate.",
  ];
  return {
    symbol, companyName: profile.name ?? symbol, sector: profile.sector ?? null,
    profile: "oneil", profileLabel: "William O'Neil (CAN SLIM Fundamentals)",
    overallScore: score, verdict,
    headline: `${symbol} scores ${score}/100 on CAN SLIM fundamentals. EPS ${fmtPct(epsTrend[0])} (${epsAccel}), sales ${fmtPct(revTrend[0])} (${revAccel}), ROE ${fmtPct(derived.roePct)}.`,
    criteria, bullCase, bearCase,
    finalVerdict: verdict === "PASS"
      ? "Passes O'Neil CAN SLIM fundamentals with strong growth, profitability, and sponsorship."
      : verdict === "BORDERLINE"
        ? "Borderline CAN SLIM candidate: some criteria met but growth consistency or sponsorship needs improvement."
        : "Fails O'Neil CAN SLIM fundamentals due to weak earnings growth, profitability, or institutional support.",
  };
}

// ============================================================================
// David Ryan (Earnings Momentum & Acceleration)
// ============================================================================
function makeRyanReport(symbol: string, profile: any, derived: any): MinerviniReport {
  const q = derived.quarters as QuarterTrend[];
  const latest = q[0];
  const epsTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.normalizedEpsYoY ?? x.epsYoY);
  const revTrend = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.revenueYoY);
  const opMargin = q.slice(0, TARGET_QUARTER_TREND_COUNT).map(x => x.operatingMargin ?? x.netMargin);
  const epsAccel = summarizeTrend(epsTrend);
  const revAccel = summarizeTrend(revTrend);
  const marginAccel = summarizeTrend(opMargin);

  // Sequential acceleration: count consecutive quarters where EPS YoY > previous quarter's YoY
  let consecutiveAccelQ = 0;
  for (let i = 0; i < epsTrend.length - 1; i++) {
    if (epsTrend[i] !== null && epsTrend[i + 1] !== null && (epsTrend[i] as number) > (epsTrend[i + 1] as number)) consecutiveAccelQ++;
    else break;
  }
  const epsThisVsPrior = (epsTrend[0] ?? null) !== null && (epsTrend[1] ?? null) !== null ? round((epsTrend[0] as number) - (epsTrend[1] as number)) : null;
  const epsThisVsYearAgo = (epsTrend[0] ?? null) !== null && (epsTrend[4] ?? null) !== null ? round((epsTrend[0] as number) - (epsTrend[4] as number)) : null;
  const bigSurprises = (derived.epsSurprisesRecent as number[]).filter(v => v >= 10).length;
  const surprisesCount = (derived.epsSurprisesRecent as number[]).length;

  let score = 0;
  if ((epsThisVsPrior ?? -999) >= 5) score += 14; else if ((epsThisVsPrior ?? -999) > 0) score += 7;
  if ((epsThisVsYearAgo ?? -999) >= 5) score += 10; else if ((epsThisVsYearAgo ?? -999) > 0) score += 5;
  if (consecutiveAccelQ >= 3) score += 14; else if (consecutiveAccelQ >= 2) score += 9; else if (consecutiveAccelQ >= 1) score += 4;
  if ((epsTrend[0] ?? -1) >= 50) score += 10; else if ((epsTrend[0] ?? -1) >= 25) score += 6;
  if (revAccel === "accelerating") score += 10; else if (revAccel === "stable" && (revTrend[0] ?? -1) >= 15) score += 6;
  if ((revTrend[0] ?? -1) >= 25) score += 6; else if ((revTrend[0] ?? -1) >= 10) score += 3;
  if (surprisesCount && bigSurprises / surprisesCount >= 0.5) score += 10; else if (bigSurprises >= 1) score += 5;
  if ((derived.roePct ?? -1) >= 20) score += 8; else if ((derived.roePct ?? -1) >= 12) score += 4;
  const m = opMargin[0] ?? -1;
  if (m >= 15 && marginAccel === "accelerating") score += 8; else if (m > 5) score += 4;
  if ((derived.epsBeatRatePct ?? 0) >= 75) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const criteria: Criterion[] = [
    { name: "EPS vs. Prior Quarter (Acceleration)", value: epsThisVsPrior === null ? "N/A" : `${epsThisVsPrior > 0 ? "+" : ""}${epsThisVsPrior} pp`, target: "Latest > prior quarter YoY",
      status: statusFrom(epsThisVsPrior, (epsThisVsPrior ?? -999) >= 5, (epsThisVsPrior ?? 999) < -5),
      comment: `Latest EPS YoY ${fmtPct(epsTrend[0])} vs prior quarter ${fmtPct(epsTrend[1])}.` },
    { name: "EPS vs. Year-Ago Quarter (Acceleration)", value: epsThisVsYearAgo === null ? "N/A" : `${epsThisVsYearAgo > 0 ? "+" : ""}${epsThisVsYearAgo} pp`, target: "Latest > year-ago quarter YoY",
      status: statusFrom(epsThisVsYearAgo, (epsThisVsYearAgo ?? -999) >= 5, (epsThisVsYearAgo ?? 999) < -5),
      comment: `Sequential improvement vs same quarter a year ago.` },
    { name: "Consecutive Accelerating EPS Quarters", value: `${consecutiveAccelQ}`, target: "≥3 in a row",
      status: consecutiveAccelQ >= 3 ? "pass" : consecutiveAccelQ >= 1 ? "neutral" : "fail",
      comment: `EPS YoY series: ${fmtTrend(epsTrend)}.` },
    { name: "Latest EPS Growth Magnitude", value: fmtPct(epsTrend[0]), target: "Strong (≥25%, ideal ≥50%)",
      status: statusFrom(epsTrend[0], (epsTrend[0] ?? -1) >= 25, (epsTrend[0] ?? 99) < 10),
      comment: `Trend label: ${epsAccel}.` },
    { name: "Sales Acceleration", value: `${fmtPct(revTrend[0])} (${revAccel})`, target: "Clear acceleration in recent quarters",
      status: statusFrom(revTrend[0], revAccel === "accelerating" && (revTrend[0] ?? -1) >= 10, revAccel === "decelerating"),
      comment: `Series: ${fmtTrend(revTrend)}.` },
    { name: "Big Earnings Surprises", value: surprisesCount ? `${bigSurprises}/${surprisesCount} ≥10%` : "N/A", target: "Consistent ≥10% positive surprises",
      status: !surprisesCount ? "neutral" : bigSurprises / surprisesCount >= 0.5 ? "pass" : bigSurprises === 0 ? "fail" : "neutral",
      comment: `Recent surprises: ${surprisesCount ? (derived.epsSurprisesRecent as number[]).map(fmtPct).join(" / ") : "N/A"}.` },
    { name: "ROE", value: fmtPct(derived.roePct), target: "High and/or improving (≥20%)",
      status: statusFrom(derived.roePct, (derived.roePct ?? 0) >= 20, (derived.roePct ?? 99) < 10),
      comment: "Ryan favors high earnings power on equity." },
    { name: "Operating Margin Expansion", value: fmtTrend(opMargin), target: "Expanding margins",
      status: statusFrom(opMargin[0], (opMargin[0] ?? -1) > 10 && marginAccel === "accelerating", marginAccel === "decelerating"),
      comment: `Margin trend is ${marginAccel}.` },
    { name: "Earnings Power Consistency", value: derived.epsBeatRatePct === null ? "N/A" : `${derived.epsBeatRatePct}% beat rate`, target: "Reliable EPS delivery",
      status: statusFrom(derived.epsBeatRatePct, (derived.epsBeatRatePct ?? 0) >= 75, (derived.epsBeatRatePct ?? 99) < 50),
      comment: "Consistent ability to beat expectations is core to Ryan's edge." },
  ];

  const verdict = score >= 80 ? "PASS" : score >= 60 ? "BORDERLINE" : "FAIL";
  const bullCase = [
    consecutiveAccelQ >= 2 ? `${consecutiveAccelQ} consecutive quarters of accelerating EPS growth — Ryan's primary signal.` : `EPS acceleration sequence is short (${consecutiveAccelQ}).`,
    revAccel === "accelerating" ? `Revenue is also accelerating (${fmtPct(revTrend[0])}), confirming organic momentum.` : `Revenue growth not yet accelerating.`,
    bigSurprises >= 2 ? `${bigSurprises} large earnings beats (≥10%) show under-the-radar earnings power.` : `Earnings surprises are modest.`,
  ];
  const bearCase = [
    epsAccel === "decelerating" ? "EPS growth is decelerating — Ryan would avoid this setup." : "EPS deceleration is not the leading concern.",
    (epsThisVsPrior ?? 0) < 0 ? "Latest EPS growth is below the prior quarter, breaking the acceleration thesis." : "Sequential EPS pattern is intact.",
    marginAccel === "decelerating" ? "Margins are compressing, suggesting earnings power may be peaking." : "Margins are not a red flag.",
  ];
  return {
    symbol, companyName: profile.name ?? symbol, sector: profile.sector ?? null,
    profile: "ryan", profileLabel: "David Ryan (Earnings Momentum & Acceleration)",
    overallScore: score, verdict,
    headline: `${symbol} scores ${score}/100 on Ryan momentum: ${consecutiveAccelQ} consecutive accelerating EPS quarters, latest EPS ${fmtPct(epsTrend[0])}, sales ${revAccel}.`,
    criteria, bullCase, bearCase,
    finalVerdict: verdict === "PASS"
      ? "Passes David Ryan momentum criteria with clear earnings acceleration, big surprises, and improving fundamentals."
      : verdict === "BORDERLINE"
        ? "Borderline Ryan candidate: some acceleration is present but the pattern is not yet conclusive."
        : "Fails Ryan momentum: insufficient or decelerating earnings growth and weak surprise/margin support.",
  };
}

function scoreDerived(derived: any) {
  const latest = derived.quarters[0] as QuarterTrend | undefined;
  const epsTrend = derived.quarters.slice(0, TARGET_QUARTER_TREND_COUNT).map((x: QuarterTrend) => x.normalizedEpsYoY ?? x.epsYoY);
  const revTrend = derived.quarters.slice(0, TARGET_QUARTER_TREND_COUNT).map((x: QuarterTrend) => x.revenueYoY);
  const marginTrend = derived.quarters.slice(0, TARGET_QUARTER_TREND_COUNT).map((x: QuarterTrend) => x.operatingMargin ?? x.normalizedNetMargin ?? x.netMargin);
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
  const quality: DataQuality = { sources: [], warnings: [], yahooCalls: 0, finnhubCalls: 0, fmpCalls: 0, dbCacheHit: false };
  const sb = createClient(SB_URL, SB_KEY);
  const { stockFund, fundCache } = force ? { stockFund: null, fundCache: null } : await readCachedFundamentals(sb, symbol, quality);

  // ----- Primary source: FMP (in parallel with DB cache read above) -----
  const fmp = await fetchFmpBundle(symbol, quality);
  if (fmp) quality.sources.push("FMP statements & ratios");

  const fmpQuartersRaw = fmp ? fmpToPoints(fmp.incQ, fmp.bsQ, fmp.cfQ, fmp.ratiosQ, fmp.kmQ) : [];
  const fmpAnnualRaw = fmp ? fmpToPoints(fmp.incA, fmp.bsA, fmp.cfA, fmp.ratiosA, fmp.kmA) : [];
  const fmpQuarterProbe = enrichQuarters(fmpQuartersRaw, { revenueYoY: null, epsYoY: null });
  const fmpAnnualProbe = enrichAnnual(fmpAnnualRaw);
  const fmpQuarterCoverage = computeCoverage(fmpQuarterProbe, fmpAnnualProbe);
  const fmpHasQuarters = fmpQuartersRaw.length >= RAW_QUARTERS_FOR_YOY
    && fmpQuarterCoverage.quarterlyRevenueYoY >= MIN_QUARTER_TREND_COUNT
    && fmpQuarterCoverage.quarterlyEpsYoY >= MIN_QUARTER_TREND_COUNT;
  const fmpHasAnnual = fmpAnnualRaw.length >= 4
    && fmpQuarterCoverage.annualRevenueYoY >= 2
    && fmpQuarterCoverage.annualEpsYoY >= 2;

  // ----- Fallback / supplement: Yahoo + Finnhub only when FMP is short -----
  const needYahooStatements = !fmpHasQuarters || !fmpHasAnnual;
  const needAnyYahoo = force || needYahooStatements || !fmp;
  const needFinnhub = !fmp && (force || !stockFund);

  const [quote, timeseries, fh] = await Promise.all([
    needAnyYahoo ? fetchQuoteSummary(symbol, quality) : Promise.resolve(null),
    needYahooStatements ? fetchTimeseries(symbol, quality) : Promise.resolve(null),
    needFinnhub ? fetchFinnhubMetric(symbol, quality) : Promise.resolve(null),
  ]);

  if (quote) quality.sources.push("Yahoo quoteSummary");
  if (timeseries) quality.sources.push("Yahoo fundamentals-timeseries");
  if (fh?.metric) quality.sources.push("Finnhub metric fallback");

  const fd = quote?.financialData ?? {};
  const ks = quote?.defaultKeyStatistics ?? {};
  const profile = {
    name: fmp?.profile?.companyName ?? quote?.price?.longName ?? quote?.price?.shortName ?? stockFund?.company_name ?? symbol,
    sector: fmp?.profile?.sector ?? quote?.assetProfile?.sector ?? quote?.summaryProfile?.sector ?? stockFund?.sector ?? fundCache?.sector ?? null,
  };
  const yahooGrowth = {
    revenueYoY: pct(num(fd.revenueGrowth)),
    epsYoY: pct(num(fd.earningsGrowth) ?? num(ks.earningsQuarterlyGrowth)),
  };

  // Yahoo statements (only if needed)
  let yQuarters: PeriodPoint[] = [];
  let yAnnual: PeriodPoint[] = [];
  if (timeseries) {
    const qDates = allDates(timeseries, "quarterly");
    const aDates = allDates(timeseries, "annual");
    yQuarters = qDates.map(d => pointFor(d, timeseries, "quarterly"));
    yAnnual = aDates.map(d => pointFor(d, timeseries, "annual"));
  }
  if (yQuarters.length < 4 && quote) {
    const fb = fallbackQuartersFromQuote(quote, yahooGrowth);
    yQuarters = mergePoints(yQuarters, fb);
  }
  if (yAnnual.length < 2 && quote) {
    yAnnual = mergePoints(yAnnual, fallbackAnnualFromQuote(quote));
  }

  // FMP primary, Yahoo fills gaps per-date and per-field
  const quarters = enrichQuarters(mergePoints(fmpQuartersRaw, yQuarters), yahooGrowth).slice(0, RAW_QUARTERS_FOR_YOY);
  const annual = enrichAnnual(mergePoints(fmpAnnualRaw, yAnnual)).slice(0, 5);
  quality.coverage = computeCoverage(quarters, annual);

  const fhMetric = fh?.metric ?? {};
  const latest = quarters[0];

  // FMP key-metrics latest quarter (richer than ratios-ttm)
  const kmLatest = fmp?.kmQ?.[0] ?? null;
  const ratiosTTM = fmp?.ratiosTTM ?? null;

  let debtToEquity = latest?.debtToEquity
    ?? normalizeRatio(num(kmLatest?.debtToEquity))
    ?? normalizeRatio(num(ratiosTTM?.debtEquityRatioTTM))
    ?? normalizeRatio(num(fd.debtToEquity))
    ?? normalizeRatio(stockFund?.debt_to_equity ?? null)
    ?? normalizeRatio(fundCache?.debt_to_equity ?? null)
    ?? normalizeRatio(num(fhMetric.totalDebtToEquityQuarterly ?? fhMetric.totalDebtToEquityAnnual ?? fhMetric["totalDebt/totalEquityQuarterly"]));
  if (debtToEquity !== null && debtToEquity > 20) {
    quality.warnings.push(`Debt/equity suspicious after normalization (${debtToEquity}x); marked unavailable.`);
    debtToEquity = null;
  }

  const roePct = pct(num(kmLatest?.roe))
    ?? pct(num(ratiosTTM?.returnOnEquityTTM))
    ?? pct(num(fd.returnOnEquity))
    ?? stockFund?.roe
    ?? fundCache?.roe
    ?? num(fhMetric.roeTTM ?? fhMetric.roeRfy)
    ?? null;

  // FMP institutional ownership (v4) returns ownershipPercent already as percent
  const fmpInstPct = num(fmp?.instOwn?.ownershipPercent);
  const institutionalOwnershipPct = normalizeOwnershipPct(
    fmpInstPct ?? num(ks.heldPercentInstitutions) ?? fundCache?.institutional_ownership_pct ?? num(fhMetric.institutionalOwnershipPercentage)
  );

  const currentRatio = normalizeRatio(
    num(kmLatest?.currentRatio) ?? num(ratiosTTM?.currentRatioTTM) ?? num(fd.currentRatio)
    ?? stockFund?.current_ratio ?? fundCache?.current_ratio
    ?? num(fhMetric.currentRatioQuarterly ?? fhMetric.currentRatioAnnual)
  );

  const cashFlowValues = quarters.slice(0, TARGET_QUARTER_TREND_COUNT).map(q => q.operatingCashFlow).filter((v): v is number => v !== null);
  const positiveCashFlowCount = cashFlowValues.filter(v => v > 0).length;

  // Earnings surprises — prefer FMP (clean & wide)
  let surprises: (number | null)[] = [];
  let beatRate: number | null = null;
  if (fmp?.surp?.length) {
    const rows = fmp.surp.slice(0, 8);
    surprises = rows.map((e: any) => {
      const act = num(e.actualEarningResult); const est = num(e.estimatedEarning);
      if (act === null || est === null || est === 0) return null;
      return round(((act - est) / Math.abs(est)) * 100);
    }).filter((v: number | null) => v !== null);
    const beats = rows.filter((e: any) => num(e.actualEarningResult) !== null && num(e.estimatedEarning) !== null && num(e.actualEarningResult)! >= num(e.estimatedEarning)!).length;
    beatRate = rows.length ? Math.round((beats / rows.length) * 100) : null;
  } else {
    const earningsHistory = quote?.earningsHistory?.history ?? [];
    surprises = earningsHistory.map((e: any) => pct(num(e.surprisePercent))).filter((v: number | null) => v !== null).slice(-8);
    const beatCount = earningsHistory.filter((e: any) => num(e.epsActual) !== null && num(e.epsEstimate) !== null && num(e.epsActual)! >= num(e.epsEstimate)!).length;
    beatRate = earningsHistory.length ? Math.round((beatCount / earningsHistory.length) * 100) : null;
  }

  if ((quality.coverage?.quarterlyRevenueYoY ?? 0) < MIN_QUARTER_TREND_COUNT || (quality.coverage?.quarterlyEpsYoY ?? 0) < MIN_QUARTER_TREND_COUNT) {
    quality.warnings.push(`Historical coverage below target: revenue YoY ${quality.coverage?.quarterlyRevenueYoY ?? 0}/${TARGET_QUARTER_TREND_COUNT}, EPS YoY ${quality.coverage?.quarterlyEpsYoY ?? 0}/${TARGET_QUARTER_TREND_COUNT}.`);
  }
  if (institutionalOwnershipPct !== null && institutionalOwnershipPct < 5 && fmpInstPct === null && (ks.heldPercentInstitutions?.raw ?? null) !== null) quality.warnings.push("Institutional ownership appears unusually low; source may be incomplete for this ticker.");
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
    epsBeatRatePct: beatRate,
    epsSurprisesRecent: surprises,
    warnings: quality.warnings,
    coverage: quality.coverage,
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

interface BundleResponse {
  reports: { minervini: MinerviniReport; oneil: MinerviniReport; ryan: MinerviniReport };
  cumulative: { averageScore: number; verdict: "PASS" | "FAIL" | "BORDERLINE"; passCount: number; profileCount: number };
}

const multiReportCache = new Map<string, { ts: number; data: BundleResponse; dataQuality: DataQuality }>();

function buildAll(symbol: string, profileMeta: any, derived: any): BundleResponse {
  const minervini = makeReport(symbol, profileMeta, derived);
  const oneil = makeOneilReport(symbol, profileMeta, derived);
  const ryan = makeRyanReport(symbol, profileMeta, derived);
  const all = [minervini, oneil, ryan];
  const averageScore = Math.round(all.reduce((s, r) => s + r.overallScore, 0) / all.length);
  const passCount = all.filter(r => r.verdict === "PASS").length;
  const verdict: "PASS" | "FAIL" | "BORDERLINE" = averageScore >= 80 ? "PASS" : averageScore >= 60 ? "BORDERLINE" : "FAIL";
  return { reports: { minervini, oneil, ryan }, cumulative: { averageScore, verdict, passCount, profileCount: all.length } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as { symbol?: string; force?: boolean };
    const symbol = (body.symbol ?? "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").trim();
    const force = !!body.force;
    if (!symbol) return jsonResponse({ error: "symbol required" }, 400);

    if (!force) {
      const hit = multiReportCache.get(symbol);
      if (hit && Date.now() - hit.ts < REPORT_TTL) {
        return jsonResponse({ ...hit.data, cached: true, dataQuality: hit.dataQuality });
      }
    }

    const { profile, derived, quality } = await buildBundle(symbol, force);
    if (!derived.quarters.length && !derived.annual.length) return jsonResponse({ error: "No reliable fundamentals found for symbol" }, 502);

    const data = buildAll(symbol, profile, derived);
    multiReportCache.set(symbol, { ts: Date.now(), data, dataQuality: quality });
    return jsonResponse({ ...data, cached: false, dataQuality: quality });
  } catch (e) {
    console.error("minervini-analysis error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});