// ─────────────────────────────────────────────────────────────
// Base Scanner engine — BASE_V1
//
// Implements the "Stock Bases Before Major Upside Moves" research and its
// "Operational Stock-Base Scanner Profiles" companion:
//   • feature-based ranking first (Generic Base Ranker, 100 points),
//     named patterns second (overlapping labels)
//   • weekly bars define the base; daily bars (when available) time the
//     breakout and grade its quality
//   • candidate states: developing → qualified → ready → triggered,
//     plus extended / failed
// All thresholds are the research's "balanced" defaults. The 26-week RS
// percentile is cross-sectional, so it is applied afterwards in
// finalizeBase() once every stock in the list has been measured.
// Only depends on the stage engine's types (no runtime imports).
// ─────────────────────────────────────────────────────────────

import type { Stage, WeeklyBar } from "./stageEngine.ts";

export interface DailyBar {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export type BaseLabel = "htf" | "cup" | "double_bottom" | "ascending" | "vcp" | "flat" | "box" | "generic";

export const LABEL_NAMES: Record<BaseLabel, string> = {
  htf: "High-tight flag",
  cup: "Cup w/ handle",
  double_bottom: "Double bottom",
  ascending: "Ascending base",
  vcp: "VCP",
  flat: "Flat base",
  box: "Box",
  generic: "Base",
};

/** Minimum 26-week RS percentile per label (balanced presets in the research). */
export const LABEL_MIN_RS: Record<BaseLabel, number> = {
  htf: 85, cup: 60, double_bottom: 55, ascending: 70, vcp: 60, flat: 60, box: 50, generic: 50,
};

// When a base carries several labels, the most specific evidence wins the "primary" slot.
const LABEL_PRIORITY: BaseLabel[] = ["htf", "cup", "double_bottom", "vcp", "ascending", "flat", "box", "generic"];

export interface BaseFeatures {
  weeks: number;
  baseStart: string;          // ISO date of the base's first week
  baseHigh: number;
  baseLow: number;
  depthPct: number;
  rangePos: number;
  priorImpulsePct: number;
  giveback: number;
  rangeContraction: number | null;
  atrContraction: number | null;
  atrPctile: number | null;   // current weekly ATR% vs its own ~2-year history (0–100, low = quiet)
  pullbacks: number[];        // ATR-scaled swing pullback depths (%), oldest → newest
  contractingFrac: number | null;
  medianDepthRatio: number | null;
  finalContractionPct: number;
  finalContractionAtr: number;
  tightClosesAtr: number;     // span of the last 3 weekly closes in weekly ATRs
  threeWeeksTight: boolean;
  dryUp: number | null;       // last-3-week median volume / earlier-base median volume
  downUpVol: number | null;   // median down-week volume / median up-week volume
  pivot: number;
  pivotContacts: number;
  support: number;            // stop / invalidation level
  stopRiskPct: number;        // (pivot − support) / pivot
  latestClose: number;
  latestDate: string;
  distToPivotPct: number;     // pivot / latest close − 1 (negative = above pivot)
  aboveSma10: boolean;
  aboveSma30: boolean;
  aboveSma40: boolean;
  sma10Above30: boolean;
  sma30Slope8Pct: number;
  pctFrom52wHigh: number;
  pctAbove52wLow: number;
  rsSlope13: number | null;
  rsHighDistPct: number | null;
  r26Pct: number | null;      // 26-week return (for the cross-sectional percentile)
  ext10wPct: number;
  ext30wPct: number;
  supportHolding: boolean;
  dollarVolM: number | null;  // median daily dollar volume, $M
  baseCount: number;
  baseCountCapped: boolean;   // Stage 2 began before the available history
  labels: BaseLabel[];        // pattern labels before the RS-percentile gates
  trigger: {
    status: "none" | "triggered" | "extended" | "failed";
    date: string | null;
    rvol: number | null;      // breakout-day volume vs 50-day average (or week vs 10-week)
    closeLocation: number | null;
    rangeExpansion: number | null;
    exceptional: boolean;
    extensionPct: number | null;
    source: "daily" | "weekly" | null;
  };
  parts: {                    // score components before the RS percentile
    trend: number; rs: number; geometry: number; contraction: number; volume: number; pivotRisk: number; market: number;
  };
  marketStage: Stage | null;
  stageNow: Stage | null;     // the stock's own Weinstein stage at scan time
  dataNote: string | null;    // e.g. "no recent daily bars — weekly trigger only"
  gateFails: string[];        // generic base gates this base misses (shown as warnings)
  chart: { c: number[]; h: number[]; l: number[]; ma: (number | null)[]; from: number; end: string };
  gatesOk: boolean;           // passed the generic Stage-2 base gates (before the RS percentile)
}

export interface FinalBase {
  score: number;
  band: "prime" | "qualified" | "developing" | "research";
  state: "ready" | "qualified" | "developing" | "watch" | "triggered" | "extended" | "failed";
  primaryLabel: BaseLabel;
  labels: BaseLabel[];
  rsPct: number | null;
  breakdown: { trend: number; rs: number; geometry: number; contraction: number; volume: number; pivotRisk: number; market: number };
  warnings: string[];
  tier: 1 | 2 | null;
}

// ── helpers ──────────────────────────────────────────────────────
const DAY = 86400;
const isoWeekEnd = (t: number) => {
  const d = new Date(t * 1000);
  const dow = (d.getUTCDay() + 6) % 7;
  const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 - dow * DAY;
  return new Date((mon + 4 * DAY) * 1000).toISOString().slice(0, 10);
};
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sma = (a: number[], end: number, n: number) => {
  if (end - n + 1 < 0) return NaN;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += a[i];
  return s / n;
};
function olsSlope(ys: number[]) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** ATR-scaled ZigZag on weekly highs/lows. Returns pullback depths (fractions) and the swing-low indexes. */
function zigzagPullbacks(h: number[], l: number[], from: number, to: number, thr: number) {
  const pullbacks: { depth: number; hiIdx: number; loIdx: number }[] = [];
  let hiIdx = from, loIdx = -1;
  let mode: "down" | "up" = "down";
  for (let i = from + 1; i <= to; i++) {
    if (mode === "down") {
      if (h[i] > h[hiIdx] && loIdx === -1) { hiIdx = i; continue; }
      if (loIdx === -1 || l[i] < l[loIdx]) loIdx = i;
      if (loIdx !== -1 && h[i] >= l[loIdx] * (1 + thr) && i > loIdx) {
        // swing low confirmed → record the pullback
        pullbacks.push({ depth: 1 - l[loIdx] / h[hiIdx], hiIdx, loIdx });
        mode = "up";
        hiIdx = i;
      }
    } else {
      if (h[i] >= h[hiIdx]) hiIdx = i;
      else if (l[i] <= h[hiIdx] * (1 - thr)) { mode = "down"; loIdx = i; }
    }
  }
  // Ongoing (unconfirmed) final pullback from the last swing high
  let lastLo = hiIdx;
  for (let i = hiIdx; i <= to; i++) if (l[i] < l[lastLo]) lastLo = i;
  const finalDepth = 1 - l[lastLo] / h[hiIdx];
  const filtered = pullbacks.filter((p) => p.depth >= thr * 0.8);
  return { pullbacks: filtered, finalDepth, finalHiIdx: hiIdx, finalLoIdx: lastLo };
}

// ── main ─────────────────────────────────────────────────────────
export interface BaseInput {
  weekly: WeeklyBar[];          // completed weeks only, oldest → newest
  bench: WeeklyBar[] | null;    // SPY weekly
  daily: DailyBar[] | null;     // recent daily bars (≥ ~60 sessions) or null
  stage: { stage: Stage; weeksInStage: number } | null;
  marketStage: Stage | null;
  nowSec?: number;
}

interface WindowEval {
  W: number;
  start: number;
  end: number;
  partial: number;   // score without the RS percentile (max 92)
  fails: string[];   // generic gates this window misses (diagnostics)
  f: Omit<BaseFeatures, "trigger" | "baseCount" | "baseCountCapped" | "dataNote" | "latestClose" | "latestDate" | "distToPivotPct" | "marketStage" | "stageNow" | "gatesOk" | "gateFails" | "chart">;
  gatesOk: boolean;
}

export function detectBase(input: BaseInput, debug?: string[]): BaseFeatures | null {
  const bars = input.weekly;
  const n = bars.length;
  if (n < 60) return null; // need ~52w context + base history; IPOs are a separate model

  const c = bars.map((b) => b.c), h = bars.map((b) => b.h), l = bars.map((b) => b.l), v = bars.map((b) => b.v || 0);
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - c[i - 1]), Math.abs(b.l - c[i - 1])));
  const atr10 = (i: number) => sma(tr, i, 10);
  const atrPctSeries = c.map((_, i) => (i >= 10 ? atr10(i) / c[i] : NaN));
  // A price pinned in a ~2% band for 5 weeks is a pending deal (acquisition), not a base.
  {
    const k0 = n - 5;
    const spanPct = Math.max(...h.slice(k0)) / Math.min(...l.slice(k0)) - 1;
    const trMed = median(tr.slice(k0).map((x, k) => x / c[k0 + k]));
    if (spanPct < 0.03 && trMed < 0.02) return null;
  }

  // RS line vs benchmark (aligned by week)
  const wk = (t: number) => isoWeekEnd(t);
  const benchBy = new Map<string, number>();
  for (const b of input.bench ?? []) benchBy.set(wk(b.t), b.c);
  const rs: (number | null)[] = bars.map((b) => { const x = benchBy.get(wk(b.t)); return x ? b.c / x : null; });

  // Daily data (Full Scan cache) — used for the latest close and breakout timing when fresh.
  const lastWeekEndSec = Date.parse(isoWeekEnd(bars[n - 1].t) + "T21:00:00Z") / 1000;
  type CleanDaily = { ts: number; open: number; high: number; low: number; close: number; volume: number };
  let daily: CleanDaily[] = (input.daily ?? [])
    .filter((d) => d && d.close != null && d.high != null && d.low != null && d.open != null && Number.isFinite(d.ts))
    .map((d) => ({ ts: d.ts, open: d.open as number, high: d.high as number, low: d.low as number, close: d.close as number, volume: d.volume ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
  // Fresh = the daily bars reach the last completed week's final session (Friday, or the
  // week's last session before a holiday — then its close equals the weekly close). Older
  // daily bars would make the "latest close" older than the weekly one.
  const lastD = daily[daily.length - 1];
  const dailyFresh = daily.length >= 60 && !!lastD && (
    isoDay(lastD.ts) >= isoWeekEnd(bars[n - 1].t) ||
    (lastD.ts >= lastWeekEndSec - 4 * DAY && Math.abs(lastD.close / bars[n - 1].c - 1) < 1e-6));
  if (!dailyFresh) daily = [];

  const i = n - 1;
  const sma10 = sma(c, i, 10), sma30 = sma(c, i, 30), sma40 = sma(c, i, 40);
  const sma30ago = sma(c, i - 8, 30);
  const sma10ago = sma(c, i - 4, 10);
  const hh52 = Math.max(...h.slice(n - 52)), ll52 = Math.min(...l.slice(n - 52));

  const latestClose = daily.length ? daily[daily.length - 1].close : c[i];
  const latestDate = daily.length ? isoDay(daily[daily.length - 1].ts) : isoWeekEnd(bars[i].t);

  const ctx = {
    aboveSma10: latestClose > sma10,
    aboveSma30: latestClose > sma30,
    aboveSma40: latestClose > sma40,
    sma10Above30: sma10 > sma30,
    sma10Rising: sma10 > sma10ago,
    sma30Slope8Pct: (sma30 / sma30ago - 1) * 100,
    pctFrom52wHigh: (latestClose / hh52 - 1) * 100,
    pctAbove52wLow: (latestClose / ll52 - 1) * 100,
    ext10wPct: (latestClose / sma10 - 1) * 100,
    ext30wPct: (latestClose / sma30 - 1) * 100,
  };
  const rsNow = rs[i];
  const rs13 = rs[i - 13];
  const rsSlope13 = rsNow && rs13 ? Math.log(rsNow / rs13) : null;
  const rsWin = rs.slice(n - 52).filter((x): x is number => x !== null);
  const rsHighDistPct = rsNow && rsWin.length ? (1 - rsNow / Math.max(...rsWin)) * 100 : null;
  const r26Pct = (c[i] / c[i - 26] - 1) * 100;

  // ATR% percentile vs own history
  const hist = atrPctSeries.filter((x) => Number.isFinite(x));
  const atrPctile = hist.length > 20 ? (hist.filter((x) => x <= atrPctSeries[i]).length / hist.length) * 100 : null;

  // Median daily dollar volume ($M): daily if fresh, else weekly/5
  let dollarVolM: number | null = null;
  if (daily.length >= 20) dollarVolM = median(daily.slice(-20).map((d) => (d.close * (d.volume ?? 0)) / 1e6));
  else dollarVolM = median(bars.slice(n - 4).map((b) => (b.c * b.v) / 5 / 1e6));

  const marketPts = input.marketStage === 2 ? 5 : input.marketStage === 4 ? 0 : 2.5;

  // ── evaluate one window [start, end] ─────────────────────────
  const evalWindow = (start: number, end: number, requireLeftHigh: boolean): WindowEval | null => {
    const W = end - start + 1;
    if (W < 3 || start < 26) return null;
    const wh = h.slice(start, end + 1), wl = l.slice(start, end + 1), wc = c.slice(start, end + 1), wv = v.slice(start, end + 1);
    const baseHigh = Math.max(...wh), baseLow = Math.min(...wl);
    if (!(baseHigh > baseLow)) return null;
    if (requireLeftHigh) {
      const lead = Math.max(...wh.slice(0, Math.max(1, Math.ceil(W * 0.35))));
      if (lead < 0.97 * baseHigh) return null;
    }
    const closeNow = end === i ? latestClose : c[end];
    const depth = 1 - baseLow / baseHigh;
    const rangePos = clamp((closeNow - baseLow) / (baseHigh - baseLow), -0.5, 1.5);
    const preLow = Math.min(...l.slice(Math.max(0, start - 52), start));
    const impulse = baseHigh / preLow - 1;
    const giveback = impulse > 0.01 ? depth / impulse : 9;

    const third = Math.max(1, Math.floor(W / 3));
    const trPct = wh.map((_, k) => tr[start + k] / c[start + k]);
    const rangeContraction = W >= 6 ? median(trPct.slice(-third)) / median(trPct.slice(0, third)) : null;
    const atrW = atrPctSeries.slice(start, end + 1);
    const atrContraction = W >= 6 ? median(atrW.slice(-third)) / median(atrW.slice(0, third)) : null;

    const atrPctNow = atrPctSeries[end];
    const thr = Math.max(0.05, Number.isFinite(atrPctNow) ? atrPctNow : 0.05);
    const zz = zigzagPullbacks(h, l, start, end, thr);
    const depths = zz.pullbacks.map((p) => p.depth);
    // the current (unconfirmed) contraction counts once it is a real dip (≥ 2%)
    if (zz.finalDepth >= 0.02 && (zz.pullbacks.length === 0 || zz.finalLoIdx > zz.pullbacks[zz.pullbacks.length - 1].loIdx)) depths.push(zz.finalDepth);
    let contractingFrac: number | null = null, medianDepthRatio: number | null = null, maxRatio = 0;
    if (depths.length >= 2) {
      const ratios = depths.slice(1).map((d, k) => d / depths[k]);
      contractingFrac = ratios.filter((x) => x < 1).length / ratios.length;
      medianDepthRatio = median(ratios);
      maxRatio = Math.max(...ratios);
    }
    const finalContraction = zz.finalDepth;
    const atrAbs = atr10(end);
    const finalContractionAtr = (h[zz.finalHiIdx] - l[zz.finalLoIdx]) / atrAbs;

    const last3 = c.slice(end - 2, end + 1);
    const tightClosesAtr = (Math.max(...last3) - Math.min(...last3)) / atrAbs;
    const threeWeeksTight = Math.abs(c[end] / c[end - 1] - 1) <= 0.015 && Math.abs(c[end - 1] / c[end - 2] - 1) <= 0.015;

    const dryUp = W >= 6 ? median(wv.slice(-3)) / median(wv.slice(0, -3)) : null;
    const upV: number[] = [], dnV: number[] = [];
    for (let k = start; k <= end; k++) (c[k] >= c[k - 1] ? upV : dnV).push(v[k]);
    const downUpVol = upV.length && dnV.length ? median(dnV) / median(upV) : null;

    // pivot: cluster of highs near the top of the base
    const tol = Math.max(0.02 * baseHigh, 0.5 * atrAbs);
    const near = wh.filter((x) => x >= baseHigh - tol).sort((a, b) => a - b);
    const pivotContacts = near.length;
    const pivot = pivotContacts >= 2 ? near[Math.floor((near.length - 1) * 0.75)] : baseHigh;
    // support: low of the final contraction (or last 3 weeks), never above the close
    const support = Math.min(l[zz.finalLoIdx], ...l.slice(end - 2, end + 1));
    const stopRiskPct = (pivot - support) / pivot * 100;

    // support holding: second-half low ≥ 98% of first-half low
    const half = Math.floor(W / 2);
    const supportHolding = W >= 4 ? Math.min(...wl.slice(half)) >= 0.98 * Math.min(...wl.slice(0, half)) : true;

    // ── score (research §6.9 / Generic Base Ranker) without RS percentile ──
    const imp = impulse * 100;
    let trend = (ctx.aboveSma10 ? 2 : 0) + (ctx.aboveSma30 ? 2 : 0) + (ctx.aboveSma40 ? 2 : 0) + (ctx.sma10Above30 ? 2 : 0) +
      (ctx.sma30Slope8Pct > 0 ? 3 : 0) +
      (imp >= 50 ? 5 : imp >= 30 ? 2 + (imp - 30) / 20 * 3 : 0) +
      (giveback <= 0.5 ? 4 : giveback <= 0.67 ? 2 : 0);
    trend = Math.min(20, trend);
    const rsPart = (rsSlope13 !== null && rsSlope13 > 0 ? 4 : 0) +
      (rsHighDistPct !== null ? (rsHighDistPct <= 3 ? 4 : rsHighDistPct <= 5 ? 3 : rsHighDistPct <= 10 ? 1 : 0) : 0); // + up to 7 from percentile later
    let geometry = (depth <= 0.30 ? 6 : depth <= 0.40 ? 3 : 0) + (W >= 5 && W <= 52 ? 4 : W >= 3 ? 2 : 0) +
      (rangePos >= 0.85 ? 6 : rangePos >= 0.75 ? 4 : rangePos >= 0.65 ? 2 : 0) + (supportHolding ? 4 : 0);
    geometry = Math.min(20, geometry);
    let contraction = 0;
    if (rangeContraction !== null && rangeContraction <= 0.70) contraction += 4;
    if (atrPctile !== null && atrPctile <= 30) contraction += 4;
    if (depths.length >= 3 ? depths[depths.length - 1] < depths[depths.length - 2] && depths[depths.length - 2] < depths[depths.length - 3]
      : depths.length === 2 && depths[1] < depths[0]) contraction += 4;
    if (tightClosesAtr <= 2) contraction += threeWeeksTight ? 4 : 3;
    if (finalContraction <= 0.10 || finalContractionAtr <= 2.5) contraction += 4;
    contraction = Math.min(20, contraction);
    let volume = 0;
    if (dryUp !== null && dryUp <= 0.75) volume += 2;
    if (downUpVol !== null && downUpVol < 1) volume += 2;
    {
      const rh = Math.max(start, end - half + 1);
      const avgV = median(v.slice(Math.max(0, start - 10), end + 1));
      let hvUp = 0, hvDn = 0;
      for (let k = rh; k <= end; k++) if (v[k] > 1.3 * avgV) (c[k] >= c[k - 1] ? hvUp++ : hvDn++);
      if (hvUp > hvDn) volume += 2;
      const clv = (k: number) => (h[k] > l[k] ? ((c[k] - l[k]) - (h[k] - c[k])) / (h[k] - l[k]) : 0) * v[k];
      let a = 0, b = 0;
      for (let k = start; k < start + half; k++) a += clv(k);
      for (let k = start + half; k <= end; k++) b += clv(k);
      if (b > a) volume += 2;
      let obv = 0;
      const obvs: number[] = [];
      for (let k = start; k <= end; k++) { obv += c[k] > c[k - 1] ? v[k] : c[k] < c[k - 1] ? -v[k] : 0; obvs.push(obv); }
      if (olsSlope(obvs) >= 0) volume += 2;
    }
    const distNow = (pivot / closeNow - 1) * 100;
    const pivotRisk = (pivotContacts >= 3 ? 4 : pivotContacts >= 2 ? 3 : 0) +
      (distNow <= 5 ? 3 : distNow <= 8 ? 1.5 : 0) + (stopRiskPct <= 7 ? 3 : stopRiskPct <= 12 ? 1.5 : 0);
    const partial = trend + rsPart + geometry + contraction + volume + pivotRisk + marketPts;

    // Generic hard gates (balanced)
    const fails: string[] = [];
    if (!(imp >= 30)) fails.push("impulse");
    if (!ctx.aboveSma30) fails.push("belowMA30");
    if (!(ctx.sma30Slope8Pct >= -0.5)) fails.push("maSlope");
    if (!(ctx.pctFrom52wHigh >= -25)) fails.push("farFromHigh");
    if (!(W >= 5 && W <= 52)) fails.push("weeks");
    if (!(depth <= 0.40)) fails.push("depth");
    if (!(giveback <= 0.75)) fails.push("giveback");
    if (!(rangePos >= 0.65)) fails.push("rangePos");
    if (!(stopRiskPct <= 15)) fails.push("stopRisk");
    const gatesOk = fails.length === 0;

    return {
      W, start, end, partial, gatesOk, fails,
      f: {
        weeks: W, baseStart: isoWeekEnd(bars[start].t), baseHigh: r4(baseHigh), baseLow: r4(baseLow), depthPct: r1(depth * 100),
        rangePos: r2(rangePos), priorImpulsePct: r1(imp), giveback: r2(giveback),
        rangeContraction: rangeContraction === null ? null : r2(rangeContraction),
        atrContraction: atrContraction === null ? null : r2(atrContraction), atrPctile: atrPctile === null ? null : Math.round(atrPctile),
        pullbacks: depths.map((d) => r1(d * 100)), contractingFrac: contractingFrac === null ? null : r2(contractingFrac),
        medianDepthRatio: medianDepthRatio === null ? null : r2(medianDepthRatio),
        finalContractionPct: r1(finalContraction * 100), finalContractionAtr: r1(finalContractionAtr),
        tightClosesAtr: r1(tightClosesAtr), threeWeeksTight,
        dryUp: dryUp === null || !Number.isFinite(dryUp) ? null : r2(dryUp),
        downUpVol: downUpVol === null || !Number.isFinite(downUpVol) ? null : r2(downUpVol),
        pivot: r4(pivot), pivotContacts, support: r4(support), stopRiskPct: r1(stopRiskPct),
        aboveSma10: ctx.aboveSma10, aboveSma30: ctx.aboveSma30, aboveSma40: ctx.aboveSma40, sma10Above30: ctx.sma10Above30,
        sma30Slope8Pct: r2(ctx.sma30Slope8Pct), pctFrom52wHigh: r1(ctx.pctFrom52wHigh), pctAbove52wLow: r1(ctx.pctAbove52wLow),
        rsSlope13: rsSlope13 === null ? null : r4(rsSlope13), rsHighDistPct: rsHighDistPct === null ? null : r1(rsHighDistPct),
        r26Pct: r1(r26Pct), ext10wPct: r1(ctx.ext10wPct), ext30wPct: r1(ctx.ext30wPct), supportHolding,
        dollarVolM: dollarVolM === null || !Number.isFinite(dollarVolM) ? null : r1(dollarVolM),
        labels: [],
        parts: { trend: r1(trend), rs: r1(rsPart), geometry: r1(geometry), contraction: r1(contraction), volume: r1(volume), pivotRisk: r1(pivotRisk), market: marketPts },
      },
    };
  };

  // Best base window ending at `end`. A base starts at a left-side high: candidate starts are
  // local peaks within 5% of the highest high of the last 52 weeks. Among windows that pass the
  // generic gates the LONGEST wins (research: drop windows contained in a valid longer base);
  // otherwise the best-scoring window is kept for the pattern classifiers.
  const bestWindow = (end: number): WindowEval | null => {
    const from = Math.max(26, end - 51);
    const H = Math.max(...h.slice(from, end + 1));
    let longestOk: WindowEval | null = null, bestAny: WindowEval | null = null;
    for (let k = from; k <= end - 2; k++) {
      const isPeak = h[k] >= 0.95 * H && h[k] >= h[k - 1] && (k + 1 > end || h[k] >= h[k + 1]);
      if (!isPeak) continue;
      const e = evalWindow(k, end, false);
      if (!e) continue;
      debug?.push(`win end=${end} start=${k} W=${e.W} ok=${e.gatesOk} fails=${e.fails.join(",")} partial=${e.partial.toFixed(1)} depth=${e.f.depthPct} pos=${e.f.rangePos} imp=${e.f.priorImpulsePct} gb=${e.f.giveback} risk=${e.f.stopRiskPct}`);
      if (e.gatesOk && !longestOk) longestOk = e;          // k ascends → first ok is the longest
      if (!bestAny || e.partial > bestAny.partial) bestAny = e;
    }
    return longestOk ?? bestAny;
  };

  // ── trigger detection ──────────────────────────────────────
  // Case A: the last completed week closed above the pivot of the base that ended the week before.
  const prevBase = bestWindow(i - 1);
  let base = bestWindow(i);
  let trigger: BaseFeatures["trigger"] = { status: "none", date: null, rvol: null, closeLocation: null, rangeExpansion: null, exceptional: false, extensionPct: null, source: null };
  const buffer = (p: number) => p * 1.005;
  // A daily close above the pivot after the last completed week.
  const clearedThisWeek = (p: number) => daily.some((d) => d.ts > lastWeekEndSec && d.close > buffer(p));
  if (prevBase && prevBase.gatesOk && c[i] > buffer(prevBase.f.pivot) && h[i - 1] <= prevBase.f.pivot * 1.01) {
    base = prevBase;
    trigger = { ...trigger, status: "triggered", date: isoWeekEnd(bars[i].t), source: "weekly",
      rvol: r2(v[i] / (sma(v, i - 1, 10) || 1)) };
  } else if (base && clearedThisWeek(base.f.pivot) && c[i] <= base.f.pivot * 1.005) {
    // Case B: broke out during the current (incomplete) week — a daily close above the pivot
    // (it may already have failed; the daily check below decides).
    trigger = { ...trigger, status: "triggered", source: "daily" };
  }
  if (!base) return null;

  // ── pattern classifiers (labels) ─────────────────────────────
  const f = base.f;
  const genericPivot = f.pivot;
  const labels: BaseLabel[] = [];
  const s = base.start, e = base.end, W = base.W;
  const distNow = (f.pivot / latestClose - 1) * 100;

  // Flat base
  {
    const closes = c.slice(s, e + 1);
    const slopeChange = Math.abs(olsSlope(closes) * (W - 1));
    const height = f.baseHigh - f.baseLow;
    const span3 = (Math.max(c[e], c[e - 1], c[e - 2]) / Math.min(c[e], c[e - 1], c[e - 2]) - 1) * 100;
    if (f.priorImpulsePct >= 25 && ctx.sma30Slope8Pct > 0 && f.pctFrom52wHigh >= -20 &&
      W >= 5 && W <= 26 && f.depthPct <= 15 && slopeChange <= 0.4 * height && f.pivotContacts >= 2 && span3 <= 6) labels.push("flat");
  }
  // VCP
  {
    const d = f.pullbacks.map((x) => x / 100);
    const pairs = d.slice(1).map((x, k) => x / d[k]);
    if (f.priorImpulsePct >= 25 && ctx.sma30Slope8Pct > 0 && f.pctFrom52wHigh >= -25 &&
      d.length >= 2 && d.length <= 6 && (f.contractingFrac ?? 0) >= 0.66 && (f.medianDepthRatio ?? 9) <= 0.8 &&
      Math.max(...pairs) <= 1.15 && d[d.length - 1] <= 0.6 * d[0] && d[d.length - 1] <= 0.12 &&
      (f.finalContractionPct <= 10 || (f.finalContractionAtr <= 2.5 && f.finalContractionPct <= 15)) &&
      f.depthPct >= 6 && f.depthPct <= 35 && W >= 5 && W <= 30) labels.push("vcp");
  }
  // Cup with handle (cup from base start to the right rim; handle = the last 1–5 weeks)
  {
    for (let hl = 1; hl <= 5 && !labels.includes("cup"); hl++) {
      const rim = e - hl;                       // right-rim week
      const cupLen = rim - s + 1;
      if (cupLen < 7) continue;
      const leftRim = Math.max(...h.slice(s, s + 2));
      let tIdx = s;
      for (let k = s; k <= rim; k++) if (l[k] < l[tIdx]) tIdx = k;
      const cupDepth = 1 - l[tIdx] / leftRim;
      const loc = (tIdx - s) / (cupLen - 1);
      const rightRim = Math.max(...h.slice(tIdx, rim + 1));
      if (h[rim] < rightRim * 0.999) continue;     // rim must be the right-side high
      // anti-V: at least two weekly lows in the lower 25% of the cup
      const lower25 = l[tIdx] + 0.25 * (leftRim - l[tIdx]);
      let lowWeeks = 0;
      for (let k = s; k <= rim; k++) if (l[k] <= lower25) lowWeeks++;
      const handleLow = Math.min(...l.slice(rim + 1, e + 1));
      const handleDepth = 1 - handleLow / h[rim];
      const mid = l[tIdx] + 0.5 * (leftRim - l[tIdx]);
      const handleVol = median(v.slice(rim + 1, e + 1)), rightVol = median(v.slice(tIdx, rim + 1));
      const rightDur = rim - tIdx, leftDur = tIdx - s;
      if (f.priorImpulsePct >= 30 && ctx.aboveSma30 && ctx.sma30Slope8Pct >= 0 &&
        W >= 8 && W <= 52 && cupDepth >= 0.12 && cupDepth <= 0.33 && loc >= 0.2 && loc <= 0.7 &&
        rightRim >= leftRim * 0.92 && lowWeeks >= 2 &&
        rightDur >= 2 && rightDur <= Math.max(2, 3 * leftDur) &&
        handleDepth >= 0.02 && handleDepth <= 0.12 && handleLow > mid && (handleVol <= rightVol || !Number.isFinite(handleVol))) {
        labels.push("cup");
        f.pivot = r4(h[rim]);                      // pivot = handle high (the right rim)
        f.support = r4(handleLow);                 // stop under the handle
        f.stopRiskPct = r1((h[rim] - handleLow) / h[rim] * 100);
      }
    }
  }
  // Double bottom
  {
    if (W >= 8 && W <= 40) {
      const firstPart = s + Math.floor(W * 0.6);
      let t1 = s;
      for (let k = s; k <= firstPart; k++) if (l[k] < l[t1]) t1 = k;
      let t2 = -1;
      for (let k = t1 + 3; k <= e; k++) if (t2 === -1 || l[k] < l[t2]) t2 = k;
      if (t2 > t1) {
        let m = t1;
        for (let k = t1; k <= t2; k++) if (h[k] > h[m]) m = k;
        const rebound = h[m] / l[t1] - 1;
        const rel = l[t2] / l[t1] - 1;
        const atrAbs = atr10(t1);
        let reclaimed = true;
        if (rel < -0.01) {
          reclaimed = false;
          for (let k = t2; k <= Math.min(e, t2 + 2); k++) if (c[k] > l[t1]) { reclaimed = true; break; }
        }
        const pos = (latestClose - Math.min(l[t1], l[t2])) / (f.baseHigh - Math.min(l[t1], l[t2]));
        const dist = (h[m] / latestClose - 1) * 100;
        if (f.priorImpulsePct >= 30 && f.depthPct >= 15 && f.depthPct <= 40 && m > t1 && m < t2 &&
          (rebound >= 0.10 || h[m] - l[t1] >= 2 * atrAbs) && rel >= -0.07 && rel <= 0.05 && reclaimed &&
          pos >= 0.5 && dist >= -5 && latestClose >= 0.95 * sma30) {
          labels.push("double_bottom");
          if (!labels.includes("cup")) f.pivot = r4(h[m]);
        }
      }
    }
  }
  // Ascending base (own window: highs may rise, so no "left high" requirement)
  {
    for (let Wa = 9; Wa <= 30 && !labels.includes("ascending"); Wa++) {
      const sa = i - Wa + 1;
      if (sa < 26) break;
      const zz = zigzagPullbacks(h, l, sa, i, 0.07);
      const pb = zz.pullbacks;
      if (pb.length < 3 || pb.length > 4) continue;
      const okDepth = pb.every((p) => p.depth >= 0.08 && p.depth <= 0.22);
      let higherLows = true, highsUp = true, noBlowout = true;
      for (let k = 1; k < pb.length; k++) {
        if (l[pb[k].loIdx] < l[pb[k - 1].loIdx] * 1.01) higherLows = false;
        if (h[pb[k].hiIdx] < h[pb[k - 1].hiIdx] * 0.99) highsUp = false;
        if (pb[k].depth > 1.25 * pb[k - 1].depth) noBlowout = false;
      }
      const preLow = Math.min(...l.slice(Math.max(0, sa - 52), sa));
      const imp = (Math.max(...h.slice(sa, i + 1)) / preLow - 1) * 100;
      const top = Math.max(...h.slice(sa, i + 1)), bot = Math.min(...l.slice(sa, i + 1));
      const pos = (latestClose - bot) / (top - bot);
      const dist = (top / latestClose - 1) * 100;
      if (okDepth && higherLows && highsUp && noBlowout && imp >= 50 && ctx.aboveSma30 && ctx.aboveSma40 &&
        ctx.sma30Slope8Pct > 0 && ctx.ext30wPct <= 35 && pos >= 0.6) labels.push("ascending");
    }
  }
  // Box / rectangle (Darvas)
  {
    // Two separate touches of the top and two of the bottom (≥ 2 weeks apart), a tight range.
    const tol = Math.max(0.02 * f.baseHigh, 0.5 * atr10(e));
    const touches = (hit: (k: number) => boolean) => {
      let count = 0, last = -9;
      for (let k = s; k <= e; k++) if (hit(k) && k - last >= 2) { count++; last = k; }
      return count;
    };
    const top = touches((k) => h[k] >= f.baseHigh - tol);
    const bottom = touches((k) => l[k] <= f.baseLow + tol);
    if (top >= 2 && bottom >= 2 && W >= 4 && f.depthPct <= 20 && f.priorImpulsePct >= 20 && ctx.aboveSma30 &&
      ctx.sma30Slope8Pct >= 0 && f.stopRiskPct <= 15) labels.push("box");
  }
  // High-tight flag (separate model: impulse ≥ 90% in ≤ 8 weeks, then a 2–5 week flag)
  let htf = false;
  {
    for (let hiIdx = i - 2; hiIdx >= i - 5 && !htf; hiIdx--) {
      let lowIdx = -1;
      for (let k = Math.max(0, hiIdx - 8); k < hiIdx; k++) if (lowIdx === -1 || l[k] < l[lowIdx]) lowIdx = k;
      if (lowIdx < 0) continue;
      if (h[hiIdx] < Math.max(...h.slice(hiIdx, i + 1)) * 0.999) continue; // flag must stay below the impulse high
      const impulse = h[hiIdx] / l[lowIdx] - 1;
      const flagLow = Math.min(...l.slice(hiIdx + 1, i + 1));
      const flagDepth = 1 - flagLow / h[hiIdx];
      const posInImpulse = (latestClose - l[lowIdx]) / (h[hiIdx] - l[lowIdx]);
      const flagCloses = c.slice(hiIdx, i + 1);
      const slopePct = olsSlope(flagCloses) / flagCloses[0] * 100;
      const flagVol = median(v.slice(hiIdx + 1, i + 1)), impVol = median(v.slice(lowIdx + 1, hiIdx + 1));
      const flagRisk = (h[hiIdx] - flagLow) / h[hiIdx] * 100;
      const dist = (h[hiIdx] / latestClose - 1) * 100;
      debug?.push(`htf hi=${hiIdx} imp=${impulse.toFixed(2)} depth=${flagDepth.toFixed(3)} pos=${posInImpulse.toFixed(2)} slope=${slopePct.toFixed(2)} vol=${(flagVol / impVol).toFixed(2)} risk=${flagRisk.toFixed(1)} dist=${dist.toFixed(1)} $=${dollarVolM}`);
      if (impulse >= 0.9 && flagDepth >= 0.10 && flagDepth <= 0.34 && posInImpulse >= 0.5 && slopePct <= 0.5 &&
        flagVol <= 0.9 * impVol && flagRisk <= 20 && dist <= 8 && (dollarVolM ?? 0) >= 30 &&
        ctx.aboveSma10 && ctx.aboveSma30) {
        htf = true;
        labels.unshift("htf");
        f.pivot = r4(h[hiIdx]);
        f.support = r4(flagLow);
        f.stopRiskPct = r1(flagRisk);
        // describe the flag itself (not the generic window)
        f.weeks = i - hiIdx;
        f.baseStart = isoWeekEnd(bars[hiIdx].t);
        f.baseHigh = r4(h[hiIdx]);
        f.baseLow = r4(flagLow);
        f.depthPct = r1(flagDepth * 100);
        f.priorImpulsePct = r1(impulse * 100);
        f.rangePos = r2(clamp((latestClose - flagLow) / (h[hiIdx] - flagLow), -0.5, 1.5));
      }
    }
  }
  // Structural minimum for any base candidate (developing ones included): a real prior
  // advance, still near the highs, not a collapse, MA30 not falling hard, not in Stage 4.
  // The generic gates then decide how far along it is (state), not whether it exists.
  const structOk = f.priorImpulsePct >= 20 && f.pctFrom52wHigh >= -35 && f.depthPct <= 50 && W >= 3 &&
    latestClose >= 0.9 * sma30 && ctx.sma30Slope8Pct >= -1 && input.stage?.stage !== 4;
  if (!base.gatesOk && !structOk) return null;   // nothing worth showing

  // A pattern-specific pivot (cup handle high, double-bottom middle peak, flag high) can differ
  // from the generic one — the breakout is judged against the final pivot.
  const piv = f.pivot;
  if (trigger.status === "none" && (latestClose > buffer(piv) || (clearedThisWeek(piv) && c[i] <= buffer(piv)))) {
    const brokeThisWeek = c[i - 1] <= piv;
    trigger = { ...trigger, status: "triggered", source: daily.length ? "daily" : "weekly",
      date: brokeThisWeek ? isoWeekEnd(bars[i].t) : null,
      rvol: brokeThisWeek ? r2(v[i] / (sma(v, i - 1, 10) || 1)) : null };
  }
  // Daily breakout quality: first daily close above the pivot within the last 10 sessions.
  if (trigger.status !== "none" && daily.length) {
    const from = Math.max(51, daily.length - 10);
    let k = -1;
    for (let j = from; j < daily.length; j++) if (daily[j].close > buffer(piv)) { k = j; break; }
    if (k >= 0) {
      const d = daily[k];
      const avg50 = median(daily.slice(k - 50, k).map((x) => x.volume)) || 1;
      const trs = daily.slice(k - 20, k).map((x, j2) => {
        const pc = daily[k - 20 + j2 - 1]?.close ?? x.open;
        return Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc));
      });
      const trK = Math.max(d.high - d.low, Math.abs(d.high - daily[k - 1].close), Math.abs(d.low - daily[k - 1].close));
      const rvol = d.volume / avg50;
      trigger.date = isoDay(d.ts);
      trigger.rvol = r2(rvol);
      trigger.closeLocation = d.high > d.low ? r2((d.close - d.low) / (d.high - d.low)) : null;
      trigger.rangeExpansion = r2(trK / (median(trs) || trK));
      trigger.exceptional = rvol >= 2.5 && (trigger.closeLocation ?? 0) >= 0.75 && (trigger.rangeExpansion ?? 0) >= 1.2;
      trigger.source = "daily";
      // failed: a close back below the pivot within 3 sessions of the breakout
      for (let j = k + 1; j <= Math.min(daily.length - 1, k + 3); j++) if (daily[j].close < piv) { trigger.status = "failed"; break; }
    } else if (latestClose <= buffer(piv)) {
      // the daily closes never cleared this pivot — no breakout
      trigger = { ...trigger, status: "none", date: null, rvol: null, source: null };
    }
    // else: cleared it more than 10 sessions ago — keep the weekly date, no daily grade
  }
  if (trigger.status !== "none") {
    const ext = (latestClose / piv - 1) * 100;
    trigger.extensionPct = r1(ext);
    if (trigger.status !== "failed") {
      if (latestClose < piv) trigger.status = "failed";
      else if (ext > 5) trigger.status = "extended";
    }
  }
  // Pivot & risk points follow the final pivot / stop (pattern levels can differ from the generic ones).
  if (piv !== genericPivot) {
    f.stopRiskPct = r1(Math.max(0, (piv - f.support) / piv * 100));
    const distNow = (piv / latestClose - 1) * 100;
    f.parts.pivotRisk = r1((f.pivotContacts >= 3 ? 4 : f.pivotContacts >= 2 ? 3 : 0) +
      (distNow <= 5 ? 3 : distNow <= 8 ? 1.5 : 0) + (f.stopRiskPct <= 7 ? 3 : f.stopRiskPct <= 12 ? 1.5 : 0));
  }
  if (!labels.length) labels.push("generic");

  // ── base count (Stage 2 only): earlier bases in this advance = corrections of ≥ max(10%, 1.5 ATR)
  // lasting ≥ 5 weeks (high to new high) that the stock then climbed out of. A correction of
  // 40%+ resets the count (O'Neil) — the advance after it is a new cycle.
  let baseCount = 1, capped = false;
  if (input.stage && input.stage.stage === 2) {
    // counted over at most the last two years of the advance
    const since = Math.max(26, i - input.stage.weeksInStage + 1, i - 104);
    capped = i - input.stage.weeksInStage + 1 < Math.max(26, i - 104);
    const thrBC = Math.max(0.10, 1.5 * (atrPctSeries[i] || 0.05));
    const zz = zigzagPullbacks(h, l, since, Math.max(since + 1, s - 1), thrBC);
    for (const p of zz.pullbacks) {
      let r = -1;
      for (let k = p.loIdx + 1; k < s; k++) if (h[k] > h[p.hiIdx]) { r = k; break; }
      if (r < 0) continue;                       // never cleared that high before this base
      if (p.depth >= 0.40) { baseCount = 1; continue; }
      if (r - p.hiIdx >= 5) baseCount++;
    }
  }


  const distToPivotPct = r1((f.pivot / latestClose - 1) * 100);

  // Compact weekly chart (last 52 weeks + 30-week MA) so the app can draw the base without
  // another data call. ~1 KB per base.
  const CH = Math.min(52, n);
  const sig = (x: number) => Number(x.toPrecision(5));
  const k0 = n - CH;
  const chart = {
    c: c.slice(k0).map(sig), h: h.slice(k0).map(sig), l: l.slice(k0).map(sig),
    ma: c.slice(k0).map((_, k) => { const m = sma(c, k0 + k, 30); return Number.isFinite(m) ? sig(m) : null; }),
    from: Math.max(0, bars.findIndex((b) => isoWeekEnd(b.t) === f.baseStart) - k0),
    end: isoWeekEnd(bars[i].t),
  };

  return {
    chart,
    ...f,
    labels,
    latestClose: r4(latestClose),
    latestDate,
    distToPivotPct,
    baseCount,
    baseCountCapped: capped,
    trigger,
    marketStage: input.marketStage,
    stageNow: input.stage?.stage ?? null,
    dataNote: dailyFresh ? null : "No recent daily bars (run Full Scan) — breakout timing uses weekly closes",
    gatesOk: base.gatesOk,
    gateFails: base.fails,
  };
}

