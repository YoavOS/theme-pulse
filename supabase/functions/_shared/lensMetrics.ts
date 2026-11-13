// ─────────────────────────────────────────────────────────────
// Fundamentals Lens — company metrics from SEC companyfacts, Damodaran-style.
// PURE module (no network). Used by the fundamentals-lens edge function.
//
// Definitions follow Aswath Damodaran (NYU Stern, Damodaran Online "variable definitions",
// "Return on Capital, Return on Invested Capital and Return on Equity" (2007), Valuation class notes):
//   Invested capital = book debt + book equity − cash            (start of the period for ROIC)
//   ROIC             = EBIT × (1 − tax rate) / invested capital a year earlier
//   Net capex        = capex − depreciation & amortization;  reinvestment adds Δ non-cash WC and acquisitions
//   Reinvestment rate= reinvestment / after-tax operating income
//   FCFF             = after-tax operating income − reinvestment     (stock-based comp is NOT added back)
//   Interest coverage= EBIT / interest expense  → synthetic rating (his January 2026 table)
// Sales-to-capital  = revenue / invested capital — the app's reading; Damodaran publishes the ratio
//   by industry without a formula. Operating leases and R&D capitalisation are NOT applied here
//   (the comparable industry column is the unadjusted one); the lessons explain both adjustments.
// Every metric carries the formula, the inputs that went in, and a display string; numbers shown in
// explanations come only from these display strings.
// ─────────────────────────────────────────────────────────────

import { CONCEPTS, byPeriod, dur, factsFor, instantValue, parseCompanyFactsAnnual, quarterEnds, quarterValue, type Facts, type SecFact } from "./secFundamentals.ts";

export type Pillar = "growth" | "profitability" | "reinvestment" | "risk" | "cash_return" | "pricing";
export type Unit = "pct" | "pp" | "usd" | "x" | "years";

export interface MetricInput { label: string; display: string }
export interface Metric {
  id: string;
  pillar: Pillar;
  label: string;
  value: number | null;      // pct/pp units are in percent (23.4 = 23.4%)
  unit: Unit;
  display: string;           // "23.4%", "$1.2B", "n/m"
  period: string;            // "TTM to 2026-09-27"
  formula: string;
  inputs: MetricInput[];
  note?: string;             // why n/m, or what to watch
  approx?: boolean;          // a fallback concept or assumption was used
}

