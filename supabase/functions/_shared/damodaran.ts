// ─────────────────────────────────────────────────────────────
// Aswath Damodaran's industry datasets (NYU Stern, updated every January) — parsing + lookup.
// PURE module (no network, no SheetJS import): the loader edge function turns each sheet into a
// grid of { v, w } cells and hands it here.
//
// Source: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html (US files).
// Columns are matched by header text, not position, so a re-ordered sheet still loads; any
// expected column that isn't found is reported by the loader instead of silently skipped.
// ─────────────────────────────────────────────────────────────

export type BenchUnit = "pct" | "x" | "num";
export interface Cell { v?: unknown; w?: string }
export interface BenchRow { industry: string; metric: string; value: number; unit: BenchUnit; n_firms: number | null; source_file: string; source_column: string }

export const DATA_BASE = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/";
export const DATA_PAGE = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html";
export const TOTAL_MARKET = "Total Market";
export const TOTAL_MARKET_EX_FIN = "Total Market (without financials)";

interface ColSpec { metric: string; header: RegExp; unit: BenchUnit; nth?: number }
/** Files and the columns the Lens uses (header text verified against the Jan 2026 HTML mirrors). */
export const FILE_SPECS: { file: string; cols: ColSpec[] }[] = [
  { file: "margin.xls", cols: [
    { metric: "gross_margin", header: /^gross margin$/, unit: "pct" },
    { metric: "net_margin", header: /^net margin$/, unit: "pct" },
    { metric: "op_margin", header: /^pre-?tax unadjusted operating margin$/, unit: "pct" },
    { metric: "op_margin_pre_sbc", header: /pre-?stock compensation operating margin/, unit: "pct" },
    { metric: "ebitda_sales", header: /^ebitda\/sales$/, unit: "pct" },
    { metric: "rnd_sales", header: /^r&d\/sales$/, unit: "pct" },
    { metric: "sga_sales", header: /^sg&a\/ ?sales$/, unit: "pct" },
    { metric: "sbc_sales", header: /^stock-?based compensation\/sales$/, unit: "pct" },
  ] },
  { file: "EVA.xls", cols: [
    { metric: "roe", header: /^roe$/, unit: "pct" },
    { metric: "cost_of_equity", header: /^cost of equity$/, unit: "pct" },
    { metric: "roc", header: /^roc$/, unit: "pct" },
    { metric: "cost_of_capital", header: /^cost of capital$/, unit: "pct" },
    { metric: "roc_minus_wacc", header: /^\(?roc ?- ?wacc\)?$/, unit: "pct" },
  ] },
  { file: "capex.xls", cols: [
    { metric: "net_capex_sales", header: /^net cap ?ex ?\/ ?sales$/, unit: "pct" },
    { metric: "reinvestment_rate", header: /^net cap ?ex ?\/ ?ebit ?\(1-t\)$/, unit: "pct" },
    { metric: "sales_to_capital", header: /^sales ?\/ ?invested capital/, unit: "x" },
  ] },
  { file: "wacc.xls", cols: [
    { metric: "beta", header: /^beta$/, unit: "num" },
    { metric: "cost_of_debt", header: /^cost of debt$/, unit: "pct" },
    { metric: "tax_rate", header: /^tax rate$/, unit: "pct" },
  ] },
  { file: "dbtfund.xls", cols: [
    { metric: "debt_to_capital", header: /^market debt to capital \(unadjusted\)$/, unit: "pct" },
    { metric: "interest_coverage", header: /^interest coverage ratio$/, unit: "x" },
    { metric: "debt_to_ebitda", header: /^debt to ebitda$/, unit: "x" },
  ] },
  { file: "histgr.xls", cols: [
    { metric: "rev_cagr_5y", header: /^cagr in revenues ?- ?last 5 years$/, unit: "pct" },
    { metric: "ni_cagr_5y", header: /^cagr in net income ?- ?last 5 years$/, unit: "pct" },
  ] },
  { file: "pedata.xls", cols: [
    { metric: "pct_money_losing", header: /^% of money losing firms/, unit: "pct" },
    { metric: "pe", header: /only money making firms/, unit: "x" },
  ] },
  { file: "psdata.xls", cols: [
    { metric: "ps", header: /^price ?\/ ?sales$/, unit: "x" },
    { metric: "ev_sales", header: /^ev ?\/ ?sales$/, unit: "x" },
  ] },
  // EV/EBIT appears twice (positive-EBITDA firms first, then all firms); the Lens compares a
  // profitable company's ratio, so it takes the first.
  { file: "vebitda.xls", cols: [{ metric: "ev_ebit", header: /^ev ?\/ ?ebit$/, unit: "x", nth: 0 }] },
  { file: "divfcfe.xls", cols: [
    { metric: "cash_return_ni", header: /^cash return as % of net income$/, unit: "pct" },
    { metric: "net_cash_return_fcfe", header: /^net cash returned ?\/ ?fcfe \(pre-?debt\)$/, unit: "pct" },
  ] },
];

