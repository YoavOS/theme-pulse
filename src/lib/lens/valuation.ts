// "What is the price betting on?" — narrative and numbers, in Damodaran's spirit (PURE, tested).
//
// Instead of guessing a value, turn the price into the story it implies: what revenue growth, at the
// margin and capital efficiency you believe, makes the business worth today's enterprise value?
// That's his break-even way of reading a price (Trillion Dollar Market Caps, Dec 2025), done with a
// standard 10-year free-cash-flow model:
//   revenue grows at g for 5 years, then fades to the risk-free rate by year 10
//   operating margin moves from today's to the target margin over 5 years
//   reinvestment = new revenue ÷ sales-to-capital   (growth has to be paid for)
//   FCFF = operating income × (1 − tax) − reinvestment, discounted at the cost of capital
//   terminal: growth = risk-free rate, return on new capital = cost of capital + edge
//             (edge 0 = competition erodes excess returns to zero — his default)

export interface Story {
  revenue: number; opMargin: number;        // today (revenue $, margin %)
  targetMargin: number;                     // % reached by year 5
  salesToCapital: number;                   // × — $ of new revenue per $ reinvested
  costOfCapital: number;                    // %
  taxRate: number;                          // fraction
  riskFree: number;                         // % — terminal growth ceiling
  terminalEdge: number;                     // pp — excess return kept forever (0 = none)
}
export interface Path { year: number; revenue: number; margin: number; nopat: number; reinvest: number; fcff: number }

export function valueOf(s: Story, g: number): { value: number; path: Path[]; terminal: number } {
  const r = s.costOfCapital / 100, rf = Math.min(s.riskFree, s.costOfCapital - 0.5) / 100;
  const path: Path[] = [];
  let rev = s.revenue, value = 0;
  for (let t = 1; t <= 10; t++) {
    const gt = t <= 5 ? g / 100 : g / 100 - ((g / 100 - rf) * (t - 5)) / 5;
    const prev = rev;
    rev = prev * (1 + gt);
    const margin = t <= 5 ? s.opMargin + ((s.targetMargin - s.opMargin) * t) / 5 : s.targetMargin;
    const ebit = rev * (margin / 100);
    const nopat = ebit > 0 ? ebit * (1 - s.taxRate) : ebit;
    const reinvest = (rev - prev) / Math.max(0.05, s.salesToCapital);
    const fcff = nopat - reinvest;
    value += fcff / Math.pow(1 + r, t);
    path.push({ year: t, revenue: rev, margin, nopat, reinvest, fcff });
  }
  const last = path[9];
  const nopat11 = last.nopat * (1 + rf);
  const roicT = r + s.terminalEdge / 100;
  const reinvRate = roicT > 0 ? Math.min(1, rf / roicT) : 1;
  const terminal = nopat11 > 0 ? (nopat11 * (1 - reinvRate)) / (r - rf) : 0;
  value += terminal / Math.pow(1 + r, 10);
  return { value, path, terminal };
}

export type Implied =
  | { kind: "ok"; growth: number; path: Path[]; value: number }
  | { kind: "beyond"; maxGrowth: number }           // even 80%/yr for 5 years falls short
  | { kind: "shrink" }                               // value exceeds price even if revenue shrinks
  | { kind: "growth_destroys"; valueAtZero: number }; // new capital earns less than it costs: growth lowers value

/** Return on the capital new growth needs, after tax (%): target margin × (1−t) × sales-to-capital. */
export const returnOnNewCapital = (s: Story) => s.targetMargin * (1 - s.taxRate) * s.salesToCapital;

