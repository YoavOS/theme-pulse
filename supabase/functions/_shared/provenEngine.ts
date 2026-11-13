// ─────────────────────────────────────────────────────────────
// Proven-Strong engine (PURE): has this business earned more than its capital costs — for how long,
// by which route, and is it holding? Damodaran's definition of a good business, measured over time.
//
//   annual panel (10-Ks) → per-year ROIC vs the industry's cost of capital → track → label + sentence
//
// Tracks (every company gets one — young companies included):
//   standard     ≥7 valid years: frequency, size, no 3-yr shortfall, cumulative value created + gates
//   cyclical     same tests on through-cycle (pooled) returns, frequency relaxed
//   financial    banks/insurers: return on equity vs cost of equity
//   capital_light invested capital ≈ 0 or negative (buybacks / negative working capital): ROIC n/m,
//                judged on steady profits and cash conversion
//   young        short record, fast growth or still losing money: judged on direction —
//                the product's economics, margins scaling, capital efficiency, returns on new capital
// Thresholds marked (judgement) are app choices from the research report, to be recalibrated.
// ─────────────────────────────────────────────────────────────
import { byPeriod, dur, factsFor, type Facts, type SecFact } from "./secFundamentals.ts";
import { LENS_FLOW, LENS_INSTANT, debtAt, type QuarterRow, type Stage } from "./lensMetrics.ts";

export const PROVEN_VERSION = 2;

const EXTRA_FLOW = {
  goodwillImpairment: ["GoodwillImpairmentLoss"],
  assetImpairment: ["AssetImpairmentCharges", "ImpairmentOfLongLivedAssetsHeldForUse"],
} as const;
type FlowKey = keyof typeof LENS_FLOW | keyof typeof EXTRA_FLOW;
type InstKey = keyof typeof LENS_INSTANT;

export interface YearRow {
  end: string; filed: string | null;
  flow: Partial<Record<FlowKey, number | null>>;
  inst: Partial<Record<InstKey, number | null>>;
  shares: number | null;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFY = (f: SecFact) => { const d = dur(f); return d >= 350 && d <= 380; };

/** Fiscal-year panel from 10-K facts, newest first (up to maxYears). */
export function parseAnnualPanel(json: { facts?: Record<string, Facts> }, maxYears = 13): YearRow[] {
  const gaap = json?.facts?.["us-gaap"];
  if (!gaap) return [];
  const lists = (names: readonly string[], unit: string[]) => factsFor(gaap, names, unit).map(byPeriod);
  const flowL = Object.fromEntries(Object.entries({ ...LENS_FLOW, ...EXTRA_FLOW }).map(([k, n]) => [k, lists(n, ["USD"])])) as Record<FlowKey, SecFact[][]>;
  const instL = Object.fromEntries(Object.entries(LENS_INSTANT).map(([k, n]) => [k, lists(n, ["USD"])])) as Record<InstKey, SecFact[][]>;
  const shareL = lists(["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic"], ["shares"]);

  // fiscal year-ends: full-year revenue / operating income / net income facts from a 10-K
  const ends = new Map<string, string | null>();
  for (const k of ["revenue", "operatingIncome", "netIncome"] as const) {
    for (const l of flowL[k]) for (const f of l) if (isFY(f) && /^10-K/.test(f.form ?? "") && !ends.has(f.end)) ends.set(f.end, f.filed ?? null);
  }
  // 52/53-week calendars can create near-duplicate ends; keep ends ≥300 days apart (newest wins)
  const sorted = [...ends.keys()].sort().reverse().filter((e, i, a) => i === 0 || Date.parse(a[i - 1]) - Date.parse(e) > 300 * 86400_000);
  const flowAt = (ls: SecFact[][], end: string) => { for (const l of ls) { const f = l.find((x) => x.end === end && isFY(x)); if (f) return f.val; } return null; };
  const instAt = (ls: SecFact[][], end: string) => { for (const l of ls) { const f = l.find((x) => !x.start && x.end === end); if (f) return f.val; } return null; };
  return sorted.slice(0, maxYears).map((end) => {
    const flow: YearRow["flow"] = {};
    for (const k of Object.keys(flowL) as FlowKey[]) flow[k] = flowAt(flowL[k], end);
    if (flow.grossProfit === null && fin(flow.revenue) && fin(flow.costOfRevenue)) flow.grossProfit = flow.revenue - flow.costOfRevenue;
    const inst: YearRow["inst"] = {};
    for (const k of Object.keys(instL) as InstKey[]) inst[k] = instAt(instL[k], end);
    return { end, filed: ends.get(end) ?? null, flow, inst, shares: flowAt(shareL, end) };
  });
}

/** Restate share counts across stock splits (near-whole ratio jumps between consecutive years). rows newest first. */
export function splitAdjustedShares(rows: YearRow[]): (number | null)[] {
  const out = rows.map((r) => r.shares);
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i], b = out[i + 1];
    if (!fin(a) || !fin(b) || b <= 0) continue;
    const r = a / b;
    const ratio = r >= 1 ? r : 1 / r;
    const whole = Math.round(ratio);
    if (whole >= 2 && Math.abs(ratio - whole) / whole < 0.06) {
      const f = r >= 1 ? whole : 1 / whole;
      for (let j = i + 1; j < out.length; j++) if (fin(out[j])) out[j] = out[j]! * f;
    }
  }
  return out;
}

// ── per-year metrics ────────────────────────────────────────────────────────────────

