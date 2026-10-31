// Pure helpers for rs-history: rebuild relative-strength values from daily bars, the same way
// calculate-rs-scores gets them from Yahoo ranges. Kept separate so they can be tested.

export interface Bar { ts: number; high: number | null; low: number | null; close: number | null }

const DAY = 86_400;
const ADR_BARS = 14; // same as process-universe-queue
const r2 = (x: number) => Math.round(x * 100) / 100;

export function cleanBars(ohlc: unknown): Bar[] {
  if (!Array.isArray(ohlc)) return [];
  return (ohlc as Bar[]).filter((b) => b && typeof b.ts === "number" && typeof b.close === "number" && b.close > 0).sort((a, b) => a.ts - b.ts);
}

/** Index of the last bar at or before ts (bars sorted ascending), or -1. */
export function lastAtOrBefore(bars: Bar[], ts: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].ts <= ts) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
/** Index of the first bar at or after ts, or -1. */
export function firstAtOrAfter(bars: Bar[], ts: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].ts >= ts) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
  return ans;
}
const ret = (now: number, then: number) => r2(((now - then) / then) * 100);

/**
 * Returns as of the bar at `i`, matching calculate-rs-scores (checked against the stored values:
 * 1d = 1 bar back, 1w = 4 bars (Yahoo "5d" range), 1m = 21, 3m = 63, 6m = 126 bars).
 */
export const LOOKBACK = { d1: 1, w1: 4, m1: 21, m3: 63, m6: 126 } as const;

export function returnsAt(bars: Bar[], i: number) {
  const c = bars[i].close!;
  const back = (k: number) => (i - k >= 0 ? ret(c, bars[i - k].close!) : null);
  return { d1: back(LOOKBACK.d1), w1: back(LOOKBACK.w1), m1: back(LOOKBACK.m1), m3: back(LOOKBACK.m3), m6: back(LOOKBACK.m6) };
}

export function adrAt(bars: Bar[], i: number): number | null {
  const v: number[] = [];
  for (let j = i; j >= 0 && v.length < ADR_BARS; j--) {
    const b = bars[j];
    if (b.high != null && b.low != null && b.close) v.push(((b.high - b.low) / b.close) * 100);
  }
  return v.length >= 5 ? r2(v.reduce((a, x) => a + x, 0) / v.length) : null;
}

/** Last trading bar of each completed week (from SPY's calendar), newest last. */
export function weekEnds(spy: Bar[], nowTs: number, weeks: number): number[] {
  const weekKey = (ts: number) => {
    const d = new Date(ts * 1000);
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    return Math.floor((ts - day * DAY) / (7 * DAY));
  };
  // On a weekend the week that just ended is complete too.
  const wd = new Date(nowTs * 1000).getUTCDay();
  const cur = weekKey(nowTs) + (wd === 6 || wd === 0 ? 1 : 0);
  const last = new Map<number, number>();
  for (const b of spy) { const k = weekKey(b.ts); if (k < cur) last.set(k, b.ts); }
  return [...last.entries()].sort((a, b) => a[0] - b[0]).map(([, ts]) => ts).slice(-weeks);
}

