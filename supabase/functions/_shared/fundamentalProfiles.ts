// ─────────────────────────────────────────────────────────────
// Fundamental profiles by holding horizon — built on SEC filing history.
//
//  Short term (1–3 months)  "Is the business accelerating right now?"
//    standardized unexpected earnings (SUE), EPS & sales acceleration, margin change,
//    earnings / revenue surprise, estimate revisions, the market's reaction.
//    Research: post-earnings drift (Bernard & Thomas 1989), revision momentum
//    (Chan, Jegadeesh & Lakonishok 1996), revenue + EPS surprises (Jegadeesh & Livnat 2006).
//  Medium term (3–12 months) "Is the growth durable?"
//    8-quarter growth consistency, margin trend, operating leverage, cash-backed
//    earnings (accruals — Sloan 1996), free cash flow, improving returns, leverage.
//  Long term (1–5 years)    "Is this a great business?"
//    multi-year sales/EPS growth and steadiness, gross profitability (Novy-Marx 2013),
//    ROE, cash conversion, share dilution (net issuance — Pontiff & Woodgate 2008),
//    Piotroski F-score (2000), resilience in the worst year.
//
// Points only count when the data exists; the score is the share of available points.
// Pure functions: the same code runs in the edge function and in the app's backtests.
// ─────────────────────────────────────────────────────────────

export interface FQ {
  end: string; revenue: number | null; netIncome: number | null; eps: number | null; operatingIncome: number | null; grossProfit: number | null;
  operatingCashFlow: number | null; capex: number | null; equity: number | null; debt: number | null; assets: number | null;
  currentAssets: number | null; currentLiabilities: number | null; shares: number | null;
}
export interface Extras {
  epsSurprisePct?: number | null;        // latest report, %
  revSurprisePct?: number | null;        // latest report, %
  revisions90?: (number | null)[];       // % change of this-FY and next-FY EPS estimates over 90 days
  reactionPct?: number | null;           // stock − SPY, days −1…+1 around the latest report
}
export interface Part { label: string; earned: number; max: number; value: string; good: boolean | null }
export interface Profile {
  key: "short" | "medium" | "long"; label: string; horizon: string; question: string;
  score: number | null; coverage: number; verdict: "Strong" | "Mixed" | "Weak" | "Limited data";
  parts: Part[]; strengths: string[]; weaknesses: string[];
}

