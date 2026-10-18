// ─────────────────────────────────────────────────────────────
// SEC EDGAR XBRL "company facts" → clean 3-month quarters.
//
// Free, keyless, authoritative (the filings themselves), ~10+ years deep.
// 10-Qs report the quarter and/or year-to-date; the 4th quarter only exists
// inside the 10-K year. Every fact carries its own start/end dates, so each
// quarter is either reported directly (≈3-month duration) or derived:
//   year-to-date − previous year-to-date of the same fiscal year, or
//   full year − the three earlier quarters.
// Balance-sheet items are instants (value at the quarter end).
// US domestic filers only (10-Q/10-K); foreign 20-F/40-F filers have no quarters.
// ─────────────────────────────────────────────────────────────

export interface SecFact { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string; filed?: string; frame?: string }
export interface SecQuarter {
  end: string; start: string;
  revenue: number | null; netIncome: number | null; eps: number | null; operatingIncome: number | null; grossProfit: number | null;
  operatingCashFlow: number | null; capex: number | null;
  equity: number | null; debt: number | null; currentAssets: number | null; currentLiabilities: number | null;
  derived: string[];          // fields that were computed from year-to-date / annual figures
}

const DAY = 86_400_000;
const dur = (f: SecFact) => (f.start ? (Date.parse(f.end) - Date.parse(f.start)) / DAY : 0);

/** Concept preference lists (first concept with data wins, per period). */
export const CONCEPTS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  operatingIncome: ["OperatingIncomeLoss"],
  grossProfit: ["GrossProfit"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  debtLong: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"],
  debtShort: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
} as const;

type Facts = Record<string, { units?: Record<string, SecFact[]> }>;

function factsFor(gaap: Facts, names: readonly string[], unitPref: string[]): SecFact[][] {
  const out: SecFact[][] = [];
  for (const n of names) {
    const u = gaap[n]?.units;
    if (!u) continue;
    const key = unitPref.find((k) => u[k]?.length) ?? Object.keys(u)[0];
    if (key && u[key]?.length) out.push(u[key]);
  }
  return out;
}

/** Latest-filed value per (start,end) — amendments and later comparatives win. */
function byPeriod(list: SecFact[]) {
  const m = new Map<string, SecFact>();
  for (const f of list) {
    if (!/^10-[QK]/.test(f.form ?? "10-")) continue;
    const k = `${f.start ?? ""}|${f.end}`;
    const prev = m.get(k);
    if (!prev || (f.filed ?? "") > (prev.filed ?? "")) m.set(k, f);
  }
  return [...m.values()];
}

/** 3-month value for the quarter ending `end` from duration facts (direct or derived). */
function quarterValue(facts: SecFact[], end: string): { v: number | null; derived: boolean } {
  const atEnd = facts.filter((f) => f.end === end && f.start);
  const direct = atEnd.find((f) => dur(f) >= 75 && dur(f) <= 105);
  if (direct) return { v: direct.val, derived: false };
  for (const ytd of atEnd.sort((a, b) => dur(a) - dur(b))) {
    // previous year-to-date of the same fiscal year, ending ~3 months earlier
    const prev = facts.find((f) => f.start === ytd.start && f.end < end && (Date.parse(end) - Date.parse(f.end)) / DAY >= 75 && (Date.parse(end) - Date.parse(f.end)) / DAY <= 105);
    if (prev) return { v: Math.round((ytd.val - prev.val) * 1e4) / 1e4, derived: true };
    // full year minus three 3-month quarters inside it
    if (dur(ytd) > 330) {
      const qs = facts.filter((f) => f.start && f.start >= ytd.start! && f.end < end && dur(f) >= 75 && dur(f) <= 105);
      const uniq = new Map(qs.map((f) => [f.end, f]));
      if (uniq.size === 3) return { v: Math.round((ytd.val - [...uniq.values()].reduce((t, f) => t + f.val, 0)) * 1e4) / 1e4, derived: true };
    }
  }
  return { v: null, derived: false };
}

function instantValue(facts: SecFact[], end: string): number | null {
  const f = facts.find((x) => !x.start && x.end === end);
  return f ? f.val : null;
}

/** Quarter ends present in the filings (any 10-Q/10-K period end), newest first. */
function quarterEnds(all: SecFact[][]): string[] {
  const s = new Set<string>();
  for (const list of all) for (const f of list) if (f.start && /^10-[QK]/.test(f.form ?? "") && dur(f) >= 75) s.add(f.end);
  // collapse ends within 10 days of each other (52/53-week calendars)
  const ends = [...s].sort().reverse();
  const out: string[] = [];
  for (const e of ends) if (!out.length || (Date.parse(out[out.length - 1]) - Date.parse(e)) / DAY > 40) out.push(e);
  return out;
}