/** Solve for the 5-year revenue growth that makes value = enterprise value. */
export function impliedGrowth(s: Story, ev: number): Implied {
  const roNew = returnOnNewCapital(s);
  const lo = -20, hi = 80;
  const vLo = valueOf(s, lo).value, vHi = valueOf(s, hi).value;
  if (roNew <= s.costOfCapital) {
    // growth can't raise value; is the price covered without it?
    const v0 = valueOf(s, 0).value;
    if (v0 >= ev) return { kind: "shrink" };
    return { kind: "growth_destroys", valueAtZero: v0 };
  }
  if (vLo >= ev) return { kind: "shrink" };
  if (vHi < ev) return { kind: "beyond", maxGrowth: hi };
  let a = lo, b = hi;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (valueOf(s, m).value < ev) a = m; else b = m;
  }
  const g = (a + b) / 2;
  const res = valueOf(s, g);
  return { kind: "ok", growth: g, path: res.path, value: res.value };
}

/** Where does the price's demand sit against what the company has done? (pp) */
export function demandVsHistory(implied: number, past: number | null): "less" | "same" | "more" | "much_more" | null {
  if (past === null || !Number.isFinite(past)) return null;
  const d = implied - past;
  return d < -5 ? "less" : d <= 5 ? "same" : d <= 15 ? "more" : "much_more";
}

// ── Ready-made stories (so a beginner never has to pick inputs) ──────────────────────

export interface StoryInputs {
  revenue: number; opMargin: number; taxRate: number; costOfCapital: number;
  industryOpMargin: number | null; industrySalesToCapital: number | null; salesToCapital: number | null;
}
export interface Scenario { id: "cautious" | "typical" | "optimistic"; name: string; plain: string; story: Story; implied: Implied }

const clampS2C = (x: number | null | undefined, fb: number) => (x !== null && x !== undefined && Number.isFinite(x) && x > 0.1 ? Math.min(6, x) : fb);

/** Three stories built from the company's own record and its industry's averages:
 *   cautious   — it stays as profitable and as capital-hungry as it is today
 *   typical    — it ends up like the average company in its industry (or keeps today's margin if better)
 *   optimistic — it ends up clearly better than its industry: a quarter more margin, a quarter less capital */
export function buildScenarios(v: StoryInputs, ev: number, riskFree = 4.2): Scenario[] {
  const ind = v.industryOpMargin;
  const todayS2C = clampS2C(v.salesToCapital, clampS2C(v.industrySalesToCapital, 1.5));
  const indS2C = clampS2C(v.industrySalesToCapital, todayS2C);
  const base = { revenue: v.revenue, opMargin: v.opMargin, taxRate: v.taxRate, costOfCapital: v.costOfCapital, riskFree, terminalEdge: 0 };
  const typicalMargin = ind !== null ? Math.max(ind, v.opMargin) : Math.max(v.opMargin, 10);
  const defs: [Scenario["id"], string, string, Story][] = [
    ["cautious", "Cautious", `stays as profitable as today (${v.opMargin.toFixed(0)}% operating margin) and needs as much capital to grow as it does now`,
      { ...base, targetMargin: v.opMargin, salesToCapital: todayS2C }],
    ["typical", "Typical", ind !== null && typicalMargin > v.opMargin + 0.5
      ? `becomes as profitable as the average company in its industry (${ind.toFixed(0)}% operating margin)`
      : `keeps its ${typicalMargin.toFixed(0)}% operating margin${ind !== null ? ` (its industry averages ${ind.toFixed(0)}%)` : ""}`,
      { ...base, targetMargin: typicalMargin, salesToCapital: indS2C }],
    ["optimistic", "Optimistic", `ends up clearly better than its industry: about a quarter more profitable and a quarter less capital-hungry`,
      { ...base, targetMargin: Math.min(70, typicalMargin * 1.25), salesToCapital: Math.min(6, indS2C * 1.25), terminalEdge: 3 }],
  ];
  return defs.map(([id, name, plain, story]) => ({ id, name, plain, story, implied: impliedGrowth(story, Math.max(1, ev)) }));
}

/** How big the company must become by year 10, as a multiple of today. */
export const sizeMultiple = (im: Implied, revenue: number) => (im.kind === "ok" ? im.path[9].revenue / revenue : null);