const nn = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);
const growth = (now: number | null, prior: number | null) => (nn(now) && nn(prior) && prior > 0 ? (now / prior - 1) * 100 : null);
const sum = (xs: (number | null)[]) => (xs.every(nn) ? (xs as number[]).reduce((a, b) => a + b, 0) : null);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const pf = (x: number | null, d = 0) => (nn(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}%` : "—");
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

function finish(key: Profile["key"], label: string, horizon: string, question: string, parts: (Part | null)[], total: number): Profile {
  const ps = parts.filter((p): p is Part => !!p);
  const avail = ps.reduce((t, p) => t + p.max, 0), earned = ps.reduce((t, p) => t + p.earned, 0);
  const coverage = Math.round((avail / total) * 100);
  const score = avail ? Math.round((earned / avail) * 100) : null;
  const verdict: Profile["verdict"] = coverage < 50 || score === null ? "Limited data" : score >= 75 ? "Strong" : score >= 55 ? "Mixed" : "Weak";
  return {
    key, label, horizon, question, score, coverage, verdict, parts: ps,
    strengths: ps.filter((p) => p.good === true).map((p) => `${p.label}: ${p.value}`),
    weaknesses: ps.filter((p) => p.good === false).map((p) => `${p.label}: ${p.value}`),
  };
}
const part = (label: string, max: number, earned: number, value: string, good: boolean | null): Part => ({ label, max, earned: Math.max(0, Math.min(max, Math.round(earned * 10) / 10)), value, good });

/** q: quarters newest first (3-month values). */
export function shortTermProfile(q: FQ[], x: Extras = {}): Profile {
  const yoy = (k: keyof FQ, i: number) => (q[i + 4] ? growth(q[i][k] as number | null, q[i + 4][k] as number | null) : null);
  const parts: (Part | null)[] = [];
  // SUE: latest seasonal EPS change vs the volatility of past changes
  const diffs: number[] = [];
  for (let i = 1; i <= 8 && q[i + 4]; i++) if (nn(q[i].eps) && nn(q[i + 4].eps)) diffs.push(q[i].eps! - q[i + 4].eps!);
  if (q[4] && nn(q[0]?.eps) && nn(q[4].eps) && diffs.length >= 4) {
    const s = sd(diffs) || Math.abs(q[4].eps!) * 0.1 || 0.01;
    const sue = (q[0].eps! - q[4].eps! - diffs.reduce((a, b) => a + b, 0) / diffs.length) / s;
    parts.push(part("Earnings surprise vs own history (SUE)", 20, sue >= 2 ? 20 : sue >= 1 ? 14 : sue > 0 ? 7 : 0, sue.toFixed(1), sue >= 1 ? true : sue < 0 ? false : null));
  }
  const e0 = yoy("eps", 0), e1 = yoy("eps", 1), e2 = yoy("eps", 2);
  if (nn(e0) && (nn(e1) || nn(e2))) {
    const prior = [e1, e2].filter(nn) as number[];
    const acc = e0 - prior.reduce((a, b) => a + b, 0) / prior.length;
    parts.push(part("EPS growth acceleration", 12, acc >= 10 ? 12 : acc > 0 ? 7 : 0, `${pf(e0)} vs ${pf(prior[0])} before`, acc > 0 ? true : acc < -10 ? false : null));
  } else if (nn(q[0]?.eps) && nn(q[4]?.eps) && q[4].eps! <= 0 && q[0].eps! > 0) {
    parts.push(part("EPS growth acceleration", 12, 8, "turnaround to profit", true));
  }
  const r0 = yoy("revenue", 0), r1 = yoy("revenue", 1);
  if (nn(r0)) parts.push(part("Sales growth", 12, r0 >= 25 ? 12 : r0 >= 15 ? 9 : r0 >= 5 ? 4 : 0, pf(r0), r0 >= 15 ? true : r0 < 5 ? false : null));
  if (nn(r0) && nn(r1)) parts.push(part("Sales acceleration", 8, r0 - r1 > 2 ? 8 : r0 - r1 > -2 ? 4 : 0, `${pf(r0)} vs ${pf(r1)}`, r0 - r1 > 2 ? true : r0 - r1 < -5 ? false : null));
  const m = (i: number) => (nn(q[i]?.operatingIncome) && nn(q[i]?.revenue) && q[i].revenue! > 0 ? (q[i].operatingIncome! / q[i].revenue!) * 100 : null);
  const m0 = m(0), m4 = m(4);
  if (nn(m0) && nn(m4)) parts.push(part("Operating margin vs a year ago", 8, m0 - m4 > 2 ? 8 : m0 - m4 > 0 ? 5 : 0, `${m0.toFixed(1)}% vs ${m4.toFixed(1)}%`, m0 > m4 ? true : m0 - m4 < -2 ? false : null));
  if (nn(x.epsSurprisePct)) { const v = x.epsSurprisePct; parts.push(part("Latest EPS beat", 10, v >= 10 ? 10 : v >= 3 ? 7 : v > 0 ? 4 : 0, pf(v, 1), v >= 3 ? true : v < 0 ? false : null)); }
  if (nn(x.revSurprisePct)) { const v = x.revSurprisePct; parts.push(part("Latest sales beat", 5, v > 1 ? 5 : v > 0 ? 3 : 0, pf(v, 1), v > 1 ? true : v < 0 ? false : null)); }
  const rv = (x.revisions90 ?? []).filter(nn) as number[];
  if (rv.length) parts.push(part("Estimate revisions (90 days)", 15, rv.every((v) => v > 0) ? 15 : rv.some((v) => v > 0) ? 8 : rv.every((v) => v > -1) ? 4 : 0, rv.map((v) => pf(v, 1)).join(" / "), rv.every((v) => v > 0) ? true : rv.every((v) => v < 0) ? false : null));
  if (nn(x.reactionPct)) { const v = x.reactionPct; parts.push(part("Market reaction to the report", 10, v >= 5 ? 10 : v >= 0 ? 6 : v >= -5 ? 2 : 0, `${pf(v, 1)} vs SPY`, v >= 2 ? true : v <= -5 ? false : null)); }
  return finish("short", "Short term", "1–3 months", "Is the business accelerating right now?", parts, 100);
}

export function mediumTermProfile(q: FQ[]): Profile {
  const yoy = (k: keyof FQ, i: number) => (q[i + 4] ? growth(q[i][k] as number | null, q[i + 4][k] as number | null) : null);
  const parts: (Part | null)[] = [];
  const rg = Array.from({ length: 8 }, (_, i) => yoy("revenue", i)).filter(nn) as number[];
  if (rg.length >= 4) {
    const hits = rg.filter((v) => v >= 15).length;
    parts.push(part("Sales growth ≥15% (last 8 quarters)", 16, (hits / rg.length) * 16, `${hits}/${rg.length} quarters`, hits / rg.length >= 0.75 ? true : hits / rg.length <= 0.25 ? false : null));
    const med = median(rg)!;
    parts.push(part("Typical sales growth", 12, med >= 25 ? 12 : med >= 15 ? 9 : med >= 8 ? 5 : 0, pf(med), med >= 15 ? true : med < 5 ? false : null));
  }
  const eg: (boolean | null)[] = Array.from({ length: 8 }, (_, i) => {
    const a = q[i]?.eps, b = q[i + 4]?.eps;
    return nn(a) && nn(b) ? a > b : null;
  }).filter((v) => v !== null);
  if (eg.length >= 4) { const h = eg.filter(Boolean).length; parts.push(part("EPS up year over year", 12, (h / eg.length) * 12, `${h}/${eg.length} quarters`, h / eg.length >= 0.75 ? true : h / eg.length <= 0.25 ? false : null)); }
  const om = (i: number) => (nn(q[i]?.operatingIncome) && nn(q[i]?.revenue) && q[i].revenue! > 0 ? (q[i].operatingIncome! / q[i].revenue!) * 100 : null);
  const last4 = [0, 1, 2, 3].map(om), prev4 = [4, 5, 6, 7].map(om);
  if (last4.every(nn) && prev4.every(nn)) {
    const a = (last4 as number[]).reduce((s, v) => s + v, 0) / 4, b = (prev4 as number[]).reduce((s, v) => s + v, 0) / 4;
    parts.push(part("Margin trend (last 4 vs prior 4 quarters)", 12, a - b > 2 ? 12 : a - b > 0 ? 8 : a - b > -2 ? 4 : 0, `${a.toFixed(1)}% vs ${b.toFixed(1)}%`, a > b ? true : a - b < -2 ? false : null));
  }
  const ttm = (k: keyof FQ, off = 0) => (q.length >= off + 4 ? sum(q.slice(off, off + 4).map((x) => x[k] as number | null)) : null);
  const salesT = ttm("revenue"), salesP = ttm("revenue", 4), opT = ttm("operatingIncome"), opP = ttm("operatingIncome", 4);
  if (nn(salesT) && nn(salesP) && nn(opT) && nn(opP) && salesP > 0) {
    const sg = (salesT / salesP - 1) * 100;
    const og = opP > 0 ? (opT / opP - 1) * 100 : opT > opP ? 999 : -999;
    parts.push(part("Operating leverage (profit growing faster than sales)", 8, og > sg ? 8 : 0, `op. income ${og === 999 ? "turned up" : pf(og)} vs sales ${pf(sg)}`, og > sg ? true : og < 0 ? false : null));
  }
  const niT = ttm("netIncome"), ocfT = ttm("operatingCashFlow"), capT = ttm("capex");
  if (nn(niT) && nn(ocfT)) {
    const v = niT > 0 ? (ocfT >= niT ? 10 : ocfT >= 0.8 * niT ? 6 : 0) : ocfT > 0 ? 6 : 0;
    parts.push(part("Earnings backed by cash (low accruals)", 10, v, niT > 0 ? `cash flow ${(ocfT / niT).toFixed(2)}× net income` : `cash flow ${ocfT > 0 ? "positive" : "negative"}, net loss`, v >= 6 ? true : v === 0 ? false : null));
  }
  if (nn(ocfT) && nn(capT) && nn(salesT) && salesT > 0) {
    const fcf = ocfT - Math.abs(capT), mgn = (fcf / salesT) * 100;
    parts.push(part("Free cash flow (last 12 months)", 10, fcf > 0 ? (mgn >= 10 ? 10 : 8) : 0, `${mgn.toFixed(1)}% of sales`, fcf > 0 ? true : false));
  }
  const roa = (off: number) => { const n = ttm("netIncome", off), a = q[off]?.assets; return nn(n) && nn(a) && a > 0 ? (n / a) * 100 : null; };
  const roaNow = roa(0), roaAgo = roa(4);
  if (nn(roaNow) && nn(roaAgo)) parts.push(part("Return on assets improving", 8, roaNow > roaAgo ? 8 : 0, `${roaNow.toFixed(1)}% vs ${roaAgo.toFixed(1)}% a year ago`, roaNow > roaAgo ? true : roaNow < roaAgo - 2 ? false : null));
  const de = nn(q[0]?.debt) && nn(q[0]?.equity) && q[0].equity! > 0 ? q[0].debt! / q[0].equity! : null;
  if (nn(de)) parts.push(part("Debt / equity", 6, de <= 1 ? 6 : de <= 2 ? 3 : 0, `${de.toFixed(2)}×`, de <= 1 ? true : de > 2 ? false : null));
  return finish("medium", "Medium term", "3–12 months", "Is the growth durable?", parts, 94);
}

/** a: fiscal years newest first. */
export function longTermProfile(a: FQ[]): Profile {
  const parts: (Part | null)[] = [];
  const yrs = a.filter((y) => nn(y.revenue));
  const span = Math.min(5, yrs.length - 1);
  if (span >= 3) {
    const cagr = (Math.pow(yrs[0].revenue! / yrs[span].revenue!, 1 / span) - 1) * 100;
    parts.push(part(`Sales growth per year (${span}y)`, 16, cagr >= 20 ? 16 : cagr >= 12 ? 12 : cagr >= 7 ? 7 : cagr > 0 ? 3 : 0, pf(cagr, 1), cagr >= 12 ? true : cagr <= 2 ? false : null));
    const ups = yrs.slice(0, span).filter((y, i) => y.revenue! > yrs[i + 1].revenue!).length;
    parts.push(part("Years with higher sales", 10, (ups / span) * 10, `${ups}/${span}`, ups === span ? true : ups / span <= 0.5 ? false : null));
    const worst = Math.min(...yrs.slice(0, Math.min(6, yrs.length - 1)).map((y, i) => (y.revenue! / yrs[i + 1].revenue! - 1) * 100));
    parts.push(part("Worst year for sales (resilience)", 8, worst >= 0 ? 8 : worst >= -10 ? 5 : worst >= -25 ? 2 : 0, pf(worst, 1), worst >= 0 ? true : worst < -10 ? false : null));
  }
  const ep = a.filter((y) => nn(y.eps));
  const es = Math.min(5, ep.length - 1);
  if (es >= 3) {
    const e0 = ep[0].eps!, eN = ep[es].eps!;
    if (eN > 0 && e0 > 0) {
      const c = (Math.pow(e0 / eN, 1 / es) - 1) * 100;
      parts.push(part(`EPS growth per year (${es}y)`, 12, c >= 20 ? 12 : c >= 10 ? 8 : c > 0 ? 4 : 0, pf(c, 1), c >= 10 ? true : c < 0 ? false : null));
    } else parts.push(part(`EPS growth per year (${es}y)`, 12, e0 > 0 ? 6 : 0, e0 > 0 ? "turned profitable" : "still loss-making", e0 > 0 ? null : false));
  }
  const y0 = a[0];
  if (y0 && nn(y0.grossProfit) && nn(y0.assets) && y0.assets > 0) {
    const gpa = y0.grossProfit / y0.assets;
    parts.push(part("Gross profit / assets", 12, gpa >= 0.4 ? 12 : gpa >= 0.25 ? 8 : gpa >= 0.1 ? 4 : 0, gpa.toFixed(2), gpa >= 0.33 ? true : gpa < 0.1 ? false : null));
  }
  const roes = a.slice(0, 3).map((y, i) => { const eqPrev = a[i + 1]?.equity; return nn(y.netIncome) && nn(y.equity) && y.equity > 0 ? (y.netIncome / ((y.equity + (nn(eqPrev) && eqPrev > 0 ? eqPrev : y.equity)) / 2)) * 100 : null; }).filter(nn) as number[];
  if (roes.length >= 2) { const m = roes.reduce((s, v) => s + v, 0) / roes.length; parts.push(part("Return on equity (3y avg)", 10, m >= 20 ? 10 : m >= 12 ? 6 : m > 0 ? 3 : 0, `${m.toFixed(1)}%`, m >= 15 ? true : m < 5 ? false : null)); }
  const fc = a.slice(0, 5).filter((y) => nn(y.operatingCashFlow) && nn(y.capex) && nn(y.netIncome));
  if (fc.length >= 3) {
    const fcf = fc.reduce((s, y) => s + y.operatingCashFlow! - Math.abs(y.capex!), 0), ni = fc.reduce((s, y) => s + y.netIncome!, 0);
    const v = ni > 0 ? (fcf / ni >= 0.9 ? 10 : fcf / ni >= 0.6 ? 6 : fcf > 0 ? 3 : 0) : fcf > 0 ? 4 : 0;
    parts.push(part(`Profits turned into free cash (${fc.length}y)`, 10, v, ni > 0 ? `${(fcf / ni).toFixed(2)}× net income` : fcf > 0 ? "cash positive despite losses" : "burning cash", v >= 6 ? true : v === 0 ? false : null));
  }
  const sh = a.filter((y) => nn(y.shares));
  if (sh.length >= 4) {
    const c = (Math.pow(sh[0].shares! / sh[3].shares!, 1 / 3) - 1) * 100;
    parts.push(part("Share count change per year (3y)", 10, c <= 0 ? 10 : c <= 2 ? 7 : c <= 5 ? 3 : 0, pf(c, 1), c <= 1 ? true : c > 5 ? false : null));
  }
  // Piotroski F-score (latest fiscal year vs the year before)
  const y1 = a[1];
  if (y0 && y1 && nn(y0.netIncome) && nn(y0.assets) && nn(y1.netIncome) && nn(y1.assets) && nn(y0.operatingCashFlow)) {
    let f = 0;
    const roa0 = y0.netIncome! / y0.assets!, roa1 = y1.netIncome! / y1.assets!;
    if (roa0 > 0) f++;
    if (y0.operatingCashFlow! > 0) f++;
    if (roa0 > roa1) f++;
    if (y0.operatingCashFlow! > y0.netIncome!) f++;
    const lev = (y: FQ) => (nn(y.debt) && nn(y.assets) && y.assets! > 0 ? y.debt! / y.assets! : null);
    if (nn(lev(y0)) && nn(lev(y1)) && lev(y0)! <= lev(y1)!) f++;
    const cr = (y: FQ) => (nn(y.currentAssets) && nn(y.currentLiabilities) && y.currentLiabilities! > 0 ? y.currentAssets! / y.currentLiabilities! : null);
    if (nn(cr(y0)) && nn(cr(y1)) && cr(y0)! > cr(y1)!) f++;
    if (nn(y0.shares) && nn(y1.shares) && y0.shares! <= y1.shares! * 1.01) f++;
    const gm = (y: FQ) => (nn(y.grossProfit) && nn(y.revenue) && y.revenue! > 0 ? y.grossProfit! / y.revenue! : null);
    if (nn(gm(y0)) && nn(gm(y1)) && gm(y0)! > gm(y1)!) f++;
    const at = (y: FQ) => (nn(y.revenue) && nn(y.assets) && y.assets! > 0 ? y.revenue! / y.assets! : null);
    if (nn(at(y0)) && nn(at(y1)) && at(y0)! > at(y1)!) f++;
    parts.push(part("Piotroski F-score", 12, f >= 7 ? 12 : f >= 5 ? 8 : f >= 3 ? 4 : 0, `${f}/9`, f >= 7 ? true : f <= 3 ? false : null));
  }
  return finish("long", "Long term", "1–5 years", "Is this a great business?", parts, 100);
}