// ── finalize with the cross-sectional RS percentile ──────────────
export function finalizeBase(f: BaseFeatures, rsPct: number | null, earningsInDays: number | null): FinalBase | null {
  const rsPts = rsPct === null ? 3 : rsPct >= 90 ? 7 : rsPct >= 80 ? 5 : rsPct >= 70 ? 3 : 0;
  const breakdown = { ...f.parts, rs: Math.min(15, f.parts.rs + rsPts) };
  const score = Math.round(Math.min(100,
    breakdown.trend + breakdown.rs + breakdown.geometry + breakdown.contraction + breakdown.volume + breakdown.pivotRisk + breakdown.market));

  // RS-percentile gates per label (generic needs ≥ 75)
  let labels = f.labels.filter((lb) => rsPct === null || rsPct >= LABEL_MIN_RS[lb]);
  // A named pattern that misses its stricter RS bar can still be a generic quality base.
  if (!labels.length && (rsPct === null || rsPct >= LABEL_MIN_RS.generic)) labels = ["generic"];
  if (!labels.length) return null;
  // A VCP with 3+ contractions is the most specific description; with only two, a cup or
  // double bottom shape says more.
  const primaryLabel = labels.includes("vcp") && !labels.includes("htf") && f.pullbacks.length >= 3
    ? "vcp" : LABEL_PRIORITY.find((lb) => labels.includes(lb)) ?? "generic";

  const band: FinalBase["band"] = score >= 85 ? "prime" : score >= 75 ? "qualified" : score >= 65 ? "developing" : "research";
  let state: FinalBase["state"];
  if (f.trigger.status === "failed") state = "failed";
  else if (f.trigger.status === "extended") state = "extended";
  else if (f.trigger.status === "triggered") state = "triggered";
  else if (score >= 75 && f.distToPivotPct <= 8 && f.distToPivotPct >= -1 && f.stopRiskPct <= 12) state = "ready";
  else if (score >= 75 && f.distToPivotPct <= 10) state = "qualified";
  else if (score >= 65) state = "developing";
  else state = "watch";
  // A base that misses a generic gate is still forming — never "ready" / "qualified" yet.
  if (!f.gatesOk && (state === "ready" || state === "qualified")) state = "developing";

  const warnings: string[] = [];
  const GATE_TEXT: Record<string, string> = {
    belowMA30: "Below 30-week MA", maSlope: "30-week MA falling", farFromHigh: "25%+ below 52w high",
    depth: "Deep base (>40%)", giveback: "Gave back most of the prior advance", rangePos: "Low in its base — right side not built yet",
    impulse: "Small prior advance (<30%)", weeks: "Base length outside 5–52 weeks",
  };
  for (const g of f.gateFails ?? []) if (GATE_TEXT[g]) warnings.push(GATE_TEXT[g]);
  if (f.depthPct > 33 && f.depthPct <= 40 && primaryLabel !== "double_bottom") warnings.push("Deep base");
  if (f.stopRiskPct > 10) warnings.push(`Wide stop (${f.stopRiskPct.toFixed(1)}%)`);
  if (f.rangeContraction !== null && f.rangeContraction > 1) warnings.push("Loose right side");
  if (f.baseCount >= 4) warnings.push(`Late-stage base (${f.baseCount}${f.baseCountCapped ? "+" : ""})`);
  else if (f.baseCount === 3) warnings.push("3rd-stage base");
  if (f.trigger.status === "extended") warnings.push("5%+ above pivot");
  if (f.trigger.status === "failed") warnings.push("Closed back below pivot");
  if (f.trigger.status === "triggered" && f.trigger.rvol !== null && f.trigger.rvol < 1.2) warnings.push("Breakout on light volume");
  if (!f.aboveSma10) warnings.push("Below 10-week MA");
  if (f.dryUp !== null && f.dryUp <= 0.75 && f.rangePos < 0.5) warnings.push("Volume dry-up while price sags");
  if (earningsInDays !== null && earningsInDays >= 0 && earningsInDays <= 14) warnings.push(`Earnings in ${earningsInDays}d`);
  if (primaryLabel === "htf") warnings.push("HTF: high volatility, size down");
  if (f.stageNow === 3) warnings.push("Stage 3 — topping risk");
  else if (f.stageNow === 4) warnings.push("Stage 4 — downtrend");

  const tier: FinalBase["tier"] = state === "ready" || state === "qualified"
    ? (score >= 85 && f.distToPivotPct <= 3 && !warnings.some((w) => w.startsWith("Wide") || w.startsWith("Late") || w.startsWith("Stage")) ? 1 : score >= 75 && f.distToPivotPct <= 5 ? 2 : null)
    : null;

  return { score, band, state, primaryLabel, labels, rsPct, breakdown, warnings, tier };
}
