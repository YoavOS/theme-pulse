// The context of a trade on the day it was entered, from the price history (pure; testable).
import { ema, type Bars } from "./lists.ts";

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

export interface TradeIn { symbol: string; entry_date: string; entry_price: number | null; exit_date: string | null; exit_price: number | null }

export function tradeContext(b: Bars, spy: Bars, t: TradeIn) {
  // the session before entry = what was visible when deciding
  let i = b.d.findIndex((d) => d >= t.entry_date);
  if (i < 0) i = b.d.length;
  const k = i - 1;
  if (k < 60) return null;
  const e = ema(b.c);
  const adr = avg(b.h.slice(k - 19, k + 1).map((h, j) => 100 * (h / b.l[k - 19 + j] - 1)));
  // the run that led into this entry: the highest high of the last 60 sessions, and the last 21 EMA touch before it
  let peak = k;
  for (let j = Math.max(0, k - 59); j <= k; j++) if (b.h[j] > b.h[peak]) peak = j;
  let touch = -1;
  for (let j = peak - 1; j >= Math.max(21, k - 250); j--) if (b.l[j] <= e[j]) { touch = j; break; }
  const sIdx = new Map(spy.d.map((d, j) => [d, j]));
  const sk = sIdx.get(b.d[k]);
  const s50 = sk !== undefined && sk >= 50 ? avg(spy.c.slice(sk - 49, sk + 1)) : NaN;
  let hi252 = 0; for (let j = Math.max(0, k - 251); j <= k; j++) hi252 = Math.max(hi252, b.h[j]);
  const entry = t.entry_price ?? b.c[Math.min(i, b.c.length - 1)];
  // outcome
  let x = t.exit_date ? b.d.findIndex((d) => d >= t.exit_date!) : -1;
  if (x < 0) x = b.d.length - 1;
  const exit = t.exit_price ?? b.c[x];
  let best = entry, worst = entry;
  for (let j = Math.min(i, b.c.length - 1); j <= x; j++) { best = Math.max(best, b.h[j]); worst = Math.min(worst, b.l[j]); }
  const sx = sIdx.get(b.d[x]);
  const spyRet = sk !== undefined && sx !== undefined ? 100 * (spy.c[sx] / spy.c[sk] - 1) : NaN;
  const ret = 100 * (exit / entry - 1);
  return {
    atEntry: {
      runSinceEmaTouchPct: touch >= 0 ? r1(100 * (b.h[peak] / e[touch] - 1)) : null,
      entryVsEma21InDailyRanges: r1((100 * (entry / e[k] - 1)) / adr),
      sessionsSincePeak: k - peak,
      pullbackFromPeakPct: r1(100 * (b.c[k] / b.h[peak] - 1)),
      rs3mVsSpyPts: sk !== undefined && sk >= 63 && k >= 63 ? r1(100 * (b.c[k] / b.c[k - 63] - 1) - 100 * (spy.c[sk] / spy.c[sk - 63] - 1)) : null,
      belowHigh52wPct: r1(100 * (b.c[k] / hi252 - 1)),
      volume10vs50: r1(avg(b.v.slice(k - 9, k + 1)) / avg(b.v.slice(k - 49, k + 1))),
      adrPct: r1(adr),
      spyAbove50d: Number.isFinite(s50) && sk !== undefined ? spy.c[sk] > s50 : null,
    },
    outcome: { returnPct: r1(ret), vsSpyPts: r1(ret - spyRet), bestPct: r1(100 * (best / entry - 1)), worstPct: r1(100 * (worst / entry - 1)), sessionsHeld: x - Math.min(i, b.c.length - 1), open: !t.exit_date },
  };
}