// ── Extra XBRL concepts (first available wins, per period) ───────────────────────────
export const LENS_FLOW = {
  revenue: CONCEPTS.revenue,
  costOfRevenue: CONCEPTS.costOfRevenue,
  grossProfit: CONCEPTS.grossProfit,
  operatingIncome: CONCEPTS.operatingIncome,
  netIncome: CONCEPTS.netIncome,
  rnd: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  sga: ["SellingGeneralAndAdministrativeExpense"],
  interest: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"],
  pretax: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"],
  tax: ["IncomeTaxExpenseBenefit"],
  dna: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"],
  ocf: CONCEPTS.operatingCashFlow,
  capex: CONCEPTS.capex,
  acquisitions: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesGross"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  dividends: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  stockIssued: ["ProceedsFromIssuanceOfCommonStock"],
} as const;
export const LENS_INSTANT = {
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  stInvest: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  equity: CONCEPTS.equity,
  ltdNoncurrent: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
  ltdTotal: ["LongTermDebt"],
  debtCurrent: ["DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  ltdCurrent: ["LongTermDebtCurrent"],
  stBorrowings: ["ShortTermBorrowings", "CommercialPaper"],
  opLease: ["OperatingLeaseLiability"],
  currentAssets: CONCEPTS.currentAssets,
  currentLiabilities: CONCEPTS.currentLiabilities,
  assets: CONCEPTS.assets,
  goodwill: ["Goodwill"],
} as const;
const SHARES = CONCEPTS.shares;

type FlowKey = keyof typeof LENS_FLOW;
type InstKey = keyof typeof LENS_INSTANT;

export interface QuarterRow {
  end: string;
  flow: Partial<Record<FlowKey, number | null>>;
  inst: Partial<Record<InstKey, number | null>>;
  shares: number | null;
  fallback: string[];        // fields answered by a later concept in the list
  filed: string | null;
}
export interface AnnualRow { end: string; revenue: number | null; operatingIncome: number | null; netIncome: number | null; operatingCashFlow: number | null; capex: number | null }

export interface CompanyHistory {
  quarters: QuarterRow[];     // newest first
  annual: AnnualRow[];        // newest first
  firstFiled: string | null;  // earliest 10-K/10-Q period in the file (rough "age as a public filer")
  ifrsOnly: boolean;
  /** Fiscal-year R&D, newest first (for Damodaran's R&D capitalisation). */
  rndAnnual?: { end: string; val: number }[];
}

/** Parse companyfacts into the quarter rows the lens needs (newest first). */
export function parseLensHistory(json: { facts?: Record<string, Facts> }, maxQuarters = 12): CompanyHistory {
  const gaap = json?.facts?.["us-gaap"];
  if (!gaap) return { quarters: [], annual: [], firstFiled: null, ifrsOnly: !!json?.facts?.["ifrs-full"] };
  const usd = ["USD"];
  const lists = (names: readonly string[], unit = usd) => factsFor(gaap, names, unit).map(byPeriod);
  const flowL = Object.fromEntries(Object.entries(LENS_FLOW).map(([k, v]) => [k, lists(v)])) as Record<FlowKey, SecFact[][]>;
  const instL = Object.fromEntries(Object.entries(LENS_INSTANT).map(([k, v]) => [k, lists(v)])) as Record<InstKey, SecFact[][]>;
  const shareL = lists(SHARES, ["shares"]);
  const ends = quarterEnds([...flowL.revenue, ...flowL.netIncome, ...flowL.operatingIncome]).slice(0, maxQuarters);

  let firstFiled: string | null = null;
  for (const l of [...flowL.revenue, ...flowL.netIncome]) for (const f of l) if (!firstFiled || f.end < firstFiled) firstFiled = f.end;

  const quarters: QuarterRow[] = ends.map((end) => {
    const fallback: string[] = [];
    const flow: QuarterRow["flow"] = {};
    for (const k of Object.keys(LENS_FLOW) as FlowKey[]) {
      flow[k] = null;
      flowL[k].forEach((l, i) => {
        if (flow[k] !== null) return;
        const r = quarterValue(l, end);
        if (r.v !== null) { flow[k] = r.v; if (i > 0) fallback.push(k); }
      });
    }
    if (flow.grossProfit == null && flow.revenue != null && flow.costOfRevenue != null) flow.grossProfit = flow.revenue - flow.costOfRevenue;
    const inst: QuarterRow["inst"] = {};
    for (const k of Object.keys(LENS_INSTANT) as InstKey[]) {
      inst[k] = null;
      instL[k].forEach((l, i) => {
        if (inst[k] !== null) return;
        const v = instantValue(l, end);
        if (v !== null) { inst[k] = v; if (i > 0) fallback.push(k); }
      });
    }
    let shares: number | null = null;
    for (const l of shareL) {
      const at = l.filter((f) => f.end === end && f.start).sort((a, b) => (Date.parse(a.end) - Date.parse(a.start!)) - (Date.parse(b.end) - Date.parse(b.start!)));
      if (at.length) { shares = at[0].val; break; }
    }
    let filed: string | null = null;
    for (const l of flowL.revenue.concat(flowL.netIncome)) for (const x of l) if (x.end === end && x.filed && (!filed || x.filed < filed)) filed = x.filed;
    return { end, flow, inst, shares, fallback, filed };
  });

  const annual = parseCompanyFactsAnnual(json, 7).map((a) => ({
    end: a.end, revenue: a.revenue, operatingIncome: a.operatingIncome, netIncome: a.netIncome, operatingCashFlow: a.operatingCashFlow, capex: a.capex,
  }));
  // fiscal-year R&D (10-K, ~1-year periods), first concept with data per year-end, up to 11 years
  const rndByEnd = new Map<string, number>();
  for (const l of flowL.rnd) for (const f of l) {
    const d = dur(f);
    if (d >= 350 && d <= 380 && /^10-K/.test(f.form ?? "10-K") && !rndByEnd.has(f.end)) rndByEnd.set(f.end, f.val);
  }
  const rndAnnual = [...rndByEnd.entries()].map(([end, val]) => ({ end, val })).sort((x, y) => (x.end < y.end ? 1 : -1))
    // drop overlapping fiscal years (52/53-week calendars): keep ends at least ~300 days apart
    .filter((r, i, arr) => i === 0 || Date.parse(arr[i - 1].end) - Date.parse(r.end) > 300 * 86400_000).slice(0, 11);
  return { quarters, annual, firstFiled, ifrsOnly: false, rndAnnual };
}

// ── Formatting ───────────────────────────────────────────────────────────────────────
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function fmtUsd(v: number | null): string {
  if (!fin(v)) return "n/a";
  const a = Math.abs(v), s = v < 0 ? "−$" : "$";
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e11 ? 0 : a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
}
/** Round first so −0.04 shows as "0.0", not "−0.0". */
const signed = (v: number, d: number, plus: boolean) => {
  const r = Number(v.toFixed(d));
  return `${r > 0 && plus ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(d)}`;
};
export function fmtPct(v: number | null, d = 1): string {
  return fin(v) ? `${signed(v, d, false)}%` : "n/a";
}
export const fmtPp = (v: number | null) => (fin(v) ? `${signed(v, 1, true)} pp` : "n/a");
export const fmtX = (v: number | null, d = 1) => (fin(v) ? `${signed(v, d, false)}×` : "n/a");
const growthStr = (v: number | null) => (fin(v) ? `${signed(v, 1, true)}%` : "n/a");

// ── Synthetic rating (Damodaran, January 2026; large non-financial firms) ─────────────
export const RATING_TABLE: [number, string, number][] = [
  // [coverage above, rating, default spread %]
  [8.5, "AAA", 0.40], [6.5, "AA", 0.55], [5.5, "A+", 0.70], [4.25, "A", 0.78], [3, "A−", 0.89], [2.5, "BBB", 1.11],
  [2.25, "BB+", 1.38], [2, "BB", 1.84], [1.75, "B+", 2.75], [1.5, "B", 3.21], [1.25, "B−", 5.09], [0.8, "CCC", 8.85],
  [0.65, "CC", 12.61], [0.2, "C", 16.00], [-Infinity, "D", 19.00],
];
export function syntheticRating(coverage: number): { rating: string; spread: number } {
  for (const [lo, rating, spread] of RATING_TABLE) if (coverage > lo) return { rating, spread };
  return { rating: "D", spread: 19 };
}

// ── Metrics ──────────────────────────────────────────────────────────────────────────
export interface MarketData { price: number | null; marketCap: number | null }

/** Sum of four consecutive quarters (needs all four). */
function ttm(qs: QuarterRow[], k: FlowKey, from = 0): number | null {
  const xs = qs.slice(from, from + 4).map((q) => q.flow[k]);
  if (xs.length < 4 || xs.some((x) => !fin(x))) return null;
  // the four quarters must be consecutive (~1 year span)
  const span = (Date.parse(qs[from].end) - Date.parse(qs[from + 3].end)) / 86_400_000;
  if (span < 250 || span > 300) return null;
  return (xs as number[]).reduce((a, b) => a + b, 0);
}
const pctChange = (now: number | null, prior: number | null) => (fin(now) && fin(prior) && prior > 0 ? ((now - prior) / prior) * 100 : null);

export function debtAt(q: QuarterRow | undefined): { debt: number | null; shortPart: number } {
  if (!q) return { debt: null, shortPart: 0 };
  const i = q.inst;
  const shortPart = fin(i.debtCurrent) ? i.debtCurrent! : (i.ltdCurrent ?? 0) + (i.stBorrowings ?? 0);
  if (fin(i.ltdNoncurrent)) return { debt: i.ltdNoncurrent! + shortPart, shortPart };
  if (fin(i.ltdTotal)) return { debt: i.ltdTotal! + (fin(i.debtCurrent) ? Math.max(0, i.debtCurrent! - (i.ltdCurrent ?? 0)) : (i.stBorrowings ?? 0)), shortPart };
  if (fin(i.debtCurrent) || fin(i.ltdCurrent) || fin(i.stBorrowings)) return { debt: shortPart, shortPart };
  return { debt: null, shortPart };
}
const cashAt = (q: QuarterRow | undefined) => (q && (fin(q.inst.cash) || fin(q.inst.stInvest)) ? (q.inst.cash ?? 0) + (q.inst.stInvest ?? 0) : null);

export interface LensMetrics {
  metrics: Metric[];
  asOf: string | null;           // latest quarter end
  filed: string | null;          // when it was filed
  ttmLabel: string;
  taxRate: number | null;        // effective rate used (fraction)
  /** Raw TTM inputs the front end needs for Damodaran's R&D/lease adjustments. */
  raw?: { ebit: number | null; revenue: number | null; rndTtm: number | null; icBase: number | null; leaseNow: number | null; leaseBase: number | null };
  revenueTtm: number | null;
}

export function computeMetrics(h: CompanyHistory, mkt: MarketData, opts: { financial: boolean }): LensMetrics {
  const q = h.quarters;
  const m: Metric[] = [];
  const q0 = q[0], q4 = q[4];
  const ttmLabel = q0 ? `TTM to ${q0.end}` : "TTM";
  const add = (x: Omit<Metric, "display"> & { display?: string }) => {
    const display = x.display ?? (x.value === null ? "n/m"
      : x.unit === "pct" ? fmtPct(x.value) : x.unit === "pp" ? fmtPp(x.value) : x.unit === "usd" ? fmtUsd(x.value)
      : x.unit === "x" ? fmtX(x.value) : `${x.value.toFixed(1)} yrs`);
    m.push({ ...x, display });
  };
  const T = (k: FlowKey, from = 0) => ttm(q, k, from);
  const rev = T("revenue"), revPrev = T("revenue", 4);
  const ebit = T("operatingIncome"), ebitPrev = T("operatingIncome", 4);
  const ni = T("netIncome"), niPrev = T("netIncome", 4);
  const gp = T("grossProfit"), gpPrev = T("grossProfit", 4);
  const ocf = T("ocf"), capex = T("capex"), dna = T("dna"), sbc = T("sbc"), acq = T("acquisitions");
  const interest = T("interest"), pretax = T("pretax"), tax = T("tax");
  const rnd = T("rnd"), sga = T("sga"), buy = T("buybacks"), div = T("dividends"), issued = T("stockIssued");
  const fallbackUsed = (k: string) => q.slice(0, 4).some((r) => r.fallback.includes(k));

  // tax rate: effective, clamped; marginal-ish default when there's no meaningful pre-tax income
  let taxRate: number | null = null, taxNote = "";
  if (fin(pretax) && pretax > 0 && fin(tax)) { taxRate = Math.min(0.4, Math.max(0, tax / pretax)); taxNote = `effective tax rate ${fmtPct(taxRate * 100)}`; }
  else { taxRate = 0.25; taxNote = "25% assumed tax rate (no meaningful pre-tax income)"; }

  // ── Growth
  add({ id: "rev_growth_ttm", pillar: "growth", label: "Revenue growth (TTM vs prior year)", unit: "pct", value: pctChange(rev, revPrev), period: ttmLabel,
    display: growthStr(pctChange(rev, revPrev)), formula: "(Revenue TTM − Revenue of the 12 months before) ÷ Revenue of the 12 months before",
    inputs: [{ label: "Revenue TTM", display: fmtUsd(rev) }, { label: "Prior 12 months", display: fmtUsd(revPrev) }], approx: fallbackUsed("revenue") });
  const rq0 = q0?.flow.revenue ?? null, rq4 = q4?.flow.revenue ?? null;
  add({ id: "rev_growth_q", pillar: "growth", label: "Latest quarter revenue growth (vs same quarter last year)", unit: "pct", value: pctChange(rq0, rq4),
    display: growthStr(pctChange(rq0, rq4)), period: q0 ? `quarter ending ${q0.end}` : "", formula: "(This quarter's revenue − same quarter last year) ÷ same quarter last year",
    inputs: [{ label: "This quarter", display: fmtUsd(rq0) }, { label: "Year ago", display: fmtUsd(rq4) }] });
  const a = h.annual;
  const cagr = a.length >= 4 && fin(a[0].revenue) && fin(a[3].revenue) && a[3].revenue! > 0 && a[0].revenue! > 0 ? (Math.pow(a[0].revenue! / a[3].revenue!, 1 / 3) - 1) * 100 : null;
  add({ id: "rev_cagr_3y", pillar: "growth", label: "Revenue growth per year, last 3 fiscal years", unit: "pct", value: cagr, display: growthStr(cagr),
    period: a.length >= 4 ? `FY ${a[3].end.slice(0, 4)} → FY ${a[0].end.slice(0, 4)}` : "", formula: "(Latest FY revenue ÷ revenue 3 years earlier)^(1/3) − 1",
    inputs: a.length >= 4 ? [{ label: `FY ${a[0].end.slice(0, 4)}`, display: fmtUsd(a[0].revenue) }, { label: `FY ${a[3].end.slice(0, 4)}`, display: fmtUsd(a[3].revenue) }] : [],
    note: cagr === null ? "Needs four fiscal years of 10-K revenue." : undefined });
  const ebitGrowth = pctChange(ebit, ebitPrev);
  add({ id: "opinc_growth_ttm", pillar: "growth", label: "Operating income growth (TTM)", unit: "pct", value: ebitGrowth, display: growthStr(ebitGrowth), period: ttmLabel,
    formula: "(Operating income TTM − prior 12 months) ÷ prior 12 months", inputs: [{ label: "Operating income TTM", display: fmtUsd(ebit) }, { label: "Prior 12 months", display: fmtUsd(ebitPrev) }],
    note: fin(ebitPrev) && ebitPrev <= 0 ? "Not meaningful: the prior year's operating income was zero or negative." : fin(ebitPrev) && fin(ebit) && Math.abs(ebitPrev) < 0.03 * (rev ?? Infinity) ? "Small base: last year's operating income was tiny, so the % change exaggerates." : undefined });
  const niGrowth = pctChange(ni, niPrev);
  add({ id: "ni_growth_ttm", pillar: "growth", label: "Net income growth (TTM)", unit: "pct", value: niGrowth, display: growthStr(niGrowth), period: ttmLabel,
    formula: "(Net income TTM − prior 12 months) ÷ prior 12 months", inputs: [{ label: "Net income TTM", display: fmtUsd(ni) }, { label: "Prior 12 months", display: fmtUsd(niPrev) }],
    note: fin(niPrev) && niPrev <= 0 ? "Not meaningful: last year was a loss." : undefined });

  // ── Profitability
  const margin = (num: number | null, den: number | null) => (fin(num) && fin(den) && den > 0 ? (num / den) * 100 : null);
  const gm = margin(gp, rev), om = margin(ebit, rev), nm = margin(ni, rev), omPrev = margin(ebitPrev, revPrev), gmPrev = margin(gpPrev, revPrev);
  add({ id: "gross_margin", pillar: "profitability", label: "Gross margin", unit: "pct", value: gm, period: ttmLabel, formula: "Gross profit ÷ Revenue",
    inputs: [{ label: "Gross profit TTM", display: fmtUsd(gp) }, { label: "Revenue TTM", display: fmtUsd(rev) }],
    note: gm === null ? "This company doesn't report a gross profit line (common for banks, insurers and some service firms)." : undefined });
  add({ id: "op_margin", pillar: "profitability", label: "Operating margin", unit: "pct", value: om, period: ttmLabel, formula: "Operating income ÷ Revenue",
    inputs: [{ label: "Operating income TTM", display: fmtUsd(ebit) }, { label: "Revenue TTM", display: fmtUsd(rev) }] });
  add({ id: "op_margin_change", pillar: "profitability", label: "Operating margin change vs a year ago", unit: "pp", value: fin(om) && fin(omPrev) ? om - omPrev : null, period: ttmLabel,
    formula: "Operating margin TTM − operating margin of the prior 12 months", inputs: [{ label: "Now", display: fmtPct(om) }, { label: "A year ago", display: fmtPct(omPrev) }] });
  add({ id: "gross_margin_change", pillar: "profitability", label: "Gross margin change vs a year ago", unit: "pp", value: fin(gm) && fin(gmPrev) ? gm - gmPrev : null, period: ttmLabel,
    formula: "Gross margin TTM − gross margin of the prior 12 months", inputs: [{ label: "Now", display: fmtPct(gm) }, { label: "A year ago", display: fmtPct(gmPrev) }] });
  add({ id: "net_margin", pillar: "profitability", label: "Net margin", unit: "pct", value: nm, period: ttmLabel, formula: "Net income ÷ Revenue",
    inputs: [{ label: "Net income TTM", display: fmtUsd(ni) }, { label: "Revenue TTM", display: fmtUsd(rev) }] });
  add({ id: "rnd_intensity", pillar: "profitability", label: "R&D as % of revenue", unit: "pct", value: margin(rnd, rev), period: ttmLabel, formula: "R&D expense ÷ Revenue",
    inputs: [{ label: "R&D TTM", display: fmtUsd(rnd) }, { label: "Revenue TTM", display: fmtUsd(rev) }], note: rnd === null ? "No R&D line reported." : undefined });

  const eq0 = q0?.inst.equity ?? null, eq4 = q4?.inst.equity ?? null;
  const roe = fin(ni) && fin(eq4) && eq4 > 0 ? (ni / eq4) * 100 : fin(ni) && fin(eq0) && eq0 > 0 ? (ni / eq0) * 100 : null;
  add({ id: "roe", pillar: "profitability", label: "Return on equity (ROE)", unit: "pct", value: roe, period: ttmLabel, formula: "Net income TTM ÷ shareholders' equity a year earlier",
    inputs: [{ label: "Net income TTM", display: fmtUsd(ni) }, { label: "Equity a year earlier", display: fmtUsd(fin(eq4) ? eq4 : eq0) }],
    note: roe === null && (fin(eq4) ? eq4 : eq0 ?? 1) <= 0 ? "Not meaningful: book equity is negative (often from large buybacks or accumulated losses)." : undefined, approx: !fin(eq4) && fin(eq0) });

  const d0 = debtAt(q0), d4 = debtAt(q4);
  const c0 = cashAt(q0), c4 = cashAt(q4);
  const ic = (d: number | null, e: number | null, c: number | null) => (fin(e) ? (d ?? 0) + e - (c ?? 0) : null);
  const ic0 = ic(d0.debt, eq0, c0), ic4 = ic(d4.debt, eq4, c4);
  const icBase = fin(ic4) ? ic4 : ic0;
  const nopat = fin(ebit) ? (ebit > 0 ? ebit * (1 - (taxRate ?? 0.25)) : ebit) : null;
  if (opts.financial) {
    add({ id: "roic", pillar: "profitability", label: "Return on invested capital (ROIC)", unit: "pct", value: null, period: ttmLabel, formula: "After-tax operating income ÷ invested capital",
      inputs: [], note: "Not used for banks, insurers and brokers: debt is their raw material, not financing, so ROE replaces ROIC." });
  } else {
    const roic = fin(nopat) && fin(icBase) && icBase > 0 ? (nopat / icBase) * 100 : null;
    add({ id: "roic", pillar: "profitability", label: "Return on invested capital (ROIC)", unit: "pct", value: roic, period: ttmLabel,
      formula: "Operating income × (1 − tax rate) ÷ (debt + equity − cash) a year earlier",
      inputs: [{ label: "Operating income TTM", display: fmtUsd(ebit) }, { label: "Tax", display: taxNote }, { label: "After-tax operating income", display: fmtUsd(nopat) },
        { label: "Invested capital a year earlier", display: fmtUsd(icBase) }],
      note: roic === null && fin(icBase) && icBase <= 0 ? "Not meaningful: invested capital is zero or negative (cash exceeds debt + equity, or equity is negative)." : undefined,
      approx: !fin(ic4) && fin(ic0) });
  }

  // ── Reinvestment
  const fcf = fin(ocf) && fin(capex) ? ocf - capex : null;
  add({ id: "fcf", pillar: "reinvestment", label: "Free cash flow (TTM)", unit: "usd", value: fcf, period: ttmLabel, formula: "Operating cash flow − capital expenditures",
    inputs: [{ label: "Operating cash flow", display: fmtUsd(ocf) }, { label: "Capex", display: fmtUsd(capex) }] });
  add({ id: "fcf_margin", pillar: "reinvestment", label: "Free cash flow margin", unit: "pct", value: margin(fcf, rev), period: ttmLabel, formula: "Free cash flow ÷ Revenue",
    inputs: [{ label: "Free cash flow", display: fmtUsd(fcf) }, { label: "Revenue TTM", display: fmtUsd(rev) }] });
  add({ id: "capex_intensity", pillar: "reinvestment", label: "Capex as % of revenue", unit: "pct", value: margin(capex, rev), period: ttmLabel, formula: "Capital expenditures ÷ Revenue",
    inputs: [{ label: "Capex TTM", display: fmtUsd(capex) }, { label: "Revenue TTM", display: fmtUsd(rev) }] });
  const netCapex = fin(capex) && fin(dna) ? capex - dna : null;
  const nonCashWc = (r: QuarterRow | undefined, d: { shortPart: number }) => {
    if (!r || !fin(r.inst.currentAssets) || !fin(r.inst.currentLiabilities)) return null;
    return (r.inst.currentAssets! - (cashAt(r) ?? 0)) - (r.inst.currentLiabilities! - d.shortPart);
  };
  const wc0 = nonCashWc(q0, d0), wc4 = nonCashWc(q4, d4);
  const dWc = fin(wc0) && fin(wc4) ? wc0 - wc4 : null;
  const reinvest = fin(netCapex) ? netCapex + (dWc ?? 0) + (acq ?? 0) : null;
  if (!opts.financial) {
    add({ id: "reinvestment", pillar: "reinvestment", label: "Reinvestment (TTM)", unit: "usd", value: reinvest, period: ttmLabel,
      formula: "(Capex − depreciation) + change in non-cash working capital + acquisitions",
      inputs: [{ label: "Capex", display: fmtUsd(capex) }, { label: "Depreciation & amortization", display: fmtUsd(dna) }, { label: "Net capex", display: fmtUsd(netCapex) },
        { label: "Change in non-cash working capital", display: fmtUsd(dWc) }, { label: "Acquisitions", display: fmtUsd(acq ?? 0) }],
      note: netCapex === null ? "Depreciation isn't reported separately, so net capex can't be computed." : dWc === null ? "Working-capital change unavailable — counted as zero." : undefined,
      approx: dWc === null });
    const rr = fin(reinvest) && fin(nopat) && nopat > 0 ? (reinvest / nopat) * 100 : null;
    add({ id: "reinvestment_rate", pillar: "reinvestment", label: "Reinvestment rate", unit: "pct", value: rr, period: ttmLabel, formula: "Reinvestment ÷ after-tax operating income",
      inputs: [{ label: "Reinvestment", display: fmtUsd(reinvest) }, { label: "After-tax operating income", display: fmtUsd(nopat) }],
      note: rr === null && fin(nopat) && nopat <= 0 ? "Not meaningful while operating income is negative — the company is reinvesting money it doesn't earn yet." : undefined });
    const s2c = fin(rev) && fin(icBase) && icBase > 0 ? rev / icBase : null;
    add({ id: "sales_to_capital", pillar: "reinvestment", label: "Sales to invested capital", unit: "x", value: s2c, period: ttmLabel, display: fin(s2c) ? fmtX(s2c, 2) : "n/m",
      formula: "Revenue TTM ÷ invested capital a year earlier (the app's reading of Damodaran's ratio)",
      inputs: [{ label: "Revenue TTM", display: fmtUsd(rev) }, { label: "Invested capital a year earlier", display: fmtUsd(icBase) }] });
    const fcff = fin(nopat) && fin(reinvest) ? nopat - reinvest : null;
    add({ id: "fcff", pillar: "reinvestment", label: "Free cash flow to the firm (Damodaran FCFF)", unit: "usd", value: fcff, period: ttmLabel,
      formula: "After-tax operating income − reinvestment", inputs: [{ label: "After-tax operating income", display: fmtUsd(nopat) }, { label: "Reinvestment", display: fmtUsd(reinvest) }] });
  }
  add({ id: "sbc_intensity", pillar: "reinvestment", label: "Stock-based compensation as % of revenue", unit: "pct", value: margin(sbc, rev), period: ttmLabel, formula: "Stock-based compensation ÷ Revenue",
    inputs: [{ label: "SBC TTM", display: fmtUsd(sbc) }, { label: "Revenue TTM", display: fmtUsd(rev) }], note: sbc === null ? "No stock-based compensation line found." : undefined });
  const fcfAfterSbc = fin(fcf) && fin(sbc) ? fcf - sbc : null;
  add({ id: "fcf_after_sbc", pillar: "reinvestment", label: "Free cash flow after stock compensation", unit: "usd", value: fcfAfterSbc, period: ttmLabel,
    formula: "Free cash flow − stock-based compensation (SBC is a real cost paid in shares)", inputs: [{ label: "Free cash flow", display: fmtUsd(fcf) }, { label: "SBC", display: fmtUsd(sbc) }] });
  const cash = c0;
  const runway = fin(fcf) && fcf < 0 && fin(cash) ? cash / -fcf : null;
  add({ id: "cash_runway", pillar: "reinvestment", label: "Cash runway at the current burn", unit: "years", value: runway, period: q0 ? `cash at ${q0.end}` : "",
    display: fin(runway) ? `${runway.toFixed(1)} yrs` : fin(fcf) && fcf >= 0 ? "self-funding" : "n/a",
    formula: "Cash and short-term investments ÷ yearly cash burn (negative free cash flow)",
    inputs: [{ label: "Cash + short-term investments", display: fmtUsd(cash) }, { label: "Free cash flow TTM", display: fmtUsd(fcf) }] });

  // ── Risk
  const ebitda = fin(ebit) && fin(dna) ? ebit + dna : null;
  if (!opts.financial) {
    const cov = fin(ebit) && fin(interest) && interest > 0 ? ebit / interest : null;
    const negligible = !fin(interest) || interest <= 0 || (fin(ebit) && ebit > 0 && interest < ebit * 0.01);
    const rating = fin(cov) ? syntheticRating(cov) : null;
    add({ id: "interest_coverage", pillar: "risk", label: "Interest coverage", unit: "x", value: negligible && !fin(cov) ? null : cov, period: ttmLabel,
      display: fin(cov) ? fmtX(cov) : negligible ? "no real interest" : "n/m",
      formula: "Operating income ÷ interest expense", inputs: [{ label: "Operating income TTM", display: fmtUsd(ebit) }, { label: "Interest expense TTM", display: fmtUsd(interest) }],
      note: !fin(cov) && negligible ? "Interest expense is zero or negligible — little or no debt to service." : undefined });
    add({ id: "synthetic_rating", pillar: "risk", label: "Implied credit rating (from coverage)", unit: "x", value: fin(cov) ? cov : null, period: ttmLabel,
      display: rating ? rating.rating : negligible ? "AAA-like (no debt burden)" : "n/m",
      formula: "Damodaran's coverage → rating table (January 2026, large non-financial firms)",
      inputs: rating ? [{ label: "Coverage", display: fmtX(cov) }, { label: "Rating", display: rating.rating }, { label: "Default spread over risk-free", display: fmtPct(rating.spread, 2) }] : [] });
  }
  const debt = d0.debt;
  const dToCap = fin(debt) && fin(mkt.marketCap) && mkt.marketCap > 0 ? (debt / (debt + mkt.marketCap)) * 100 : null;
  add({ id: "debt_to_capital", pillar: "risk", label: "Debt to capital (market)", unit: "pct", value: dToCap, period: q0 ? `debt at ${q0.end}, market cap now` : "",
    formula: "Debt ÷ (debt + market value of equity)", inputs: [{ label: "Debt", display: fmtUsd(debt) }, { label: "Market cap", display: fmtUsd(mkt.marketCap) }],
    note: opts.financial ? "For banks and insurers, debt is part of the business itself, so this ratio reads differently." : undefined });
  const dToEbitda = fin(debt) && fin(ebitda) && ebitda > 0 ? debt / ebitda : null;
  add({ id: "debt_to_ebitda", pillar: "risk", label: "Debt to EBITDA", unit: "x", value: dToEbitda, period: ttmLabel, formula: "Debt ÷ (operating income + depreciation & amortization)",
    inputs: [{ label: "Debt", display: fmtUsd(debt) }, { label: "EBITDA TTM", display: fmtUsd(ebitda) }], note: fin(ebitda) && ebitda <= 0 ? "Not meaningful: EBITDA is negative." : undefined });
  add({ id: "net_debt", pillar: "risk", label: "Net debt (debt − cash)", unit: "usd", value: fin(debt) || fin(cash) ? (debt ?? 0) - (cash ?? 0) : null, period: q0 ? `at ${q0.end}` : "",
    formula: "Debt − cash and short-term investments", inputs: [{ label: "Debt", display: fmtUsd(debt ?? 0) }, { label: "Cash + short-term investments", display: fmtUsd(cash) }] });
  const cr = q0 && fin(q0.inst.currentAssets) && fin(q0.inst.currentLiabilities) && q0.inst.currentLiabilities! > 0 ? q0.inst.currentAssets! / q0.inst.currentLiabilities! : null;
  add({ id: "current_ratio", pillar: "risk", label: "Current ratio", unit: "x", value: cr, period: q0 ? `at ${q0.end}` : "", display: fin(cr) ? fmtX(cr, 2) : "n/a",
    formula: "Current assets ÷ current liabilities", inputs: [{ label: "Current assets", display: fmtUsd(q0?.inst.currentAssets ?? null) }, { label: "Current liabilities", display: fmtUsd(q0?.inst.currentLiabilities ?? null) }] });
  const lease = q0?.inst.opLease ?? null;
  add({ id: "lease_debt", pillar: "risk", label: "Operating lease liabilities", unit: "usd", value: lease, period: q0 ? `at ${q0.end}` : "",
    formula: "Lease liabilities on the balance sheet (Damodaran treats them as debt)", inputs: [{ label: "Lease liabilities", display: fmtUsd(lease) }, { label: "Reported debt", display: fmtUsd(debt) }],
    note: lease === null ? "No operating lease liability reported." : undefined });

  // ── Cash return & dilution
  const sh0 = q0?.shares ?? null, sh4 = q4?.shares ?? null;
  const dil = pctChange(sh0, sh4);
  add({ id: "share_change", pillar: "cash_return", label: "Change in diluted share count (1 year)", unit: "pct", value: dil, display: growthStr(dil), period: q0 && q4 ? `${q4.end} → ${q0.end}` : "",
    formula: "Diluted shares now ÷ diluted shares a year ago − 1", inputs: [{ label: "Diluted shares now", display: fin(sh0) ? `${(sh0 / 1e6).toFixed(1)}M` : "n/a" }, { label: "A year ago", display: fin(sh4) ? `${(sh4 / 1e6).toFixed(1)}M` : "n/a" }] });
  const cashRet = (buy ?? 0) + (div ?? 0);
  add({ id: "cash_return", pillar: "cash_return", label: "Cash returned (buybacks + dividends, TTM)", unit: "usd", value: buy === null && div === null ? null : cashRet, period: ttmLabel,
    display: buy === null && div === null ? "none reported" : fmtUsd(cashRet),
    formula: "Share buybacks + dividends paid", inputs: [{ label: "Buybacks", display: fmtUsd(buy ?? 0) }, { label: "Dividends", display: fmtUsd(div ?? 0) }, { label: "Stock issued for cash", display: fmtUsd(issued ?? 0) }] });
  add({ id: "cash_return_vs_fcf", pillar: "cash_return", label: "Cash returned as % of free cash flow", unit: "pct", value: fin(fcf) && fcf > 0 && (buy !== null || div !== null) ? (cashRet / fcf) * 100 : null, period: ttmLabel,
    formula: "(Buybacks + dividends) ÷ free cash flow", inputs: [{ label: "Cash returned", display: fmtUsd(cashRet) }, { label: "Free cash flow", display: fmtUsd(fcf) }],
    note: fin(fcf) && fcf <= 0 ? "Not meaningful: free cash flow is negative." : undefined });

  // ── Pricing (what the market pays)
  const mc = mkt.marketCap;
  const ev = fin(mc) ? mc + (debt ?? 0) - (cash ?? 0) : null;
  add({ id: "ps", pillar: "pricing", label: "Price to sales", unit: "x", value: fin(mc) && fin(rev) && rev > 0 ? mc / rev : null, period: ttmLabel, formula: "Market cap ÷ revenue TTM",
    inputs: [{ label: "Market cap", display: fmtUsd(mc) }, { label: "Revenue TTM", display: fmtUsd(rev) }] });
  add({ id: "pe", pillar: "pricing", label: "Price to earnings", unit: "x", value: fin(mc) && fin(ni) && ni > 0 ? mc / ni : null, period: ttmLabel, formula: "Market cap ÷ net income TTM",
    inputs: [{ label: "Market cap", display: fmtUsd(mc) }, { label: "Net income TTM", display: fmtUsd(ni) }], note: fin(ni) && ni <= 0 ? "Not meaningful: no profits." : undefined });
  add({ id: "ev_ebit", pillar: "pricing", label: "EV to operating income", unit: "x", value: fin(ev) && fin(ebit) && ebit > 0 ? ev / ebit : null, period: ttmLabel,
    formula: "(Market cap + debt − cash) ÷ operating income TTM", inputs: [{ label: "Enterprise value", display: fmtUsd(ev) }, { label: "Operating income TTM", display: fmtUsd(ebit) }],
    note: fin(ebit) && ebit <= 0 ? "Not meaningful: operating income is negative." : undefined });

  return { metrics: m, asOf: q0?.end ?? null, filed: q0?.filed ?? null, ttmLabel, taxRate, revenueTtm: rev,
    raw: { ebit, revenue: rev, rndTtm: rnd, icBase: fin(icBase) ? icBase : null, leaseNow: q0?.inst.opLease ?? null, leaseBase: q4?.inst.opLease ?? null } };
}

// ── Corporate life cycle (heuristic) ──────────────────────────────────────────────────
// Damodaran's six stages. He gives no numeric cut-offs; these are the app's, shown with their inputs.
export type Stage = "startup" | "young_growth" | "high_growth" | "mature_growth" | "mature_stable" | "decline";
export const STAGE_ORDER: Stage[] = ["startup", "young_growth", "high_growth", "mature_growth", "mature_stable", "decline"];
export interface StageSignal { id: string; label: string; display: string; points: Stage[] }
export interface LifeCycle { stage: Stage; leaning: Stage | null; confidence: "high" | "medium" | "low"; signals: StageSignal[]; publicSince: string | null }

export function classifyLifeCycle(mx: LensMetrics, h: CompanyHistory): LifeCycle | null {
  const v = (id: string) => mx.metrics.find((x) => x.id === id)?.value ?? null;
  const g1 = v("rev_growth_ttm"), g3 = v("rev_cagr_3y");
  const gs = [g1, g3].filter(fin);
  if (!gs.length) return null;
  const g = gs.reduce((a, b) => a + b, 0) / gs.length;
  const om = v("op_margin"), dOm = v("op_margin_change"), fcfM = v("fcf_margin");
  const cashRet = v("cash_return"), rev = mx.revenueTtm;
  const signals: StageSignal[] = [];

  const gPoints: Stage[] = g >= 25 ? ["young_growth", "high_growth"] : g >= 10 ? ["high_growth", "mature_growth"] : g >= 0 ? ["mature_growth", "mature_stable"] : ["mature_stable", "decline"];
  signals.push({ id: "growth", label: "Revenue growth (avg of TTM and 3-year)", display: growthStr(g), points: gPoints });
  if (fin(om)) {
    const p: Stage[] = om < -20 ? ["startup", "young_growth"] : om < 0 ? ["young_growth", "decline"] : om < 8 ? ["high_growth", "decline"] : ["high_growth", "mature_growth", "mature_stable"];
    signals.push({ id: "margin", label: "Operating margin", display: fmtPct(om), points: p });
  }
  if (fin(dOm)) {
    const p: Stage[] = dOm > 1.5 ? ["young_growth", "high_growth"] : dOm < -1.5 ? ["decline", "mature_stable"] : ["mature_growth", "mature_stable"];
    signals.push({ id: "margin_trend", label: "Operating margin trend (1 year)", display: fmtPp(dOm), points: p });
  }
  if (fin(fcfM)) {
    const p: Stage[] = fcfM < 0 ? ["startup", "young_growth", "high_growth"] : ["mature_growth", "mature_stable", "decline"];
    signals.push({ id: "fcf", label: "Free cash flow margin", display: fmtPct(fcfM), points: p });
  }
  if (cashRet !== null) {
    const p: Stage[] = cashRet > 0 && fin(fcfM) && fcfM > 0 ? ["mature_stable", "mature_growth", "decline"] : ["startup", "young_growth", "high_growth"];
    signals.push({ id: "cash_return", label: "Cash returned to shareholders", display: cashRet > 0 ? fmtUsd(cashRet) : "none", points: p });
  }
  const since = h.firstFiled;
  if (since) {
    const yrs = (Date.now() - Date.parse(since)) / (365.25 * 86_400_000);
    // companyfacts XBRL starts ~2009, so "15+ years" only says "at least that old"
    signals.push({ id: "age", label: "Filing financials since", display: since.slice(0, 4) + (yrs >= 14 ? " (XBRL era start — likely older)" : ""), points: yrs < 5 ? ["startup", "young_growth", "high_growth"] : yrs < 12 ? ["high_growth", "mature_growth"] : ["mature_growth", "mature_stable", "decline"] });
  }

  // Primary rule from growth + margin, then signals vote for confidence.
  let stage: Stage;
  if (fin(rev) && rev < 50e6 && (!fin(om) || om < -20)) stage = "startup";
  else if (g >= 25) stage = fin(om) && om < 0 ? "young_growth" : "high_growth";
  else if (g >= 10) stage = fin(om) && om < 0 ? "young_growth" : "mature_growth";
  else if (g >= 0) stage = fin(om) && om < 0 ? (fin(dOm) && dOm < 0 ? "decline" : "young_growth") : "mature_stable";
  else stage = fin(dOm) && dOm > 1.5 && fin(om) && om > 0 ? "mature_stable" : "decline";

  const votes = new Map<Stage, number>();
  for (const s of signals) for (const p of s.points) votes.set(p, (votes.get(p) ?? 0) + 1 / s.points.length);
  const agree = signals.filter((s) => s.points.includes(stage)).length / Math.max(1, signals.length);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const leaning = ranked.find(([s]) => s !== stage && Math.abs(STAGE_ORDER.indexOf(s) - STAGE_ORDER.indexOf(stage)) === 1)?.[0] ?? null;
  // near a growth threshold → lean to the neighbouring stage
  const near = [25, 10, 0].some((t) => Math.abs(g - t) < 3);
  const confidence: LifeCycle["confidence"] = agree >= 0.7 && !near ? "high" : agree >= 0.45 ? "medium" : "low";
  return { stage, leaning: near || confidence !== "high" ? leaning : null, confidence, signals, publicSince: since };
}

// ── Peer percentile ───────────────────────────────────────────────────────────────────
/** Percentile (0–100) of `v` among `peers` (ties share the mid-rank). */
export function percentileOf(v: number, peers: number[]): number {
  if (!peers.length) return 50;
  let below = 0, equal = 0;
  for (const p of peers) { if (p < v) below++; else if (p === v) equal++; }
  return Math.round(((below + equal / 2) / peers.length) * 100);
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