export interface YearMetrics {
  end: string; filed: string | null;
  revenue: number | null; ebit: number | null; nopat: number | null; tax: number;
  ic: number | null; icPrev: number | null;
  roic: number | null;          // NOPAT / beginning invested capital (%)
  roicRd: number | null;        // R&D capitalised (%)
  roicExGw: number | null;      // excluding goodwill (%)
  primary: number | null;       // the one the tests use (%)
  hurdle: number;               // cost of capital used (%)
  spread: number | null;        // primary − hurdle (pp)
  ep: number | null;            // economic profit ($)
  pooled3: number | null;       // 3-year pooled ROIC (%)
  margin: number | null;        // NOPAT / revenue (%)
  turnover: number | null;      // revenue / beginning capital (×)
  gm: number | null; opMargin: number | null;
  fcf: number | null; rndRev: number | null; sbcRev: number | null;
  reinvest: number | null;      // ΔIC / NOPAT (%)
  coverage: number | null; ndEbitda: number | null;
  roe: number | null; roeSpread: number | null;
  revGrowth: number | null;
  shares: number | null;
  acquisitions: number | null; goodwill: number | null;
  cashReturned: number | null;  // buybacks + dividends ($)
  dividends: number | null;     // ($)
  cashShare: number | null;     // cash + short-term investments as % of total assets
  debtToCapital: number | null; // book debt / (debt + equity), %
}

export interface EngineCtx {
  hurdle: number;               // industry cost of capital (%), before the floor
  costOfEquity: number | null;  // for financials
  financial: boolean;
  rndLife: number;              // years, for the R&D capitalisation
  industry: string | null;      // Damodaran industry
  industryGm: number | null;    // Damodaran industry gross margin (%)
  industrySalesToCapital: number | null;
  /** Life-cycle stage from the Lens (Damodaran's six stages) — decides which test applies. */
  stage?: Stage | null;
}
export const HURDLE_FLOOR = 0;  // Damodaran's industry cost of capital is used as he publishes it (no app floor)
const taxFor = (end: string) => (end < "2018-01-01" ? 0.35 : 0.25);   // hypothetical marginal rate (Damodaran)

export function yearMetrics(rows: YearRow[], ctx: EngineCtx): YearMetrics[] {
  const hurdle = Math.max(HURDLE_FLOOR, ctx.hurdle);
  const shares = splitAdjustedShares(rows);
  const icOf = (r: YearRow | undefined) => {
    if (!r) return null;
    const d = debtAt({ inst: r.inst } as QuarterRow).debt;
    const eq = r.inst.equity;
    if (!fin(eq)) return null;
    const cash = (r.inst.cash ?? 0) + (r.inst.stInvest ?? 0);
    return (d ?? 0) + (r.inst.opLease ?? 0) + eq - cash;
  };
  // research asset at each year-end (R&D capitalised over rndLife years; missing older years repeat the oldest)
  const N = Math.max(1, Math.round(ctx.rndLife));
  const rnd = rows.map((r) => (fin(r.flow.rnd) && r.flow.rnd >= 0 ? r.flow.rnd : null));
  const lastKnown = (i: number) => { for (let j = i; j < rnd.length; j++) if (fin(rnd[j])) return rnd[j]; for (let j = i; j >= 0; j--) if (fin(rnd[j])) return rnd[j]; return null; };
  const rv = (i: number) => (fin(rnd[i]) ? rnd[i]! : lastKnown(Math.min(i, rnd.length - 1)) ?? 0);
  const asset = (i: number) => { let s = 0; for (let j = 0; j < N; j++) s += rv(i + j) * (N - j) / N; return s; };
  const amort = (i: number) => { let s = 0; for (let j = 1; j <= N; j++) s += rv(i + j) / N; return s; };

  const out: YearMetrics[] = rows.map((r, i) => {
    const prev = rows[i + 1];
    const tax = taxFor(r.end);
    const rev = r.flow.revenue ?? null;
    const oi = r.flow.operatingIncome ?? null;
    const addBack = Math.max(0, r.flow.goodwillImpairment ?? 0) + Math.max(0, r.flow.assetImpairment ?? 0);
    const ebit = fin(oi) ? oi + addBack : null;
    const nopat = fin(ebit) ? (ebit > 0 ? ebit * (1 - tax) : ebit) : null;
    const ic = icOf(r), icPrev = icOf(prev);
    const tiny = (x: number | null) => !fin(x) || x <= 0 || (fin(rev) && x < 0.05 * Math.abs(rev));
    const roic = fin(nopat) && !tiny(icPrev) ? (nopat / icPrev!) * 100 : null;
    const hasRd = fin(rnd[i]) && fin(rev) && rev > 0;
    let roicRd: number | null = null;
    if (hasRd && fin(ebit) && fin(icPrev) && prev) {
      const ebitRd = ebit + rv(i) - amort(i);
      const nopatRd = ebitRd > 0 ? ebitRd * (1 - tax) : ebitRd;
      const icRd = icPrev + asset(i + 1);
      roicRd = icRd > 0 && !(fin(rev) && icRd < 0.05 * rev) ? (nopatRd / icRd) * 100 : null;
    }
    const gwPrev = prev?.inst.goodwill ?? 0;
    const icx = fin(icPrev) ? icPrev - (gwPrev ?? 0) : null;
    const roicExGw = fin(nopat) && !tiny(icx) ? (nopat / icx!) * 100 : null;
    const rndRev = hasRd ? (rnd[i]! / rev!) * 100 : fin(rev) && rev > 0 ? 0 : null;
    const primary = fin(roicRd) && fin(rndRev) && rndRev >= 3 ? roicRd : roic;   // R&D-heavy firms: economic return
    const spread = fin(primary) ? primary - hurdle : null;
    const icForEp = primary === roicRd && fin(icPrev) ? icPrev + asset(i + 1) : icPrev;
    const ep = fin(spread) && fin(icForEp) ? (spread / 100) * icForEp : null;
    const gp = r.flow.grossProfit ?? null;
    const fcf = fin(r.flow.ocf) ? r.flow.ocf - (r.flow.capex ?? 0) : null;
    const debt = debtAt({ inst: r.inst } as QuarterRow).debt;
    const cash = (r.inst.cash ?? 0) + (r.inst.stInvest ?? 0);
    const ebitda = fin(ebit) && fin(r.flow.dna) ? ebit + r.flow.dna : null;
    const interest = r.flow.interest;
    const roe = fin(r.flow.netIncome) && fin(prev?.inst.equity) && prev!.inst.equity! > 0 ? (r.flow.netIncome / prev!.inst.equity!) * 100 : null;
    const coe = ctx.costOfEquity;
    return {
      end: r.end, filed: r.filed, revenue: rev, ebit, nopat, tax: tax * 100, ic, icPrev,
      roic, roicRd, roicExGw, primary, hurdle, spread, ep, pooled3: null,
      margin: fin(nopat) && fin(rev) && rev > 0 ? (nopat / rev) * 100 : null,
      turnover: fin(rev) && !tiny(icPrev) ? rev / icPrev! : null,
      gm: fin(gp) && fin(rev) && rev > 0 ? (gp / rev) * 100 : null,
      opMargin: fin(oi) && fin(rev) && rev > 0 ? (oi / rev) * 100 : null,
      fcf, rndRev, sbcRev: fin(r.flow.sbc) && fin(rev) && rev > 0 ? (r.flow.sbc / rev) * 100 : null,
      reinvest: fin(ic) && fin(icPrev) && fin(nopat) && nopat > 0 ? ((ic - icPrev) / nopat) * 100 : null,
      coverage: fin(ebit) && fin(interest) && interest > 0 ? ebit / interest : null,
      ndEbitda: fin(ebitda) && ebitda > 0 ? ((debt ?? 0) - cash) / ebitda : null,
      roe, roeSpread: fin(roe) && fin(coe) ? roe - Math.max(HURDLE_FLOOR, coe) : null,
      revGrowth: fin(rev) && fin(prev?.flow.revenue) && prev!.flow.revenue! > 0 ? (rev / prev!.flow.revenue! - 1) * 100 : null,
      shares: shares[i],
      acquisitions: fin(r.flow.acquisitions) ? Math.max(0, r.flow.acquisitions) : null, goodwill: r.inst.goodwill ?? null,
      cashReturned: fin(r.flow.buybacks) || fin(r.flow.dividends) ? Math.max(0, r.flow.buybacks ?? 0) + Math.max(0, r.flow.dividends ?? 0) : null,
      dividends: fin(r.flow.dividends) ? Math.max(0, r.flow.dividends) : null,
      cashShare: fin(r.inst.assets) && r.inst.assets > 0 ? (cash / r.inst.assets) * 100 : null,
      debtToCapital: fin(r.inst.equity) && (debt ?? 0) + r.inst.equity > 0 ? ((debt ?? 0) / ((debt ?? 0) + r.inst.equity)) * 100 : null,
    };
  });
  // pooled 3-year return (Σ NOPAT / Σ beginning capital), on the same basis as `primary`
  for (let i = 0; i + 2 < out.length; i++) {
    const w = out.slice(i, i + 3);
    if (w.every((m) => fin(m.primary) && fin(m.nopat) && fin(m.icPrev))) {
      const useRd = w[0].primary === w[0].roicRd;
      const num = w.reduce((s, m) => s + (useRd ? (m.primary! / 100) * (m.icPrev! + asset(out.indexOf(m) + 1)) : m.nopat!), 0);
      const den = w.reduce((s, m) => s + (useRd ? m.icPrev! + asset(out.indexOf(m) + 1) : m.icPrev!), 0);
      out[i].pooled3 = den > 0 ? (num / den) * 100 : null;
    }
  }
  return out;
}

