// Pattern-finder traits for one stock, every 5th session (pure; tested without the database).
// Traits (index → meaning) — keep in sync with src/lib/patterns.ts:
//  0 distance from the 21 EMA, in average daily ranges      5 tightening: 10-day range / 50-day range
//  1 run since the last 21 EMA touch (%)                     6 volume dry-up: 10-day volume / 50-day volume
//  2 RS: 3-month return minus SPY's (points)                 7 up-volume / down-volume, 50 days
//  3 distance below the 52-week high (%)                     8 vs SPY on red days (SPY ≤ −0.75%), last 20 sessions
//  4 price vs its 50-day average (%)                         9 stage-2 trend: above a rising 150-day average (0/1)
// (trait 10, industry strength, is added in the database across stocks.)
import { ema, type Bars } from "./lists.ts";

export interface Sample { d: string; f: number[]; win: boolean | null; fwd20: number | null }

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function samplesFor(b: Bars, spy: Bars, step = 5, horizon = 60, winPct = 30): Sample[] {
  const n = b.c.length;
  if (n < 260) return [];
  const e = ema(b.c);
  const spyIdx = new Map(spy.d.map((d, i) => [d, i]));
  const out: Sample[] = [];
  for (let t = n - 1; t >= 252; t -= step) {
    const si = spyIdx.get(b.d[t]);
    if (si === undefined || si < 63) continue;
    const rng = (k: number) => avg(b.h.slice(t - k + 1, t + 1).map((h, i) => 100 * (h / b.l[t - k + 1 + i] - 1)));
    const adr = rng(20);
    // last touch of the 21 EMA
    let touch = -1;
    for (let i = t; i >= Math.max(21, t - 250); i--) if (b.l[i] <= e[i]) { touch = i; break; }
    let hiSince = 0;
    if (touch >= 0) for (let i = touch; i <= t; i++) hiSince = Math.max(hiSince, b.h[i]);
    const run = touch >= 0 ? 100 * (hiSince / e[touch] - 1) : NaN;
    const r63 = 100 * (b.c[t] / b.c[t - 63] - 1), s63 = 100 * (spy.c[si] / spy.c[si - 63] - 1);
    let hi252 = 0; for (let i = t - 251; i <= t; i++) hi252 = Math.max(hi252, b.h[i]);
    const sma = (k: number, at = t) => avg(b.c.slice(at - k + 1, at + 1));
    const v10 = avg(b.v.slice(t - 9, t + 1)), v50 = avg(b.v.slice(t - 49, t + 1));
    let up = 0, dn = 0;
    for (let i = t - 49; i <= t; i++) { if (b.c[i] > b.c[i - 1]) up += b.v[i]; else if (b.c[i] < b.c[i - 1]) dn += b.v[i]; }
    const reds: number[] = [];
    for (let i = t - 19; i <= t; i++) {
      const sj = spyIdx.get(b.d[i]);
      if (sj === undefined || sj < 1) continue;
      const sr = 100 * (spy.c[sj] / spy.c[sj - 1] - 1);
      if (sr <= -0.75) reds.push(100 * (b.c[i] / b.c[i - 1] - 1) - sr);
    }
    const sma150 = sma(150), sma150Prev = sma(150, t - 20);
    const f = [
      adr > 0 ? (100 * (b.c[t] / e[t] - 1)) / adr : NaN,
      run,
      r63 - s63,
      100 * (b.c[t] / hi252 - 1),
      100 * (b.c[t] / sma(50) - 1),
      adr > 0 ? rng(10) / rng(50) : NaN,
      v50 > 0 ? v10 / v50 : NaN,
      dn > 0 ? Math.min(5, up / dn) : NaN,
      reds.length ? avg(reds) : NaN,
      b.c[t] > sma150 && sma150 > sma150Prev ? 1 : 0,
    ].map((x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)) as number[];   // null = unknown (JSON has no NaN)
    let win: boolean | null = null, fwd20: number | null = null;
    if (t + horizon < n) { let best = 0; for (let i = t + 1; i <= t + horizon; i++) best = Math.max(best, b.c[i]); win = 100 * (best / b.c[t] - 1) >= winPct; }
    const sj20 = spyIdx.get(b.d[Math.min(n - 1, t + 20)]);
    if (t + 20 < n && sj20 !== undefined) fwd20 = Math.round((100 * (b.c[t + 20] / b.c[t] - 1) - 100 * (spy.c[sj20] / spy.c[si] - 1)) * 100) / 100;
    out.push({ d: b.d[t], f, win, fwd20 });
  }
  return out;
}
