// ─────────────────────────────────────────────────────────────
// Evidence-based fundamental profiles, built on SEC filing history.
//
// Every scored part below was tested point-in-time: ~450 US filers from the app's list,
// 16 quarterly dates (Nov 2021 – Aug 2025), filings as they stood on each date, returns vs SPY
// 13 / 26 / 52 weeks later. A part was kept only if it ranked stocks the right way in BOTH
// halves of the sample (2021–23 and 2023–25). Survivorship-biased (today's list only).
//
//  Earnings momentum  "Is earning power rising?"  — worked at 13, 26 and 52 weeks.
//    Seasonal EPS change (scaled), standardized unexpected earnings, operating leverage,
//    operating-margin change, EPS acceleration, consistency of EPS gains.
//    Literature: post-earnings drift (Bernard & Thomas 1989), Jegadeesh & Livnat 2006.
//    Live-only parts (estimate revisions, beats, reaction) have no history to test; they are
//    research-backed (Chan, Jegadeesh & Lakonishok 1996; Brandt et al. 2008) and marked untested.
//  Quality            "How well does it hold up?" — did NOT add return in the 2023–25 rally,
//    but cut the odds of a big loss in both halves. Gross profitability (Novy-Marx 2013), ROE,
//    cash conversion, Piotroski F-score, share count (Pontiff & Woodgate 2008), asset growth
//    (Cooper, Gulen & Schill 2008).
//  Red flags          Each one raised the share of stocks that lagged SPY by 25+ points.
//
//  Added Oct 2026 after a second, larger test (619 companies, 24 quarterly dates Nov 2019 – Aug 2025,
//  26 weeks ahead vs SPY). Kept only if the score ranked stocks the right way in BOTH halves
//  (2019–22 and 2023–25):
//  Sales acceleration "Is growth speeding up?"   — IC +0.044 / +0.057.
//  Margin expansion   "Are margins widening?"    — IC +0.039 / +0.069; Strong 21% big losses vs Weak 24%.
//  Cash flow          "Is the cash real?"         — IC +0.044 / +0.039; Strong 19% big losses vs Weak 28%.
//  Dropped in that test: turnaround (losses turning to profits — mostly the same stocks earnings
//  momentum already flags, and no better when it disagreed) and a steady-compounder profile
//  (ranked stocks the wrong way in 2019–22).
//  Company type (speculative / established / large) is not a score: it shows the measured odds of a
//  big win or a big loss, because big winners came mostly from small or loss-making companies, where
//  the fundamental scores barely changed the odds.
//
//  Dropped after testing: sales-growth level and consistency, multi-year sales/EPS growth
//  (high past growth did WORSE afterwards — expectations already priced, Lakonishok-Shleifer-
//  Vishny 1994), accruals, debt/equity, ROA change.
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
export interface Part { label: string; earned: number; max: number; value: string; good: boolean | null; tested: boolean }
export interface Profile {
  key: "momentum" | "quality" | "growth" | "margins" | "cash"; label: string; horizon: string; question: string;
  score: number | null; coverage: number; verdict: "Strong" | "Mixed" | "Weak" | "Limited data";
  parts: Part[]; strengths: string[]; weaknesses: string[];
}
export interface RedFlag { key: string; label: string; detail: string; tested: boolean }
export interface Features {
  sue: number | null; epsChg: number | null; epsYoY: number | null; epsAcc: number | null; epsUpShare: number | null;
  opLeverage: number | null; marginChg: number | null; opMargin: number | null;
  gpa: number | null; roe3: number | null; fcfConv: number | null; fscore: number | null; shareChg3: number | null; assetGrowth: number | null;
  shareIssue1y: number | null; salesTTM: number | null; netIncomeTTM: number | null; fcfTTM: number | null; shares: number | null;
  salesCagr: number | null;
  // added for the growth / margin / cash profiles (quarters newest first, % unless noted)
  revYoY0: number | null; revYoY1: number | null; revYoY2: number | null; revSeq: number | null;
  gm0: number | null; gm4: number | null; om4: number | null; om8: number | null; omUpShare: number | null;
  ocfTTM: number | null; ocfPrevTTM: number | null; fcfPrevTTM: number | null; salesPrevTTM: number | null;
}