// ── statistics ──────────────────────────────────────────────────────────────────────

/** Theil–Sen slope (median of pairwise slopes), per year. xs/ys oldest → newest. */
export function theilSen(ys: number[]): number | null {
  if (ys.length < 3) return null;
  const s: number[] = [];
  for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) s.push((ys[j] - ys[i]) / (j - i));
  s.sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Weighted median: values newest first get weight 0.5^(age/halfLife). */
export function recencyMedian(vals: number[], halfLife = 5): number | null {
  if (!vals.length) return null;
  const items = vals.map((v, age) => ({ v, w: Math.pow(0.5, age / halfLife) })).sort((a, b) => a.v - b.v);
  const total = items.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of items) { acc += x.w; if (acc >= total / 2) return x.v; }
  return items[items.length - 1].v;
}
const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cagr = (a: number | null | undefined, b: number | null | undefined, years: number) => (fin(a) && fin(b) && a > 0 && b > 0 && years > 0 ? (Math.pow(a / b, 1 / years) - 1) * 100 : null);

// ── verdict ─────────────────────────────────────────────────────────────────────────

export type Track = "standard" | "cyclical" | "financial" | "capital_light" | "young";
export type Label = "elite" | "proven" | "proven_caveat" | "fading" | "provisional" | "emerging" | "emerging_early" | "was_strong" | "not_proven" | "insufficient";
export interface Check { id: string; label: string; pass: boolean | null; value: string; miss?: string }
export interface Verdict {
  version: number;
  track: Track; label: Label;
  sentence: string;             // the badge, in words
  why: string;                  // one line on how this kind of company is judged
  asOf: string | null;          // latest fiscal year-end
  yearsValid: number; yearsAbove: number;
  medianSpread: number | null;  // recency-weighted (pp)
  minPooledSpread: number | null;
  cumEp: number | null;
  spreadSlope: number | null;   // pp per year, last 5 years
  hurdle: number;
  checks: Check[];
  gates: Check[];
  flags: string[];              // still_compounding, rd_adjusted, ex_goodwill_better, cyclical_by_volatility, …
  archetype: string | null; archetypes: string[];
  score: number | null;         // internal list ordering only
  stage: Stage | null;
  series: { end: string; spread: number | null; primary: number | null; margin: number | null; turnover: number | null }[];
}