export function parseCompanyFacts(json: { facts?: Record<string, Facts> }, maxQuarters = 14): SecQuarter[] {
  const gaap = json?.facts?.["us-gaap"];
  if (!gaap) return [];
  const pick = (names: readonly string[], unit: string[]) => factsFor(gaap, names, unit).map(byPeriod);
  const usd = ["USD"], eps = ["USD/shares", "USD-per-shares"];
  const series = {
    revenue: pick(CONCEPTS.revenue, usd), netIncome: pick(CONCEPTS.netIncome, usd), eps: pick(CONCEPTS.eps, eps),
    operatingIncome: pick(CONCEPTS.operatingIncome, usd), grossProfit: pick(CONCEPTS.grossProfit, usd),
    operatingCashFlow: pick(CONCEPTS.operatingCashFlow, usd), capex: pick(CONCEPTS.capex, usd),
    equity: pick(CONCEPTS.equity, usd), debtLong: pick(CONCEPTS.debtLong, usd), debtShort: pick(CONCEPTS.debtShort, usd),
    currentAssets: pick(CONCEPTS.currentAssets, usd), currentLiabilities: pick(CONCEPTS.currentLiabilities, usd),
  };
  const ends = quarterEnds([...series.revenue, ...series.netIncome, ...series.eps]).slice(0, maxQuarters);
  const flow = (lists: SecFact[][], end: string) => {
    for (const l of lists) { const r = quarterValue(l, end); if (r.v !== null) return r; }
    return { v: null, derived: false };
  };
  const inst = (lists: SecFact[][], end: string) => {
    for (const l of lists) { const v = instantValue(l, end); if (v !== null) return v; }
    return null;
  };
  return ends.map((end) => {
    const derived: string[] = [];
    const f = (k: keyof typeof series) => { const r = flow(series[k], end); if (r.derived) derived.push(k); return r.v; };
    const dl = inst(series.debtLong, end), ds = inst(series.debtShort, end);
    const startGuess = new Date(Date.parse(end) - 91 * DAY).toISOString().slice(0, 10);
    return {
      end, start: startGuess,
      revenue: f("revenue"), netIncome: f("netIncome"), eps: f("eps"), operatingIncome: f("operatingIncome"), grossProfit: f("grossProfit"),
      operatingCashFlow: f("operatingCashFlow"), capex: f("capex"),
      equity: inst(series.equity, end), debt: dl === null && ds === null ? null : (dl ?? 0) + (ds ?? 0),
      currentAssets: inst(series.currentAssets, end), currentLiabilities: inst(series.currentLiabilities, end),
      derived,
    };
  });
}

/** Fiscal years from 10-K full-year facts (≈ 1-year durations), newest first. */
export function parseCompanyFactsAnnual(json: { facts?: Record<string, Facts> }, maxYears = 6): SecQuarter[] {
  const gaap = json?.facts?.["us-gaap"];
  if (!gaap) return [];
  const usd = ["USD"], epsU = ["USD/shares", "USD-per-shares"];
  const lists = (names: readonly string[], unit: string[]) => factsFor(gaap, names, unit).map(byPeriod);
  const fy = (names: readonly string[], unit: string[], end: string) => {
    for (const l of lists(names, unit)) { const f = l.find((x) => x.end === end && dur(x) >= 350 && dur(x) <= 380); if (f) return f.val; }
    return null;
  };
  const inst = (names: readonly string[], end: string) => {
    for (const l of lists(names, usd)) { const f = l.find((x) => !x.start && x.end === end); if (f) return f.val; }
    return null;
  };
  const ends = new Set<string>();
  for (const l of [...lists(CONCEPTS.revenue, usd), ...lists(CONCEPTS.netIncome, usd)]) for (const f of l) if (dur(f) >= 350 && dur(f) <= 380 && /^10-K/.test(f.form ?? "")) ends.add(f.end);
  return [...ends].sort().reverse().slice(0, maxYears).map((end) => {
    const dl = inst(CONCEPTS.debtLong, end), ds = inst(CONCEPTS.debtShort, end);
    return {
      end, start: new Date(Date.parse(end) - 364 * DAY).toISOString().slice(0, 10),
      revenue: fy(CONCEPTS.revenue, usd, end), netIncome: fy(CONCEPTS.netIncome, usd, end), eps: fy(CONCEPTS.eps, epsU, end),
      operatingIncome: fy(CONCEPTS.operatingIncome, usd, end), grossProfit: fy(CONCEPTS.grossProfit, usd, end),
      operatingCashFlow: fy(CONCEPTS.operatingCashFlow, usd, end), capex: fy(CONCEPTS.capex, usd, end),
      equity: inst(CONCEPTS.equity, end), debt: dl === null && ds === null ? null : (dl ?? 0) + (ds ?? 0),
      currentAssets: inst(CONCEPTS.currentAssets, end), currentLiabilities: inst(CONCEPTS.currentLiabilities, end), derived: [],
    };
  });
}

// ── network (edge function only) ─────────────────────────────────
const SEC_UA = "ThemePulse research app (contact: noreply@anthropic.com)";
let tickerMap: { at: number; m: Map<string, number> } | null = null;

export async function secCik(symbol: string): Promise<number | null> {
  if (!tickerMap || Date.now() - tickerMap.at > 24 * 3600_000) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const j = await r.json() as Record<string, { cik_str: number; ticker: string }>;
    const m = new Map<string, number>();
    for (const v of Object.values(j)) m.set(v.ticker.toUpperCase(), v.cik_str);
    tickerMap = { at: Date.now(), m };
  }
  return tickerMap.m.get(symbol.toUpperCase().replace(".", "-")) ?? tickerMap.m.get(symbol.toUpperCase()) ?? null;
}

const secCache = new Map<string, { at: number; v: { quarters: SecQuarter[]; annual: SecQuarter[]; status: string } }>();
export async function fetchSecQuarters(symbol: string): Promise<{ quarters: SecQuarter[]; annual: SecQuarter[]; status: string }> {
  const hit = secCache.get(symbol);
  if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.v;
  try {
    const cik = await secCik(symbol);
    if (!cik) return { quarters: [], annual: [], status: "not an SEC filer (foreign listing or unknown ticker)" };
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
    if (!r.ok) { await r.body?.cancel(); return { quarters: [], annual: [], status: `HTTP ${r.status}` }; }
    const j = await r.json();
    const q = parseCompanyFacts(j), a = parseCompanyFactsAnnual(j);
    const v = { quarters: q, annual: a, status: q.length ? `ok (${q.length} quarters, ${a.length} years)` : "no quarterly data (20-F/40-F filer?)" };
    secCache.set(symbol, { at: Date.now(), v });
    return v;
  } catch (e) {
    return { quarters: [], annual: [], status: `error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
