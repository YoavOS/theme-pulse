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
  key: "momentum" | "quality"; label: string; horizon: string; question: string;
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