export const CYCLICAL_INDUSTRIES = /^(Oil\/Gas|Oilfield|Coal|Metals & Mining|Steel|Precious Metals|Chemical \(Basic\)|Auto & Truck|Auto Parts|Semiconductor Equip|Homebuilding|Air Transport|Shipbuilding|Paper\/Forest|Trucking|Building Materials|Rubber)/;
const pp = (v: number | null, d = 0) => (fin(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)} pp` : "n/a");
const pct = (v: number | null, d = 0) => (fin(v) ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%` : "n/a");
const trendWord = (s: number | null) => (!fin(s) ? "trend unclear" : s <= -2 ? "returns falling" : s < -0.5 ? "returns easing" : s > 1 ? "returns rising" : "trend flat");

const WHY: Record<Track, string> = {
  standard: "Judged on Damodaran's test of a good business: return on capital above what that capital costs, year after year.",
  cyclical: "A cyclical business: judged on returns across the whole cycle, not on any single year.",
  financial: "A bank or insurer: debt is its raw material, so the test is return on equity against the cost of equity.",
  capital_light: "Runs on almost no invested capital (or negative), so return on capital isn't meaningful — judged on steady profits and how much of them turn into cash.",
  young: "A young or fast-changing business: too early to prove excess returns, so it's judged on direction — are the economics of the product good, are margins scaling, and does new capital earn more than it costs?",
};