const normHeader = (s: string) => s.replace(/\s+/g, " ").replace(/\(\(/g, "(").trim().toLowerCase();
const cellText = (c: Cell | undefined) => (c?.w ?? (c?.v === undefined || c?.v === null ? "" : String(c.v))).trim();

/** Numeric value of a cell in the benchmark's unit (percent cells → 23.4 for 23.4%). */
export function cellNumber(c: Cell | undefined, unit: BenchUnit): number | null {
  if (!c) return null;
  const w = typeof c.w === "string" ? c.w.trim() : "";
  if (w.endsWith("%")) {
    const n = Number(w.replace(/[%,$\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof c.v === "number" && Number.isFinite(c.v)) return unit === "pct" ? c.v * 100 : c.v;   // unformatted fraction
  if (typeof c.v === "string") {
    const t = c.v.trim();
    const n = Number(t.replace(/[%,$\s]/g, ""));
    if (!Number.isFinite(n) || t === "") return null;
    return t.endsWith("%") || unit !== "pct" ? n : n * 100;
  }
  return null;
}

/** Parse one industry sheet. Returns the long-format rows and the expected columns it couldn't find. */
export function parseIndustrySheet(file: string, grid: Cell[][]): { rows: BenchRow[]; missing: string[]; industries: number } {
  const spec = FILE_SPECS.find((f) => f.file === file);
  if (!spec) return { rows: [], missing: [`no spec for ${file}`], industries: 0 };
  const h = grid.findIndex((r) => r.some((c) => normHeader(cellText(c)) === "industry name"));
  if (h < 0) return { rows: [], missing: spec.cols.map((c) => c.metric).concat("(header row 'Industry Name' not found)"), industries: 0 };
  const headers = grid[h].map((c) => normHeader(cellText(c)));
  const nameCol = headers.indexOf("industry name");
  const nCol = headers.findIndex((t) => /^number of firms$/.test(t));
  const colOf = new Map<string, number>();
  const missing: string[] = [];
  for (const c of spec.cols) {
    const hits = headers.map((t, i) => (c.header.test(t) ? i : -1)).filter((i) => i >= 0);
    const idx = hits[c.nth ?? 0];
    if (idx === undefined) missing.push(c.metric); else colOf.set(c.metric, idx);
  }
  const rows: BenchRow[] = [];
  let industries = 0;
  for (const r of grid.slice(h + 1)) {
    const name = cellText(r[nameCol]).replace(/\s+/g, " ");
    if (!name) continue;
    const nFirms = nCol >= 0 ? cellNumber(r[nCol], "num") : null;
    if (nFirms === null && name !== TOTAL_MARKET && !name.startsWith(TOTAL_MARKET)) continue;   // notes under the table
    industries++;
    for (const c of spec.cols) {
      const i = colOf.get(c.metric);
      if (i === undefined) continue;
      const v = cellNumber(r[i], c.unit);
      if (v === null) continue;
      rows.push({ industry: name, metric: c.metric, value: Math.round(v * 10000) / 10000, unit: c.unit, n_firms: nFirms === null ? null : Math.round(nFirms), source_file: file, source_column: grid[h][i]?.w ?? cellText(grid[h][i]) });
    }
  }
  return { rows, missing, industries };
}

/** Damodaran's company list (indname.xls): ticker → industry, US listings only. Column layout is
 *  found by header text ("Exchange:Ticker", "Industry Group", "Country"/"Broad Group"). */
export function parseIndname(grid: Cell[][]): { map: { symbol: string; industry: string; company: string | null }[]; error?: string } {
  const h = grid.findIndex((r) => r.some((c) => /ticker/i.test(cellText(c))) && r.some((c) => /industry/i.test(cellText(c))));
  if (h < 0) return { map: [], error: "header row with Ticker and Industry columns not found" };
  const hd = grid[h].map((c) => cellText(c).toLowerCase());
  const tick = hd.findIndex((t) => t.includes("ticker"));
  const ind = hd.findIndex((t) => /industry group/.test(t)) >= 0 ? hd.findIndex((t) => /industry group/.test(t)) : hd.findIndex((t) => /industry/.test(t));
  const country = hd.findIndex((t) => t === "country");
  const broad = hd.findIndex((t) => /broad group|region/.test(t));
  const name = hd.findIndex((t) => /company name|^name$/.test(t));
  const usEx = /^(nasdaq|nyse|nysearca|nyseamerican|amex|bats|otc)/i;
  const out = new Map<string, { symbol: string; industry: string; company: string | null }>();
  for (const r of grid.slice(h + 1)) {
    const raw = cellText(r[tick]);
    const industry = cellText(r[ind]);
    if (!raw || !industry) continue;
    const [ex, sym] = raw.includes(":") ? raw.split(":", 2) : ["", raw];
    const isUS = country >= 0 ? /united states/i.test(cellText(r[country]))
      : broad >= 0 ? /^(us|united states)/i.test(cellText(r[broad])) : usEx.test(ex);
    if (!isUS || !sym) continue;
    const symbol = sym.trim().toUpperCase().replace(/\./g, "-");
    if (!/^[A-Z0-9-]{1,10}$/.test(symbol) || out.has(symbol)) continue;
    out.set(symbol, { symbol, industry: industry.replace(/\s+/g, " "), company: name >= 0 ? cellText(r[name]) || null : null });
  }
  return { map: [...out.values()] };
}

// ── Lens metric → benchmark ─────────────────────────────────────────────────────────────

/** Which Damodaran aggregate a Lens metric is compared with. `note` explains a definition gap. */
export const BENCH_FOR_METRIC: Record<string, { metric: string; note?: string }> = {
  gross_margin: { metric: "gross_margin" },
  op_margin: { metric: "op_margin" },
  net_margin: { metric: "net_margin" },
  rnd_intensity: { metric: "rnd_sales" },
  sbc_intensity: { metric: "sbc_sales" },
  roe: { metric: "roe" },
  roic: { metric: "roc" },
  reinvestment_rate: { metric: "reinvestment_rate", note: "His industry figure counts net capital spending (incl. acquisitions and R&D) but not working capital, so it's a close, not exact, match." },
  sales_to_capital: { metric: "sales_to_capital" },
  interest_coverage: { metric: "interest_coverage" },
  debt_to_capital: { metric: "debt_to_capital" },
  debt_to_ebitda: { metric: "debt_to_ebitda" },
  rev_cagr_3y: { metric: "rev_cagr_5y", note: "The industry figure is the 5-year growth rate; the company's is 3 years." },
  ps: { metric: "ps" },
  pe: { metric: "pe", note: "Industry figure: total market cap ÷ total net income of the profitable firms." },
  ev_ebit: { metric: "ev_ebit" },
};

export interface Benchmark {
  industry: string;          // Damodaran industry name
  display: string;           // industry aggregate, formatted like the company metric
  market: string | null;     // whole-market aggregate
  n: number | null;          // firms in the industry
  position: "above" | "below" | "in line";
  note?: string;
  smallSample: boolean;
}

export type BenchIndex = Map<string, Map<string, { value: number; unit: BenchUnit; n: number | null }>>;
export function indexBenchmarks(rows: { industry: string; metric: string; value: number; unit: string; n_firms: number | null }[]): BenchIndex {
  const idx: BenchIndex = new Map();
  for (const r of rows) {
    if (!idx.has(r.industry)) idx.set(r.industry, new Map());
    idx.get(r.industry)!.set(r.metric, { value: Number(r.value), unit: r.unit as BenchUnit, n: r.n_firms });
  }
  return idx;
}

const fmtB = (v: number, unit: BenchUnit) => unit === "pct" ? `${v.toFixed(1)}%` : unit === "x" ? `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}×` : v.toFixed(2);

/** Compare one company metric with its industry aggregate (and the whole market). */
export function benchmarkFor(metricId: string, value: number | null, idx: BenchIndex, industry: string, financial: boolean): Benchmark | undefined {
  const b = BENCH_FOR_METRIC[metricId];
  const row = b && idx.get(industry)?.get(b.metric);
  if (!b || !row) return undefined;
  const mkt = idx.get(financial ? TOTAL_MARKET : TOTAL_MARKET_EX_FIN)?.get(b.metric) ?? idx.get(TOTAL_MARKET)?.get(b.metric);
  let position: Benchmark["position"] = "in line";
  if (typeof value === "number" && Number.isFinite(value)) {
    const tol = row.unit === "pct" ? Math.max(1, Math.abs(row.value) * 0.1) : Math.abs(row.value) * 0.1;
    position = value > row.value + tol ? "above" : value < row.value - tol ? "below" : "in line";
  }
  return {
    industry, display: fmtB(row.value, row.unit), market: mkt ? fmtB(mkt.value, mkt.unit) : null, n: row.n,
    position, note: b.note, smallSample: row.n !== null && row.n < 10,
  };
}

export interface IndustryProfile {
  name: string;
  match: "damodaran" | "mapped" | "market";   // his own company list · the app's GICS crosswalk · no match
  confidence: "close" | "approx" | null;
  from: string | null;                        // the GICS sub-industry it was mapped from
  n: number | null;
  asOf: string;                               // "January 2026"
  costOfCapital: string | null;
  costOfEquity: string | null;
  beta: string | null;
  pctMoneyLosing: string | null;
  marketCostOfCapital: string | null;
  smallSample: boolean;
}

export function industryProfile(idx: BenchIndex, name: string, match: IndustryProfile["match"], confidence: IndustryProfile["confidence"], from: string | null, asOf: string): IndustryProfile {
  const g = (m: string, ind = name) => { const r = idx.get(ind)?.get(m); return r ? fmtB(r.value, r.unit) : null; };
  const n = idx.get(name)?.values().next().value?.n ?? null;
  return {
    name, match, confidence, from, n, asOf,
    costOfCapital: g("cost_of_capital"), costOfEquity: g("cost_of_equity"), beta: g("beta"), pctMoneyLosing: g("pct_money_losing"),
    marketCostOfCapital: g("cost_of_capital", TOTAL_MARKET), smallSample: n !== null && n < 10,
  };
}

/** Raw number for derived metrics (ROIC − cost of capital). */
export const benchValue = (idx: BenchIndex, industry: string, metric: string) => idx.get(industry)?.get(metric)?.value ?? null;