const nn = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);
const growth = (now: number | null, prior: number | null) => (nn(now) && nn(prior) && prior > 0 ? (now / prior - 1) * 100 : null);
const sum = (xs: (number | null)[]) => (xs.every(nn) ? (xs as number[]).reduce((a, b) => a + b, 0) : null);
const pf = (x: number | null, d = 0) => (nn(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}%` : "—");
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/** q: quarters newest first (3-month values); a: fiscal years newest first. Same math as the backtest. */
export function fundamentalFeatures(q: FQ[], a: FQ[]): Features {
  const F: Features = {
    sue: null, epsChg: null, epsYoY: null, epsAcc: null, epsUpShare: null, opLeverage: null, marginChg: null, opMargin: null,
    gpa: null, roe3: null, fcfConv: null, fscore: null, shareChg3: null, assetGrowth: null, shareIssue1y: null,
    salesTTM: null, netIncomeTTM: null, fcfTTM: null, shares: null, salesCagr: null,
    revYoY0: null, revYoY1: null, revYoY2: null, revSeq: null, gm0: null, gm4: null, om4: null, om8: null, omUpShare: null,
    ocfTTM: null, ocfPrevTTM: null, fcfPrevTTM: null, salesPrevTTM: null,
  };
  if (q.length) {
    const yoy = (k: keyof FQ, i: number) => (q[i + 4] ? growth(q[i][k] as number | null, q[i + 4][k] as number | null) : null);
    const diffs: number[] = [];
    for (let i = 1; i <= 8 && q[i + 4]; i++) if (nn(q[i].eps) && nn(q[i + 4].eps)) diffs.push(q[i].eps! - q[i + 4].eps!);
    if (q[4] && nn(q[0].eps) && nn(q[4].eps) && diffs.length >= 4) {
      const s = sd(diffs) || Math.abs(q[4].eps!) * 0.1 || 0.01;
      F.sue = (q[0].eps! - q[4].eps! - diffs.reduce((x, y) => x + y, 0) / diffs.length) / s;
    }
    const e0 = yoy("eps", 0), e1 = yoy("eps", 1);
    F.epsYoY = e0;
    if (nn(e0) && nn(e1)) F.epsAcc = e0 - e1;
    if (q[4] && nn(q[0].eps) && nn(q[4].eps)) F.epsChg = (q[0].eps! - q[4].eps!) / Math.max(Math.abs(q[4].eps!), 0.05);
    const om = (i: number) => (q[i] && nn(q[i].operatingIncome) && nn(q[i].revenue) && q[i].revenue! > 0 ? (q[i].operatingIncome! / q[i].revenue!) * 100 : null);
    const m0 = om(0), m4 = om(4);
    F.opMargin = m0;
    if (nn(m0) && nn(m4)) F.marginChg = m0 - m4;
    const eg = Array.from({ length: 8 }, (_, i) => (nn(q[i]?.eps) && nn(q[i + 4]?.eps) ? (q[i].eps! > q[i + 4].eps! ? 1 : 0) : null)).filter((v): v is 0 | 1 => v !== null);
    if (eg.length >= 4) F.epsUpShare = eg.reduce((x: number, y) => x + y, 0) / eg.length;
    const ttm = (k: keyof FQ, o = 0) => (q.length >= o + 4 ? sum(q.slice(o, o + 4).map((x) => x[k] as number | null)) : null);
    const sT = ttm("revenue"), sP = ttm("revenue", 4), oT = ttm("operatingIncome"), oP = ttm("operatingIncome", 4);
    const ocT = ttm("operatingCashFlow"), cpT = ttm("capex");
    F.salesTTM = sT; F.netIncomeTTM = ttm("netIncome"); F.shares = q[0].shares;
    if (nn(ocT) && nn(cpT)) F.fcfTTM = ocT - Math.abs(cpT);
    if (nn(sT) && nn(sP) && nn(oT) && nn(oP) && sP > 0 && oP > 0) F.opLeverage = Math.max(-200, Math.min(200, (oT / oP - sT / sP) * 100));
    if (q[4] && nn(q[0].assets) && nn(q[4].assets)) F.assetGrowth = growth(q[0].assets, q[4].assets);
    if (q[4] && nn(q[0].shares) && nn(q[4].shares)) F.shareIssue1y = growth(q[0].shares, q[4].shares);
    // growth / margin / cash profiles
    F.revYoY0 = yoy("revenue", 0); F.revYoY1 = yoy("revenue", 1); F.revYoY2 = yoy("revenue", 2);
    if (q[1]) F.revSeq = growth(q[0].revenue, q[1].revenue);
    const gmOf = (x?: FQ) => (x && nn(x.grossProfit) && nn(x.revenue) && x.revenue > 0 ? (x.grossProfit / x.revenue) * 100 : null);
    F.gm0 = gmOf(q[0]); F.gm4 = gmOf(q[4]); F.om4 = m4; F.om8 = om(8);
    const ups = Array.from({ length: 4 }, (_, i) => { const a = om(i), b = om(i + 4); return nn(a) && nn(b) ? (a > b ? 1 : 0) : null; }).filter((v): v is 0 | 1 => v !== null);
    if (ups.length >= 3) F.omUpShare = ups.reduce((x: number, y) => x + y, 0) / ups.length;
    F.ocfTTM = ocT; F.ocfPrevTTM = ttm("operatingCashFlow", 4); F.salesPrevTTM = sP;
    const cpP = ttm("capex", 4);
    if (nn(F.ocfPrevTTM) && nn(cpP)) F.fcfPrevTTM = F.ocfPrevTTM - Math.abs(cpP);
  }
  const yrs = a.filter((y) => nn(y.revenue)), sp = Math.min(5, yrs.length - 1);
  if (sp >= 3) F.salesCagr = (Math.pow(yrs[0].revenue! / yrs[sp].revenue!, 1 / sp) - 1) * 100;
  const y0 = a[0], y1 = a[1];
  if (y0 && nn(y0.grossProfit) && nn(y0.assets) && y0.assets > 0) F.gpa = y0.grossProfit / y0.assets;
  const roes = a.slice(0, 3).map((y, i) => {
    const p = a[i + 1]?.equity;
    return nn(y.netIncome) && nn(y.equity) && y.equity > 0 ? (y.netIncome / ((y.equity + (nn(p) && p > 0 ? p : y.equity)) / 2)) * 100 : null;
  }).filter(nn) as number[];
  if (roes.length >= 2) F.roe3 = roes.reduce((s, v) => s + v, 0) / roes.length;
  const fc = a.slice(0, 5).filter((y) => nn(y.operatingCashFlow) && nn(y.capex) && nn(y.netIncome));
  if (fc.length >= 3) {
    const f = fc.reduce((s, y) => s + y.operatingCashFlow! - Math.abs(y.capex!), 0), n = fc.reduce((s, y) => s + y.netIncome!, 0);
    F.fcfConv = n > 0 ? Math.max(-2, Math.min(3, f / n)) : f > 0 ? 1 : -1;
  }
  const sh = a.filter((y) => nn(y.shares));
  if (sh.length >= 4) F.shareChg3 = (Math.pow(sh[0].shares! / sh[3].shares!, 1 / 3) - 1) * 100;
  if (y0 && y1 && nn(y0.netIncome) && nn(y0.assets) && nn(y1.netIncome) && nn(y1.assets) && nn(y0.operatingCashFlow)) {
    let f = 0;
    const r0 = y0.netIncome! / y0.assets!, r1 = y1.netIncome! / y1.assets!;
    if (r0 > 0) f++;
    if (y0.operatingCashFlow! > 0) f++;
    if (r0 > r1) f++;
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
    F.fscore = f;
  }
  return F;
}

const part = (label: string, max: number, earned: number, value: string, good: boolean | null, tested = true): Part =>
  ({ label, max, earned: Math.max(0, Math.min(max, Math.round(earned * 10) / 10)), value, good, tested });

/** Score = share of points earned among parts that have data. Verdict cut-offs are the ones the backtest used. */
function finish(key: Profile["key"], label: string, horizon: string, question: string, parts: (Part | null)[]): Profile {
  const ps = parts.filter((p): p is Part => !!p);
  const tested = ps.filter((p) => p.tested);
  const testedTotal = key === "momentum" ? 100 : 100;
  const testedAvail = tested.reduce((t, p) => t + p.max, 0);
  const avail = ps.reduce((t, p) => t + p.max, 0), earned = ps.reduce((t, p) => t + p.earned, 0);
  const coverage = Math.round((testedAvail / testedTotal) * 100);
  const score = avail ? Math.round((earned / avail) * 100) : null;
  const verdict: Profile["verdict"] = coverage < 50 || score === null ? "Limited data" : score >= 70 ? "Strong" : score >= 40 ? "Mixed" : "Weak";
  return {
    key, label, horizon, question, score, coverage, verdict, parts: ps,
    strengths: ps.filter((p) => p.good === true).map((p) => `${p.label}: ${p.value}`),
    weaknesses: ps.filter((p) => p.good === false).map((p) => `${p.label}: ${p.value}`),
  };
}

export function momentumProfile(F: Features, x: Extras = {}): Profile {
  const p: (Part | null)[] = [];
  if (nn(F.epsChg)) { const v = F.epsChg; p.push(part("EPS vs the same quarter last year", 25, v >= 0.5 ? 25 : v >= 0.2 ? 18 : v > 0 ? 10 : 0, `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%${F.epsYoY === null ? " (from a loss)" : ""}`, v >= 0.2 ? true : v < 0 ? false : null)); }
  if (nn(F.sue)) { const v = F.sue; p.push(part("Earnings surprise vs its own history (SUE)", 20, v >= 2 ? 20 : v >= 1 ? 14 : v > 0 ? 7 : 0, v.toFixed(1), v >= 1 ? true : v < 0 ? false : null)); }
  if (nn(F.opLeverage)) { const v = F.opLeverage; p.push(part("Operating profit growing faster than sales", 20, v >= 10 ? 20 : v > 0 ? 12 : 0, `${v >= 0 ? "+" : ""}${v.toFixed(0)} pts`, v > 0 ? true : v < -10 ? false : null)); }
  if (nn(F.marginChg)) { const v = F.marginChg; p.push(part("Operating margin vs a year ago", 15, v >= 2 ? 15 : v > 0 ? 9 : 0, `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`, v > 0 ? true : v < -2 ? false : null)); }
  if (nn(F.epsAcc)) { const v = F.epsAcc; p.push(part("EPS growth accelerating", 10, v > 0 ? 10 : 0, `${v >= 0 ? "+" : ""}${v.toFixed(0)} pts vs last quarter`, v > 0 ? true : v < -20 ? false : null)); }
  if (nn(F.epsUpShare)) { const v = F.epsUpShare; p.push(part("Quarters with EPS up year over year (last 8)", 10, v * 10, `${Math.round(v * 8)}/8`, v >= 0.75 ? true : v <= 0.25 ? false : null)); }
  // Live data — research-backed, no history to test
  const rv = (x.revisions90 ?? []).filter(nn) as number[];
  if (rv.length) p.push(part("Analysts raising estimates (90 days)", 12, rv.every((v) => v > 0) ? 12 : rv.some((v) => v > 0) ? 6 : 0, rv.map((v) => pf(v, 1)).join(" / "), rv.every((v) => v > 0) ? true : rv.every((v) => v < 0) ? false : null, false));
  if (nn(x.reactionPct)) { const v = x.reactionPct; p.push(part("Stock's reaction to the last report", 8, v >= 5 ? 8 : v >= 0 ? 5 : v >= -5 ? 2 : 0, `${pf(v, 1)} vs SPY`, v >= 2 ? true : v <= -5 ? false : null, false)); }
  if (nn(x.epsSurprisePct)) { const v = x.epsSurprisePct; p.push(part("Beat on EPS (last report)", 6, v >= 10 ? 6 : v >= 3 ? 4 : v > 0 ? 2 : 0, pf(v, 1), v >= 3 ? true : v < 0 ? false : null, false)); }
  if (nn(x.revSurprisePct)) { const v = x.revSurprisePct; p.push(part("Beat on sales (last report)", 4, v > 1 ? 4 : v > 0 ? 2 : 0, pf(v, 1), v > 1 ? true : v < 0 ? false : null, false)); }
  return finish("momentum", "Earnings momentum", "next 3–12 months", "Is earning power rising?", p);
}

export function qualityProfile(F: Features): Profile {
  const p: (Part | null)[] = [];
  if (nn(F.gpa)) { const v = F.gpa; p.push(part("Gross profit / assets", 20, v >= 0.4 ? 20 : v >= 0.25 ? 13 : v >= 0.1 ? 6 : 0, v.toFixed(2), v >= 0.33 ? true : v < 0.1 ? false : null)); }
  if (nn(F.fscore)) { const v = F.fscore; p.push(part("Piotroski F-score", 20, v >= 7 ? 20 : v >= 5 ? 13 : v >= 3 ? 6 : 0, `${v}/9`, v >= 7 ? true : v <= 3 ? false : null)); }
  if (nn(F.roe3)) { const v = F.roe3; p.push(part("Return on equity (3-year avg)", 15, v >= 20 ? 15 : v >= 12 ? 10 : v > 0 ? 4 : 0, `${v.toFixed(1)}%`, v >= 15 ? true : v < 5 ? false : null)); }
  if (nn(F.fcfConv)) { const v = F.fcfConv; p.push(part("Profits turned into free cash", 15, v >= 0.9 ? 15 : v >= 0.6 ? 9 : v > 0 ? 4 : 0, `${v.toFixed(2)}× net income`, v >= 0.9 ? true : v <= 0 ? false : null)); }
  if (nn(F.shareChg3)) { const v = F.shareChg3; p.push(part("Share count change per year (3y)", 15, v <= 0 ? 15 : v <= 2 ? 10 : v <= 5 ? 4 : 0, pf(v, 1), v <= 1 ? true : v > 5 ? false : null)); }
  if (nn(F.assetGrowth)) { const v = F.assetGrowth; p.push(part("Asset growth (last 12 months)", 15, v <= 10 ? 15 : v <= 25 ? 9 : v <= 50 ? 4 : 0, pf(v, 0), v <= 15 ? true : v > 50 ? false : null)); }
  return finish("quality", "Quality", "protection in sell-offs", "How well does it hold up?", p);
}

/** Is sales growth speeding up? (Second test: IC +0.044 in 2019–22, +0.057 in 2023–25.) */
export function growthProfile(F: Features): Profile {
  const p: (Part | null)[] = [];
  if (nn(F.revYoY0)) { const v = F.revYoY0; p.push(part("Sales vs the same quarter last year", 30, v >= 25 ? 30 : v >= 15 ? 20 : v >= 5 ? 10 : 0, pf(v), v >= 15 ? true : v < 0 ? false : null)); }
  if (nn(F.revYoY0) && nn(F.revYoY1)) { const d = F.revYoY0 - F.revYoY1; p.push(part("Sales growth faster than last quarter's", 25, d >= 5 ? 25 : d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(0)} pts`, d > 0 ? true : d < -10 ? false : null)); }
  if (nn(F.revYoY0) && nn(F.revYoY2)) { const d = F.revYoY0 - F.revYoY2; p.push(part("Faster than two quarters ago", 15, d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(0)} pts`, d > 0 ? true : null)); }
  if (nn(F.revSeq)) { const v = F.revSeq; p.push(part("Sales up from the previous quarter", 15, v > 0 ? 15 : 0, pf(v, 1), v > 0 ? true : v < -5 ? false : null)); }
  if (nn(F.gm0) && nn(F.gm4)) { const d = F.gm0 - F.gm4; p.push(part("Gross margin vs a year ago", 15, d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`, d > 0 ? true : d < -2 ? false : null)); }
  return finish("growth", "Sales acceleration", "next 6 months", "Is growth speeding up?", p);
}