export function evaluate(ms: YearMetrics[], ctx: EngineCtx, now = new Date()): Verdict {
  const hurdle = Math.max(HURDLE_FLOOR, ctx.hurdle);
  const window = ms.slice(0, 10);
  const latest = ms[0];
  const flags: string[] = [];
  const stage = ctx.stage ?? null;
  const base = {
    version: PROVEN_VERSION, asOf: latest?.end ?? null, hurdle, flags, stage,
    series: window.map((m) => ({ end: m.end, spread: m.spread, primary: m.primary, margin: m.margin, turnover: m.turnover })).reverse(),
  };
  if (!latest) {
    return { ...base, track: "young", label: "insufficient", sentence: "No annual filings to judge yet.", why: WHY.young, yearsValid: 0, yearsAbove: 0, medianSpread: null, minPooledSpread: null, cumEp: null, spreadSlope: null, checks: [], gates: [], archetype: null, archetypes: [], score: null };
  }
  // stale filer (no 10-K for ~2 years) → still evaluated, flagged
  if (now.getTime() - Date.parse(latest.end) > 760 * 86400_000) flags.push("stale_filings");

  // ── financials: ROE vs cost of equity ──
  if (ctx.financial) {
    const sp = window.map((m) => m.roeSpread).filter(fin);
    const above = sp.filter((v) => v > 0).length;
    const wm = recencyMedian(window.map((m) => m.roeSpread).filter(fin));
    const slope = theilSen(window.slice(0, 5).map((m) => m.roeSpread).filter(fin).reverse());
    const checks: Check[] = [
      { id: "freq", label: "ROE above the cost of equity in most years", pass: sp.length >= 7 ? above >= Math.ceil(0.7 * sp.length) : null, value: `${above} of ${sp.length} years` },
      { id: "size", label: "By a real margin", pass: fin(wm) ? wm >= 3 : null, value: pp(wm, 1) },
    ];
    let label: Label = sp.length < 5 ? (sp.length >= 3 && above >= sp.length - 1 && fin(wm) && wm >= 3 ? "provisional" : "insufficient")
      : checks.every((c) => c.pass) ? (fin(slope) && slope <= -2 ? "fading" : above >= Math.ceil(0.8 * sp.length) && fin(wm) && wm >= 5 ? "elite" : "proven") : "not_proven";
    if (sp.length >= 5 && sp.length < 7 && label === "not_proven" && above >= sp.length - 1 && fin(wm) && wm >= 3) label = "provisional";
    const sentence = sp.length ? `Return on equity beat its cost of equity in ${above} of the last ${sp.length} years; median gap ${pp(wm)}; ${trendWord(slope)}.` : "Not enough years of equity returns to judge.";
    return { ...base, track: "financial", label, sentence, why: WHY.financial, yearsValid: sp.length, yearsAbove: above, medianSpread: wm, minPooledSpread: null, cumEp: null, spreadSlope: slope, checks, gates: [], archetype: null, archetypes: [], score: fin(wm) ? Math.round(Math.max(0, Math.min(100, 50 + wm * 3 + (above / Math.max(1, sp.length)) * 20))) : null };
  }

  const valid = window.filter((m) => fin(m.spread));
  const n = valid.length;
  const above = valid.filter((m) => m.spread! > 0).length;
  const wm = recencyMedian(window.map((m) => m.spread).filter(fin));
  const pooledSpreads = window.map((m) => (fin(m.pooled3) ? m.pooled3 - hurdle : null)).filter(fin);
  const minPooled = pooledSpreads.length ? Math.min(...pooledSpreads) : null;
  const cumEp = valid.length ? valid.reduce((s, m) => s + (m.ep ?? 0), 0) : null;
  const slope = theilSen(window.slice(0, 5).map((m) => m.spread).filter(fin).reverse());
  if (window.some((m) => m.primary !== null && m.primary === m.roicRd)) flags.push("rd_adjusted");

  // capital-light: invested capital ≈ 0 / negative in most years
  const tinyYears = window.filter((m) => fin(m.nopat) && m.roic === null).length;
  const capitalLight = window.length >= 3 && tinyYears >= Math.ceil(window.length / 2);

  // cyclical: by industry, or by volatile returns (coefficient of variation > 0.75)
  const prim = valid.map((m) => m.primary!);
  const meanP = prim.length ? prim.reduce((s, v) => s + v, 0) / prim.length : 0;
  const cv = prim.length >= 5 && meanP > 0 ? Math.sqrt(prim.reduce((s, v) => s + (v - meanP) ** 2, 0) / prim.length) / meanP : 0;
  const cyclical = (!!ctx.industry && CYCLICAL_INDUSTRIES.test(ctx.industry)) || cv > 0.75;
  if (cyclical && !(ctx.industry && CYCLICAL_INDUSTRIES.test(ctx.industry))) flags.push("cyclical_by_volatility");

  // gates (latest year) — solvency and quality of evidence
  const nopatSum = window.reduce((s, m) => s + (fin(m.nopat) && m.nopat > 0 ? m.nopat : 0), 0);
  const fcfSum = window.reduce((s, m) => s + (m.fcf ?? 0), 0);
  const conv = nopatSum > 0 ? fcfSum / nopatSum : null;
  const firstShares = [...window].reverse().find((m) => fin(m.shares))?.shares;
  const yearsSpan = window.length - 1;
  const dil = cagr(latest.shares, firstShares, yearsSpan);
  const netCash = fin(latest.ndEbitda) ? latest.ndEbitda <= 0 : false;
  const gates: Check[] = [
    { id: "solvency", miss: "thin interest coverage", label: "Can carry its debt (interest covered ≥ 3×, or net cash)", pass: netCash || (fin(latest.coverage) ? latest.coverage >= 3 : fin(latest.ndEbitda) ? latest.ndEbitda <= 3 : null), value: netCash ? "net cash" : fin(latest.coverage) ? `${latest.coverage.toFixed(1)}× coverage` : "n/a" },
    { id: "leverage", miss: "heavy debt", label: "Net debt ≤ 3× EBITDA", pass: fin(latest.ndEbitda) ? latest.ndEbitda <= 3 : null, value: fin(latest.ndEbitda) ? `${latest.ndEbitda.toFixed(1)}×` : "n/a" },
    { id: "cash", miss: "profits not turning into cash", label: "Profits turn into cash (free cash flow ≥ 60% of after-tax operating income)", pass: fin(conv) ? conv >= 0.6 : null, value: fin(conv) ? `${Math.round(conv * 100)}%` : "n/a" },
    { id: "dilution", miss: "share count inflating", label: "Share count not inflating (≤ 3% a year)", pass: fin(dil) ? dil <= 3 : null, value: fin(dil) ? `${dil >= 0 ? "+" : ""}${dil.toFixed(1)}%/yr` : "n/a" },
  ];
  const gatesOk = gates.every((g) => g.pass !== false);

  // archetype: how it earns the spread (ROIC = margin × turnover)
  const mMargin = med(window.map((m) => m.margin).filter(fin));
  const mTurn = med(window.map((m) => m.turnover).filter(fin));
  const mRd = med(window.map((m) => m.rndRev).filter(fin));
  // serial acquirer: acquisitions over the window > 30% of ending capital, or goodwill > 40% of it (judgement).
  // Its returns are judged WITH goodwill — overpaying for deals is part of the capital it used (Damodaran).
  const acqSum = window.reduce((s, m) => s + (m.acquisitions ?? 0), 0);
  const gwShare = fin(latest.ic) && latest.ic > 0 && fin(latest.goodwill) ? latest.goodwill / latest.ic : 0;
  const acquirer = (fin(latest.ic) && latest.ic > 0 && acqSum > 0.3 * latest.ic) || gwShare > 0.4;
  const exGwBetter = med(window.map((m) => (fin(m.roicExGw) && fin(m.roic) ? m.roicExGw - m.roic : null)).filter(fin));
  if (acquirer && fin(exGwBetter) && exGwBetter > 5) flags.push("ex_goodwill_better");
  const archetypes: string[] = [];
  if (acquirer) archetypes.push("serial_acquirer");
  const incr = incrementalRoic(ms);
  const reinvestAvg = med(window.slice(0, 3).map((m) => m.reinvest).filter(fin));
  const stillCompounding = fin(incr) && incr >= hurdle + 5 && fin(reinvestAvg) && reinvestAvg >= 30;
  if (stillCompounding) flags.push("still_compounding");
  if (capitalLight) archetypes.push("capital_negative");
  if (fin(mRd) && mRd >= 10) archetypes.push("rd_innovator");
  if (fin(mMargin) && fin(mTurn)) {
    if (mMargin >= 15 && mTurn >= 1.5) archetypes.push("capital_light_compounder");
    else if (mMargin >= 20 && mTurn < 1.5) archetypes.push("high_margin");
    else if (mMargin < 8 && mTurn >= 2.5) archetypes.push("high_turnover");
    else if (mTurn < 0.8) archetypes.push("asset_heavy");
  }
  if (stillCompounding) archetypes.push("reinvesting_compounder");
  if (cyclical) archetypes.push("cyclical");

  // young track triggers
  const revs = window.map((m) => m.revenue);
  const cagr5 = cagr(revs[0], revs[Math.min(5, revs.length - 1)], Math.min(5, revs.length - 1));
  const cumOpLoss = window.slice(0, 5).reduce((s, m) => s + (m.ebit ?? 0), 0) < 0;

  const score = (fin(wm) ? Math.max(-10, Math.min(30, wm)) * 1.2 : 0) + (n ? (above / n) * 25 : 0) + (fin(incr) ? Math.max(-10, Math.min(40, incr - hurdle)) * 0.4 : 0)
    + (gates.find((g) => g.id === "cash")?.pass ? 10 : 0) + (gates.find((g) => g.id === "dilution")?.pass ? 5 : 0) + 20;

  const common = { yearsValid: n, yearsAbove: above, medianSpread: wm, minPooledSpread: minPooled, cumEp, spreadSlope: slope, gates, archetype: archetypes[0] ?? null, archetypes, score: Math.round(Math.max(0, Math.min(100, score))) };

  // ── capital-light ──
  if (capitalLight) {
    const posYears = window.filter((m) => fin(m.nopat) && m.nopat > 0).length;
    const marginSlope = theilSen(window.slice(0, 5).map((m) => m.opMargin).filter(fin).reverse());
    const checks: Check[] = [
      { id: "profit", label: "Profitable in most years", pass: window.length >= 5 ? posYears >= Math.ceil(0.8 * window.length) : null, value: `${posYears} of ${window.length} years` },
      { id: "cash", label: "Profits turn into cash (≥ 90%)", pass: fin(conv) ? conv >= 0.9 : null, value: fin(conv) ? `${Math.round(conv * 100)}%` : "n/a" },
      { id: "margin", label: "Margins holding", pass: fin(marginSlope) ? marginSlope > -1 : null, value: fin(marginSlope) ? `${marginSlope >= 0 ? "+" : ""}${marginSlope.toFixed(1)} pp/yr` : "n/a" },
    ];
    const label: Label = window.length < 5 ? "insufficient" : checks.every((c) => c.pass !== false) && window.length >= 7 ? "proven" : checks.every((c) => c.pass !== false) ? "provisional" : "not_proven";
    return { ...base, ...common, track: "capital_light", label, why: WHY.capital_light, checks,
      sentence: `Runs on little or negative invested capital; profitable in ${posYears} of ${window.length} years, turning ${fin(conv) ? Math.round(conv * 100) + "%" : "an unknown share"} of profit into cash.` };
  }

  // ── standard / cyclical tests ──
  const pooledAll = (() => {
    const v = valid.filter((m) => fin(m.nopat) && fin(m.icPrev) && m.icPrev! > 0);
    const num = v.reduce((s, m) => s + (m.primary! / 100) * m.icPrev!, 0), den = v.reduce((s, m) => s + m.icPrev!, 0);
    return den > 0 ? (num / den) * 100 - hurdle : null;
  })();
  const freqNeed = Math.ceil((cyclical ? 0.6 : 0.7) * n);
  const checks: Check[] = [
    { id: "freq", miss: "too few years above its cost of capital", label: "Earned more than its cost of capital in most years", pass: n >= 3 ? above >= freqNeed : null, value: `${above} of ${n} years` },
    { id: "size", miss: "spread too thin", label: "By a real margin (median ≥ 3 pp)", pass: fin(wm) ? wm >= 3 : null, value: pp(wm, 1) },
    cyclical
      ? { id: "shortfall", miss: "below its cost of capital across the cycle", label: "Across the whole cycle, returns beat the cost of capital", pass: fin(pooledAll) ? pooledAll >= 0 : null, value: pp(pooledAll, 1) }
      : { id: "shortfall", miss: "a 3-year stretch below its cost of capital", label: "Never three weak years in a row", pass: fin(minPooled) ? minPooled >= 0 : null, value: `worst 3-yr ${pp(minPooled, 1)}` },
    { id: "value", miss: "destroyed value in total", label: "Created value in total over the period", pass: fin(cumEp) ? cumEp > 0 : null, value: fin(cumEp) ? `${cumEp >= 0 ? "+" : "−"}$${(Math.abs(cumEp) / 1e9).toFixed(cumEp > 1e10 || cumEp < -1e10 ? 0 : 1)}B` : "n/a" },
  ];
  const testsPass = checks.every((c) => c.pass === true);
  // Damodaran: what "good" looks like depends on the stage — act your age (informational, not part of the pass)
  const age = ageCheck(stage, window, hurdle, incr);
  if (age) { checks.push(age); if (age.pass === false) flags.push("not_acting_age"); }
  const elite = testsPass && above >= Math.ceil((cyclical ? 0.7 : 0.8) * n) && fin(wm) && wm >= 5;
  const fadingNow = fin(slope) && slope <= -2 || (window.length >= 2 && window.slice(0, 2).every((m) => fin(m.spread) && m.spread < 0));

  const recordSentence = `Earned more than its cost of capital in ${above} of the last ${n} years; median spread ${pp(wm)}; ${trendWord(slope)}.`;
  const track: Track = cyclical ? "cyclical" : "standard";

  if (n >= 7 && testsPass) {
    const label: Label = fadingNow ? "fading" : !gatesOk ? "proven_caveat" : elite ? "elite" : "proven";
    const caveat = gates.filter((g) => g.pass === false).map((g) => g.miss ?? g.label);
    const sentence = label === "proven_caveat" ? `${recordSentence} Caveat: ${caveat.join("; ")}.` : label === "fading" ? `${recordSentence.replace(/; [^;]*\.$/, "")}; but the spread is shrinking.` : recordSentence;
    return { ...base, ...common, track, label, sentence, why: WHY[track], checks };
  }

  // not proven on the full test — young / short record? The life-cycle stage decides when it's known:
  // start-ups and young growth firms are always judged on direction; mature and declining firms never are.
  const youngByStage = stage === "startup" || stage === "young_growth";
  const matureByStage = stage === "mature_growth" || stage === "mature_stable" || stage === "decline";
  const young = youngByStage || (!matureByStage && (n < 7 || (fin(cagr5) && cagr5 > 20) || cumOpLoss));
  if (!young && n < 7) {
    // a mature business with a short public record (recent listing / spin-off)
    if (n >= 3 && above >= n - 1 && fin(wm) && wm >= 3 && !fadingNow) {
      return { ...base, ...common, track, label: "provisional", why: WHY[track], checks,
        sentence: `Short record but a clean one: earned more than its cost of capital in ${above} of ${n} years (median ${pp(wm)}). Needs more years to count as proven.` };
    }
    return { ...base, ...common, track, label: n < 3 ? "insufficient" : "not_proven", why: WHY[track], checks,
      sentence: n < 3 ? `Only ${n} year${n === 1 ? "" : "s"} of comparable annual reports — too short to judge.` : `Short record: ${recordSentence.charAt(0).toLowerCase()}${recordSentence.slice(1)}` };
  }
  if (young) {
    const yc = youngChecks(window, ctx, hurdle, incr);
    // a short but clean record of excess returns
    if (n >= 3 && above >= n - 1 && fin(wm) && wm >= 3 && !fadingNow) {
      return { ...base, ...common, track: "young", label: "provisional", why: WHY.young, checks: [...checks, ...yc.checks],
        sentence: `Short record but a clean one: earned more than its cost of capital in ${above} of ${n} years (median ${pp(wm)}). Needs more years to count as proven.` };
    }
    const label: Label = window.length < 2 ? "insufficient" : yc.onTrack ? "emerging" : "emerging_early";
    const sentence = label === "insufficient" ? "Too new to judge — fewer than two annual reports." : label === "emerging"
      ? `Not proven yet, but showing the signature: ${yc.passed.join(", ")}.`
      : `Too early to see the signature${yc.passed.length ? ` — so far: ${yc.passed.join(", ")}` : ""}; ${yc.missing.slice(0, 2).join(", ")} not there yet.`;
    return { ...base, ...common, track: "young", label, sentence, why: WHY.young, checks: age ? [...yc.checks, age] : yc.checks };
  }

  // had it before, lost it?
  const earlier = ms.slice(3, 13);
  if (earlier.length >= 7) {
    const ev = earlier.filter((m) => fin(m.spread));
    const ab = ev.filter((m) => m.spread! > 0).length;
    const ewm = recencyMedian(earlier.map((m) => m.spread).filter(fin));
    if (ev.length >= 7 && ab >= Math.ceil(0.7 * ev.length) && fin(ewm) && ewm >= 3) {
      return { ...base, ...common, track, label: "was_strong", why: WHY[track], checks,
        sentence: `Was strong (to ${earlier[0].end.slice(0, 4)}: ${ab} of ${ev.length} years above its cost of capital) but no longer passes: ${recordSentence.charAt(0).toLowerCase()}${recordSentence.slice(1)}` };
    }
  }
  const failed = checks.filter((c) => c.pass === false).map((c) => c.miss ?? c.label);
  return { ...base, ...common, track, label: "not_proven", why: WHY[track], checks,
    sentence: `${recordSentence}${failed.length ? ` Misses: ${failed.join("; ")}.` : ""}` };
}

/** Damodaran's "act your age": each stage has a right way to use capital — and a typical way to get
 *  it wrong (Corporate Life Cycle, 2024): young firms that borrow or pay dividends too early, growth
 *  firms that reinvest below their cost of capital, mature-growth firms that hoard cash, stable firms
 *  that try to buy growth with acquisitions, declining firms that pour money into a comeback.
 *  Informational — it never changes the label. Thresholds are judgement. */
export function ageCheck(stage: Stage | null, window: YearMetrics[], hurdle: number, incr: number | null): Check | null {
  if (!stage || !window.length) return null;
  const w3 = window.slice(0, 3);
  const sum = (k: keyof YearMetrics) => w3.reduce((s, m) => s + (fin(m[k]) ? (m[k] as number) : 0), 0);
  const fcf3 = sum("fcf"), ret3 = sum("cashReturned"), div3 = sum("dividends"), acq3 = sum("acquisitions"), rev3 = sum("revenue");
  const payout = fcf3 > 0 ? (ret3 / fcf3) * 100 : null;
  const acqShare = fcf3 > 0 ? (acq3 / fcf3) * 100 : null;
  const k = Math.min(3, window.length - 1);
  const capGrowth = k > 0 && fin(window[0].ic) && fin(window[k].ic) && window[k].ic! > 0 ? (window[0].ic! / window[k].ic! - 1) * 100 : null;
  const latest = window[0];
  const parts: { ok: boolean | null; text: string; miss: string }[] = [];
  let label = "";
  if (stage === "startup" || stage === "young_growth") {
    label = "Acting its age (young): funded by equity, not debt, and not paying dividends yet";
    const divs = rev3 > 0 ? (div3 / rev3) * 100 : 0;
    parts.push({ ok: divs <= 1, text: divs > 1 ? `pays dividends (${divs.toFixed(1)}% of revenue)` : "no dividends", miss: "paying dividends too early" });
    parts.push({ ok: fin(latest.debtToCapital) ? latest.debtToCapital <= 50 : null, text: fin(latest.debtToCapital) ? `debt ${Math.round(latest.debtToCapital)}% of capital` : "debt n/a", miss: "borrowing heavily too young" });
  } else if (stage === "high_growth" || stage === "mature_growth") {
    label = stage === "high_growth" ? "Acting its age (high growth): new capital earns more than it costs, so reinvesting adds value"
      : "Acting its age (mature growth): still reinvesting well, and not sitting on cash it can't use";
    parts.push({ ok: fin(incr) ? incr > hurdle : null, text: fin(incr) ? `new capital earns ${pct(incr)} vs ${pct(hurdle, 1)}` : "returns on new capital n/a", miss: "reinvesting at returns below its cost" });
    if (stage === "mature_growth") {
      const hoard = fin(latest.cashShare) && latest.cashShare > 30 && !(fin(payout) && payout >= 25);
      parts.push({ ok: fin(latest.cashShare) ? !hoard : null, text: fin(latest.cashShare) ? `cash ${Math.round(latest.cashShare)}% of assets` : "cash n/a", miss: "hoarding cash" });
    }
  } else if (stage === "mature_stable") {
    label = "Acting its age (mature): returns the cash it can't reinvest well, rather than buying growth with acquisitions";
    parts.push({ ok: fin(payout) ? payout >= 50 : null, text: fin(payout) ? `${Math.round(payout)}% of FCF returned` : fcf3 <= 0 ? "no free cash flow" : "payout n/a", miss: "holding on to cash it can't reinvest well" });
    parts.push({ ok: fin(acqShare) ? acqShare <= 50 : null, text: fin(acqShare) ? `acquisitions ${Math.round(acqShare)}% of FCF` : "acquisitions n/a", miss: "trying to buy growth through acquisitions" });
  } else {
    label = "Acting its age (decline): shrinking gracefully — not pouring capital into a comeback that earns less than it costs, and returning cash";
    const reinvestingBelowCost = fin(capGrowth) && capGrowth > 10 && !(fin(incr) && incr > hurdle);
    parts.push({ ok: fin(capGrowth) ? !reinvestingBelowCost : null, text: fin(capGrowth) ? `capital ${capGrowth >= 0 ? "+" : ""}${capGrowth.toFixed(0)}% in 3 yrs` : "capital n/a", miss: "investing to grow despite returns below its cost" });
    if (fin(payout)) parts.push({ ok: payout >= 50, text: `${Math.round(payout)}% of FCF returned`, miss: "not returning cash" });
  }
  const known = parts.filter((p) => p.ok !== null);
  const failed = parts.filter((p) => p.ok === false);
  return { id: "age", label, miss: failed.map((p) => p.miss).join("; ") || undefined,
    pass: known.length ? failed.length === 0 : null, value: parts.map((p) => p.text).join(" · ") };
}