/** Are margins widening? (Second test: IC +0.039 / +0.069; fewer big losses when Strong.) */
export function marginProfile(F: Features): Profile {
  const p: (Part | null)[] = [];
  if (nn(F.gm0) && nn(F.gm4)) { const d = F.gm0 - F.gm4; p.push(part("Gross margin vs a year ago", 30, d >= 1 ? 30 : d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`, d >= 1 ? true : d < -2 ? false : null)); }
  if (nn(F.opMargin) && nn(F.om4)) { const d = F.opMargin - F.om4; p.push(part("Operating margin vs a year ago", 30, d >= 2 ? 30 : d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`, d >= 2 ? true : d < -2 ? false : null)); }
  if (nn(F.omUpShare)) { const v = F.omUpShare; p.push(part("Quarters with a wider operating margin than a year before (last 4)", 25, v * 25, `${Math.round(v * 4)}/4`, v >= 0.75 ? true : v <= 0.25 ? false : null)); }
  if (nn(F.opMargin) && nn(F.om8)) { const d = F.opMargin - F.om8; p.push(part("Operating margin vs two years ago", 15, d > 0 ? 15 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`, d > 0 ? true : d < -5 ? false : null)); }
  return finish("margins", "Margin expansion", "next 6 months", "Are margins widening?", p);
}

/** Is the cash real and growing? (Second test: IC +0.044 / +0.039; Strong 19% big losses vs Weak 28%.) */
export function cashProfile(F: Features): Profile {
  const p: (Part | null)[] = [];
  if (nn(F.ocfTTM) && nn(F.ocfPrevTTM)) {
    const up = F.ocfTTM > F.ocfPrevTTM, g = F.ocfPrevTTM > 0 ? (F.ocfTTM / F.ocfPrevTTM - 1) * 100 : null;
    p.push(part("Operating cash flow vs the year before", 30, g !== null && g >= 20 ? 30 : up ? 15 : 0, g !== null ? pf(g) : up ? "improving" : "falling", up ? true : false));
  }
  if (nn(F.fcfTTM) && nn(F.fcfPrevTTM) && nn(F.salesTTM) && nn(F.salesPrevTTM) && F.salesTTM > 0 && F.salesPrevTTM > 0) {
    const d = (F.fcfTTM / F.salesTTM - F.fcfPrevTTM / F.salesPrevTTM) * 100;
    p.push(part("Free-cash-flow margin vs the year before", 25, d > 0 ? 25 : 0, `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`, d > 0 ? true : d < -3 ? false : null));
  }
  if (nn(F.fcfTTM)) p.push(part("Free cash flow over the last 12 months", 25, F.fcfTTM > 0 ? 25 : 0, F.fcfTTM > 0 ? "positive" : "negative", F.fcfTTM > 0));
  if (nn(F.ocfTTM) && nn(F.netIncomeTTM)) p.push(part("Cash flow above reported profit", 20, F.ocfTTM > F.netIncomeTTM ? 20 : 0, F.ocfTTM > F.netIncomeTTM ? "yes" : "no", F.ocfTTM > F.netIncomeTTM ? true : null));
  return finish("cash", "Cash flow", "fewer big losses", "Is the cash real?", p);
}

export interface CompanyType { key: "speculative" | "established" | "large"; label: string; detail: string; winPct: number; lossPct: number; medianVsSpy: number }
/**
 * Company type with the measured odds over the next 26 weeks (second test, 13,008 stock-dates):
 * a big win = beat SPY by 50+ points, a big loss = lagged by 25+ points. Not a score.
 */
export function companyType(F: Features): CompanyType | null {
  if (!nn(F.salesTTM) || !nn(F.netIncomeTTM)) return null;
  if (F.netIncomeTTM <= 0 || F.salesTTM < 5e8)
    return { key: "speculative", label: "Speculative", detail: F.netIncomeTTM <= 0 ? "losing money over the last 12 months" : "under $500M in yearly sales", winPct: 15, lossPct: 27, medianVsSpy: -4 };
  if (F.salesTTM >= 1e10) return { key: "large", label: "Large and profitable", detail: "$10B+ in yearly sales and profitable", winPct: 3, lossPct: 12, medianVsSpy: -1 };
  return { key: "established", label: "Established and profitable", detail: "profitable, $0.5–10B in yearly sales", winPct: 5, lossPct: 19, medianVsSpy: -5 };
}

/** Tested warning signs. priceNow: latest close (for price / sales). */
export function redFlags(F: Features, priceNow: number | null): RedFlag[] {
  const out: RedFlag[] = [];
  const mcap = nn(priceNow) && nn(F.shares) && F.shares > 0 ? priceNow * F.shares : null;
  if (nn(mcap) && nn(F.salesTTM) && F.salesTTM > 0 && mcap / F.salesTTM > 20) out.push({ key: "ps", label: "Priced above 20× sales", detail: `about ${(mcap / F.salesTTM).toFixed(0)}× last-12-month sales`, tested: true });
  if (nn(F.assetGrowth) && F.assetGrowth > 50) out.push({ key: "assets", label: "Balance sheet grew over 50% in a year", detail: `assets ${pf(F.assetGrowth)} (often acquisitions or capital raises)`, tested: true });
  if (nn(F.shareIssue1y) && F.shareIssue1y > 10) out.push({ key: "dilution", label: "Share count up over 10% in a year", detail: `diluted shares ${pf(F.shareIssue1y, 1)}`, tested: true });
  if (nn(F.netIncomeTTM) && nn(F.fcfTTM) && F.netIncomeTTM < 0 && F.fcfTTM < 0) out.push({ key: "burn", label: "Losing money and burning cash", detail: "net loss and negative free cash flow over the last 12 months", tested: true });
  if (nn(F.salesCagr) && F.salesCagr >= 25) out.push({ key: "expect", label: "Years of 25%+ sales growth — expectations are high", detail: `sales ${pf(F.salesCagr, 0)} a year; past fast growers lagged afterwards on average`, tested: true });
  return out;
}