/** Incremental ROIC over up to 5 years: ΔNOPAT / Δ beginning capital (%), when capital grew ≥ 5%. */
export function incrementalRoic(ms: YearMetrics[]): number | null {
  const k = Math.min(5, ms.length - 1);
  if (k < 2) return null;
  const a = ms[0], b = ms[k];
  if (!fin(a.nopat) || !fin(b.nopat) || !fin(a.icPrev) || !fin(b.icPrev) || b.icPrev <= 0) return null;
  const dIc = a.icPrev - b.icPrev;
  if (dIc <= 0.05 * b.icPrev) return null;
  return ((a.nopat - b.nopat) / dIc) * 100;
}

/** Young-company signature: good product economics, margins scaling, capital-efficient growth,
 *  and — once profitable — new capital earning more than it costs. */
function youngChecks(window: YearMetrics[], ctx: EngineCtx, hurdle: number, incr: number | null) {
  const latest = window[0];
  const gmRecent = med(window.slice(0, 2).map((m) => m.gm).filter(fin));
  const omSlope = theilSen(window.slice(0, 4).map((m) => m.opMargin).filter(fin).reverse());
  const s2c = med(window.slice(0, 2).map((m) => m.turnover).filter(fin));
  const g3 = cagr(window[0]?.revenue, window[Math.min(3, window.length - 1)]?.revenue, Math.min(3, window.length - 1));
  const profitable = fin(latest?.nopat) && latest.nopat > 0;
  const checks: Check[] = [
    { id: "growth", label: "Growing fast (revenue ≥ 15%/yr)", pass: fin(g3) ? g3 >= 15 : null, value: fin(g3) ? `${g3.toFixed(0)}%/yr` : "n/a" },
    { id: "gm", label: `Good product economics (gross margin ≥ ${ctx.industry ?? "industry"} average)`, pass: fin(gmRecent) && fin(ctx.industryGm) ? gmRecent >= ctx.industryGm : null, value: fin(gmRecent) ? `${pct(gmRecent)}${fin(ctx.industryGm) ? ` vs ${pct(ctx.industryGm)}` : ""}` : "n/a" },
    { id: "scaling", label: "Operating margin rising as it grows", pass: fin(omSlope) ? omSlope > 0.5 : null, value: fin(omSlope) ? `${omSlope >= 0 ? "+" : ""}${omSlope.toFixed(1)} pp/yr` : "n/a" },
    { id: "efficiency", label: "Capital-efficient growth (sales per $ of capital ≥ industry)", pass: fin(s2c) && fin(ctx.industrySalesToCapital) ? s2c >= ctx.industrySalesToCapital : null, value: fin(s2c) ? `${s2c.toFixed(2)}×${fin(ctx.industrySalesToCapital) ? ` vs ${ctx.industrySalesToCapital.toFixed(2)}×` : ""}` : "n/a" },
    { id: "incremental", label: "New capital earning more than it costs", pass: profitable && fin(incr) ? incr > hurdle : null, value: profitable ? (fin(incr) ? pct(incr) : "n/a") : "not profitable yet" },
  ];
  const short: Record<string, string> = { growth: "fast growth", gm: "strong gross margins", scaling: "margins scaling up", efficiency: "capital-efficient growth", incremental: "high returns on new capital" };
  const passed = checks.filter((c) => c.pass === true).map((c) => short[c.id]);
  const missing = checks.filter((c) => c.pass === false).map((c) => short[c.id]);
  const applicable = checks.filter((c) => c.pass !== null).length;
  const scaling = checks.find((c) => c.id === "scaling")!.pass;
  const onTrack = applicable >= 3 && passed.length >= Math.ceil(applicable * 0.6) && scaling !== false;
  return { checks, passed, missing, onTrack };
}

export const LABEL_TEXT: Record<Label, string> = {
  elite: "Proven · elite", proven: "Proven", proven_caveat: "Proven, with a caveat", fading: "Proven but fading",
  provisional: "Provisional", emerging: "Emerging", emerging_early: "Early", was_strong: "Was strong", not_proven: "Not proven", insufficient: "Too new",
};
export const ARCHETYPE_TEXT: Record<string, string> = {
  capital_light_compounder: "Capital-light compounder", high_margin: "High-margin route", high_turnover: "High-turnover route",
  asset_heavy: "Asset-heavy", rd_innovator: "R&D-driven", reinvesting_compounder: "Reinvesting at high returns",
  cyclical: "Cyclical", capital_negative: "Runs on others' money", serial_acquirer: "Grows by acquisition",
};
