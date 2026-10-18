// ─────────────────────────────────────────────────────────────
// Weinstein Stage Analysis engine — WEINSTEIN_WEEKLY_SMA30_V1
//
// PURE module (no imports). Implements the "Recommended systematic
// classification design" of the Stage Analysis research (§9):
//   • completed weekly bars, 30-week SMA of weekly closes
//   • state machine with memory: Stage 1 vs 3 decided by the prior
//     directional stage, never by shape alone
//   • hysteresis: two weekly confirmations, except clean range breaks
//   • stage ≠ quality: volume / relative performance only change
//     confidence & flags (a breakdown never needs volume)
//   • substages (§9.6), transparent confidence (§9.5), reason codes
// Thresholds are the research's "balanced defaults" (§9.2).
// ─────────────────────────────────────────────────────────────

export interface WeeklyBar {
  t: number; // unix seconds, start of the week
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** 0 = transition / uncertain */
export type Stage = 0 | 1 | 2 | 3 | 4;

export interface StageResult {
  stage: Stage;
  substage: string;           // "1A" | "1" | "1B" | "2A" | "2" | "2B" | "3A" | "3" | "3B" | "4A" | "4" | "4B" | "4B-" | "T"
  confidence: number;         // 0–100
  quality: "HIGH" | "MIXED" | "LOW" | null; // upside-transition quality for fresh Stage 2 (2A)
  event: string | null;       // last confirmed change, e.g. "1→2"
  eventKind: string | null;   // BREAKOUT | BREAKDOWN | RESUMPTION | CONTINUATION | FAILED_BASE | FAILED_BREAKOUT | FAILED_BREAKDOWN | TREND | RANGE
  eventWeeksAgo: number | null;
  weeksInStage: number;
  lastDirectional: 2 | 4 | null;
  history: string;            // confirmed stage for the last ≤104 completed weeks, oldest→newest ("1".."4","T")
  asOf: string;               // ISO date of the last completed week (Friday)
  features: {
    close: number;
    ma30: number;
    maSlope5Pct: number;
    closeVsMaAtr: number;
    aboveFrac10: number;
    rvol4AtEvent: number | null;
    rpSlope13: number | null;
    mrs52: number | null;
    pctFrom52wHigh: number;
    /** Current base/top range (Stage 1, 3, transition only; null otherwise). */
    rangeHigh: number | null;
    rangeLow: number | null;
    /** % the close must rise to clear the range high (≤0 = already above). */
    pctToRangeHigh: number | null;
    rangeWeeks: number | null;
    /** 26-week and year-to-date price change, % (cross-sectional RS ranks, Theme Tracker YTD). */
    r26Pct: number | null;
    ytdPct: number | null;
  };
  reasons: string[];          // short human-readable reasons
}

const DAY = 86400;
/** First week the engine can evaluate: MA30 exists from index 29 and the
 *  10-week persistence window needs MA30 at i−9 (and i−10 for crosses). */
const START_FULL = 39;
/** Young listings (25–44 completed weeks) are classified with a shorter MA instead of not at all. */
const MIN_WEEKS = 25;

/** Drop the current, still-forming week (official labels use completed weeks only). */
export function completedWeeks(bars: WeeklyBar[], nowSec = Date.now() / 1000): WeeklyBar[] {
  const clean = bars.filter((b) => Number.isFinite(b.c) && b.c > 0 && Number.isFinite(b.h) && Number.isFinite(b.l));
  // De-duplicate by week. Yahoo appends the latest DAILY candle as an extra "live" bar inside
  // the last week (e.g. Friday 20:00 next to the Monday-stamped weekly bar). Keeping only that
  // bar would replace the week's open/high/low/volume with one day's — merge instead.
  const byWeek = new Map<number, WeeklyBar>();
  for (const b of [...clean].sort((x, y) => x.t - y.t)) {
    const k = weekKey(b.t);
    const prev = byWeek.get(k);
    byWeek.set(k, prev
      ? { t: prev.t, o: prev.o, h: Math.max(prev.h, b.h), l: Math.min(prev.l, b.l), c: b.c, v: Math.max(prev.v || 0, b.v || 0) }
      : b);
  }
  const out = [...byWeek.values()].sort((a, b) => a.t - b.t);
  if (out.length) {
    const last = out[out.length - 1];
    // A week is complete after Friday's close (20:00–21:00 UTC); 22:00 UTC leaves a margin.
    if (nowSec < weekStart(last.t) + 4 * DAY + 22 * 3600) out.pop();
  }
  return out;
}

function weekStart(t: number) {
  // Monday 00:00 UTC of the bar's week
  const d = new Date(t * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) - dow * DAY;
}
export const weekKey = (t: number) => weekStart(t);

// ── helpers ──────────────────────────────────────────────────────
const sma = (arr: number[], end: number, n: number) => {
  if (end - n + 1 < 0) return NaN;
  let s = 0;
  for (let i = end - n + 1; i <= end; i++) s += arr[i];
  return s / n;
};
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function olsSlope(ys: number[]) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}

interface WeekFeat {
  ma: number; ma10: number; atr: number; slope5: number; aboveFrac10: number; crosses10: number;
  slope13: number; proximityOk: boolean; rising: boolean; falling: boolean; flat: boolean;
  clearlyAbove: boolean; clearlyBelow: boolean; up: boolean; down: boolean; neutral: boolean;
  rvol4: number | null; rp: number | null; rpSlope13: number | null; mrs52: number | null;
}

/**
 * Classify one stock. `bench` = benchmark weekly bars (SPY) for relative performance;
 * `marketStage` = the benchmark's own stage (for confidence alignment), optional.
 */
export function classifyStage(
  barsIn: WeeklyBar[],
  bench: WeeklyBar[] | null,
  marketStage: Stage | null = null,
  trace?: string[],
): StageResult | null {
  const bars = barsIn;
  const n = bars.length;
  if (n < MIN_WEEKS) return null;
  // MA length: 30 weeks normally; a young listing uses what its history allows (≥ 10 weeks),
  // flagged in the reasons and with capped confidence.
  const L = n >= START_FULL + 6 ? 30 : Math.max(10, n - 15);
  const START = L + 9;
  const young = L < 30;

  const c = bars.map((b) => b.c), h = bars.map((b) => b.h), l = bars.map((b) => b.l), v = bars.map((b) => b.v || 0);

  // True range / ATR20
  const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - c[i - 1]), Math.abs(b.l - c[i - 1])));

  // Relative performance vs benchmark, aligned by week
  const benchByWeek = new Map<number, number>();
  for (const b of bench ?? []) benchByWeek.set(weekKey(b.t), b.c);
  const rp: (number | null)[] = bars.map((b) => {
    const bc = benchByWeek.get(weekKey(b.t));
    return bc && bc > 0 ? b.c / bc : null;
  });

  const ma: number[] = c.map((_, i) => sma(c, i, L));
  const feat: (WeekFeat | null)[] = bars.map((_, i) => {
    if (i < START) return null;
    const m = ma[i];
    const atr = sma(tr, i, 20);
    const slope5 = m / ma[i - 5] - 1;
    const atrPct = atr / c[i];
    const band = atrPct > 0.08 ? 0.015 : 0.01;      // widen "flat" for volatile names (§9.2)
    const rising = slope5 > band, falling = slope5 < -band, flat = !rising && !falling;
    const dist = c[i] - m;
    const clearlyAbove = dist > 0.2 * atr, clearlyBelow = dist < -0.2 * atr;
    let above = 0, crosses = 0;
    const prox: number[] = [];
    for (let k = i - 9; k <= i; k++) {
      if (c[k] > ma[k]) above++;
      if (k > i - 9 && Math.sign(c[k] - ma[k]) !== Math.sign(c[k - 1] - ma[k - 1])) crosses++;
      prox.push(Math.abs(c[k] - ma[k]));
    }
    const aboveFrac10 = above / 10;
    const slope13 = olsSlope(c.slice(i - 12, i + 1).map(Math.log));
    const proximityOk = median(prox) <= 1.0 * atr;
    const up = rising && clearlyAbove && aboveFrac10 >= 0.7 && slope13 > 0;
    const down = falling && clearlyBelow && aboveFrac10 <= 0.3 && slope13 < 0;
    const neutral = flat && proximityOk && !up && !down;
    const prevVol = (v[i - 1] + v[i - 2] + v[i - 3] + v[i - 4]) / 4;
    const rvol4 = prevVol > 0 ? v[i] / prevVol : null;
    const rpi = rp[i];
    const rp13 = i >= 13 ? rp[i - 13] : null;
    const rpSlope13 = rpi && rp13 ? Math.log(rpi / rp13) : null;
    let mrs52: number | null = null;
    if (rpi && i >= 51) {
      const win = rp.slice(i - 51, i + 1);
      if (win.every((x) => x !== null)) {
        const avg = (win as number[]).reduce((a, b) => a + b, 0) / 52;
        mrs52 = 100 * (rpi / avg - 1);
      }
    }
    return {
      ma: m, ma10: sma(c, i, 10), atr, slope5, aboveFrac10, crosses10: crosses, slope13, proximityOk,
      rising, falling, flat, clearlyAbove, clearlyBelow, up, down, neutral, rvol4, rp: rpi, rpSlope13, mrs52,
    };
  });

  // ── state machine ────────────────────────────────────────────
  // (explicit casts: these are reassigned inside setStage, so TS must not narrow them)
  let stage = 0 as Stage;
  let lastDir = null as 2 | 4 | null;
  let pending = null as Stage | null;
  let pendingCount = 0;
  let conflictWeeks = 0;
  let segStart = -1;                       // start of the current neutral (Stage 1/3/T) segment
  let stageSince = START;
  let prevStage = 0 as Stage;             // the stage before the current one
  let event = null as string | null, eventKind = null as string | null, eventIdx = -1;
  let rvolAtEvent = null as number | null;
  const confirmed: Stage[] = new Array(n).fill(0);

  const setStage = (to: Stage, i: number, kind: string) => {
    if (to === stage) return;
    const from = stage;
    prevStage = from;
    stage = to;
    stageSince = i;
    event = from === 0 && i === START ? null : `${from === 0 ? "T" : from}→${to === 0 ? "T" : to}`;
    eventKind = kind;
    eventIdx = i;
    rvolAtEvent = feat[i]?.rvol4 ?? null;
    if (to === 2 || to === 4) lastDir = to;
    if (to === 1 || to === 3 || to === 0) segStart = i;
    pending = null; pendingCount = 0;
  };

  for (let i = START; i < n; i++) {
    const f = feat[i]!;
    // range boundaries of the current neutral segment (exclude this week)
    const segFrom = segStart >= 0 && i - segStart >= 4 ? segStart : Math.max(0, i - 13);
    let res = -Infinity, sup = Infinity;
    for (let k = segFrom; k < i; k++) { if (h[k] > res) res = h[k]; if (l[k] < sup) sup = l[k]; }
    const buf = Math.max(0.005 * c[i], 0.1 * f.atr);

    // initial state
    if (i === START) {
      const ret26 = c[i] / c[Math.max(0, i - 26)] - 1;
      if (f.up) setStage(2, i, "TREND");
      else if (f.down) setStage(4, i, "TREND");
      else if (f.neutral) { lastDir = ret26 > 0 ? 2 : 4; setStage(ret26 > 0.2 ? 3 : ret26 < -0.2 ? 1 : 0, i, "RANGE"); }
      else setStage(0, i, "RANGE");
      if (stage === 2 || stage === 4) lastDir = stage;
      confirmed[i] = stage;
      continue;
    }

    // A neutral segment must be a real range before a break out of it counts.
    const segLen = segStart >= 0 ? i - segStart : 0;
    const fromNeutral = stage === 1 || stage === 3 || (stage === 0 && segLen >= 6);
    // A Stage 2 breakout needs a real base (≥ 6 weeks) and an MA that has stopped falling —
    // a V-shaped rebound through a short range under a declining MA is still Stage 1.
    const breakout = (stage === 1 || stage === 0) && segLen >= 6 && c[i] > res + buf && c[i] > f.ma && f.slope5 > -0.005;
    // Drawdown from the 26-week high / rally from the 26-week low (the 30-week MA lags a crash
    // or a squeeze by months, so price structure has to overrule it at the extremes).
    const hh26i = Math.max(...h.slice(Math.max(0, i - 25), i + 1)), ll26i = Math.min(...l.slice(Math.max(0, i - 25), i + 1));
    const ddHigh = c[i] / hh26i - 1, upLow = c[i] / ll26i - 1;
    const ma10Falling = f.ma10 < (feat[i - 3]?.ma10 ?? f.ma10);
    const crash = ddHigh <= -0.35 && c[i] < f.ma - f.atr && ma10Falling;
    const breakdown = (stage === 3 || (stage === 0 && fromNeutral)) && c[i] < sup - buf && c[i] < f.ma && (!f.rising || crash);
    // Resuming Stage 2 means clearing the top area — after a crash the stage-3 range starts
    // well below the old highs, so price must also be back within 15% of the 26-week high.
    const resumption = stage === 3 && c[i] > res + buf && c[i] > f.ma && ddHigh > -0.15 &&
      (f.rising || f.slope5 > (feat[i - 1]?.slope5 ?? 0));
    // A close below the base's support is a failed base (Stage 4) unless the MA is still rising.
    const failedBase = stage === 1 && segLen >= 4 && c[i] < sup - buf && c[i] < f.ma && !f.rising;

    // A range break out of a "transition" period that followed the same trend is a
    // continuation, not a fresh 1→2 breakout / 3→4 breakdown (2A / 4A are reserved for those).
    if (breakout) { setStage(2, i, stage === 0 && lastDir === 2 ? "CONTINUATION" : "BREAKOUT"); conflictWeeks = 0; }
    else if (breakdown) { setStage(4, i, stage === 0 && lastDir === 4 ? "CONTINUATION" : "BREAKDOWN"); conflictWeeks = 0; }
    else if (resumption) { setStage(2, i, "RESUMPTION"); conflictWeeks = 0; }
    else if (failedBase) { setStage(4, i, "FAILED_BASE"); conflictWeeks = 0; }
    else {
      // Stage 2 stays Stage 2 while the 30-week MA still rises and price holds above it — or
      // only dips under it (≤ 1.5 ATR): that is a pullback / MA test, the classic Stage 2
      // buy area, not a top. The mirror holds for Stage 4 rallies into a falling MA.
      // The dip allowance is capped at 8% under the MA (a crash inflates the ATR), and a 35%+
      // drop from the 26-week high is never "holding" (mirror: a 50%+ rally off the low).
      const holdingUp = stage === 2 && f.slope5 > 0 && ddHigh > -0.35 &&
        (c[i] > f.ma ? f.aboveFrac10 >= 0.5 : c[i] >= f.ma - Math.min(1.5 * f.atr, 0.08 * f.ma));
      const holdingDown = stage === 4 && f.slope5 < 0 && upLow < 0.5 &&
        (c[i] < f.ma ? f.aboveFrac10 <= 0.5 : c[i] <= f.ma + Math.min(1.5 * f.atr, 0.08 * f.ma));
      // Losing / reclaiming the MA decisively starts the top (3) / base (1) — never a jump
      // straight to the opposite trend: that needs a range break (breakdown / breakout).
      const losingUp = stage === 2 && !holdingUp && (c[i] < f.ma || ddHigh <= -0.35);
      const reclaimingDown = stage === 4 && !holdingDown && (c[i] > f.ma || upLow >= 0.5);
      // Early Stage 1 / Stage 3 (§3.2, §5.3, §8): the 30-week MA lags, so a base can form while
      // the MA is still falling (and a top while it is still rising). Recognise the stabilisation:
      // no new low (high) for 10 weeks, lateral price, MA slope decelerating, price near the MA.
      const lateral = Math.abs(f.slope13) < 0.004;
      const slopeAgo = feat[i - 8]?.slope5 ?? f.slope5;
      const near = Math.abs(c[i] - f.ma) <= 2 * f.atr;
      const noNewLow = Math.min(...l.slice(i - 9, i + 1)) > Math.min(...l.slice(Math.max(0, i - 25), i - 9));
      const noNewHigh = Math.max(...h.slice(i - 9, i + 1)) < Math.max(...h.slice(Math.max(0, i - 25), i - 9));
      const stabilising = stage === 4 && !f.down && noNewLow && lateral && f.slope5 > slopeAgo && near;
      // A top needs the MA to stop rising — a sideways pause above a rising MA is a Stage 2 base.
      const toppingOut = stage === 2 && !f.up && !f.rising && noNewHigh && lateral && f.slope5 < slopeAgo &&
        (f.crosses10 >= 1 || Math.abs(c[i] - f.ma) <= f.atr);
      let cand: Stage | null;
      if (stabilising) cand = 1;
      else if (toppingOut) cand = 3;
      // The cycle runs 1→2→3→4→1: a Stage 2 stock that turns down tops out first (3), a
      // Stage 4 stock that turns up bases first (1) — no direct 2↔4 flips on a trend signal.
      // Going back the way it came (base → 4, top → 2) takes a break of the range itself
      // (failedBase / resumption above), not just a trend reading inside it.
      else if (f.up || holdingUp) cand = stage === 4 ? 1 : stage === 3 ? 3 : 2;
      else if (f.down || holdingDown) cand = stage === 2 ? 3 : stage === 1 ? 1 : 4;
      else if (losingUp) cand = 3;
      else if (reclaimingDown) cand = 1;
      // A flat MA alone doesn't end a trend: Stage 2 → 3 needs the highs to stop rising,
      // Stage 4 → 1 needs the lows to stop falling (the MA lags a fresh move by weeks).
      else if (f.neutral && stage === 2) cand = noNewHigh ? 3 : 2;
      else if (f.neutral && stage === 4) cand = noNewLow ? 1 : 4;
      else if (f.neutral && (stage === 1 || stage === 3)) cand = stage; // a flat MA is the base / top itself
      else if (f.neutral) cand = lastDir === 4 ? 1 : lastDir === 2 ? 3 : (c[i] / c[Math.max(0, i - 26)] - 1 > 0.2 ? 3 : c[i] / c[Math.max(0, i - 26)] - 1 < -0.2 ? 1 : 0);
      else if (stage === 1 || stage === 3) cand = stage; // inside a base / top, mixed weeks are normal
      else cand = null; // conflicting signals
      // A breakdown from a top that is reclaimed within ~10 weeks was a failed breakdown —
      // the stock is back in its top area (3), not in a new base after a decline (1).
      // Mirror: a fresh breakout that falls back into its base is Stage 1 again, not a top.
      const young = i - stageSince < 10;
      if (cand === 1 && stage === 4 && young && prevStage === 3) cand = 3;
      else if (cand === 3 && stage === 2 && young && prevStage === 1) cand = 1;

      if (cand === null) {
        conflictWeeks++;
        // Keep the last confirmed state through short ambiguity; only long conflict → transition.
        if (conflictWeeks >= 6 && stage !== 0) setStage(0, i, "RANGE");
      } else {
        conflictWeeks = 0;
        if (cand === stage) { pending = null; pendingCount = 0; }
        else {
          if (pending === cand) pendingCount++; else { pending = cand; pendingCount = 1; }
          // Two weekly confirmations; leaving a base/top back the way it came needs three
          // (avoids 4→1→4 flip-flops while the 30-week MA is still catching up).
          const backtrack = (stage === 1 && cand === 4) || (stage === 3 && cand === 2);
          // A decisive exit from a trend (≥ 40% off the 26-week high, or 2 ATR through the MA
          // the wrong way) confirms in one week.
          const decisive = (stage === 2 && cand === 3 && (ddHigh <= -0.4 || c[i] < f.ma - 2 * f.atr)) ||
            (stage === 4 && cand === 1 && (upLow >= 0.6 || c[i] > f.ma + 2 * f.atr));
          if (pendingCount >= (backtrack ? 3 : decisive ? 1 : 2)) {
            const failed = (stage === 4 && cand === 3) || (stage === 2 && cand === 1);
            setStage(cand, i, failed ? (cand === 3 ? "FAILED_BREAKDOWN" : "FAILED_BREAKOUT") : cand === 2 || cand === 4 ? "TREND" : "RANGE");
            // back in the top / base: the trend before it is still the one that counts
            if (failed) lastDir = cand === 3 ? 2 : 4;
          }
        }
      }
    }
    confirmed[i] = stage;
    trace?.push(`${i} c=${c[i].toFixed(1)} ma=${f.ma.toFixed(1)} sl=${(f.slope5*100).toFixed(2)} up=${+f.up} dn=${+f.down} neu=${+f.neutral} prox=${+f.proximityOk} af=${f.aboveFrac10} st=${stage} pend=${pending}`);
  }

  // ── final-week description ───────────────────────────────────
  const i = n - 1;
  const f = feat[i]!;
  const weeksInStage = i - stageSince + 1;
  const eventWeeksAgo = eventIdx >= 0 && event ? i - eventIdx : null;
  const hh52 = Math.max(...h.slice(Math.max(0, n - 52)));
  const ll26 = Math.min(...l.slice(Math.max(0, n - 26))), hh26 = Math.max(...h.slice(Math.max(0, n - 26)));
  const rangePos26 = hh26 > ll26 ? (c[i] - ll26) / (hh26 - ll26) : 0.5;
  const pctFrom52wHigh = (c[i] / hh52 - 1) * 100;
  // Range boundaries of the current base / top (the breakout and breakdown levels to watch).
  let rangeHigh: number | null = null, rangeLow: number | null = null, rangeWeeks: number | null = null;
  if ((stage === 1 || stage === 3 || stage === 0) && segStart >= 0 && i - segStart >= 4) {
    rangeHigh = Math.max(...h.slice(segStart, i));
    rangeLow = Math.min(...l.slice(segStart, i));
    rangeWeeks = i - segStart;
  }
  const pctToRangeHigh = rangeHigh !== null ? (rangeHigh / c[i] - 1) * 100 : null;
  const r26Pct = n > 26 ? (c[i] / c[i - 26] - 1) * 100 : null;
  // YTD: from the last weekly close of the previous calendar year (weeks are dated by their
  // Friday close — bar timestamps are the week's Monday, which can fall in the old year).
  const closeYear = (t: number) => new Date((t + 4 * 86400) * 1000).getUTCFullYear();
  const yr = closeYear(bars[i].t);
  let ytdBase: number | null = null;
  for (let k = i; k >= 0; k--) if (closeYear(bars[k].t) < yr) { ytdBase = c[k]; break; }
  const ytdPct = ytdBase ? (c[i] / ytdBase - 1) * 100 : null;
  const reasons: string[] = [];

  // substage (§9.6)
  let sub = "T";
  const recentEvent = (kinds: string[], within = 13) => !!eventKind && kinds.includes(eventKind) && eventWeeksAgo !== null && eventWeeksAgo < within;
  if (stage === 1) {
    const atrNow = sma(tr, i, 8), atrPrev = sma(tr, i - 8, 8);
    const contracting = atrNow < 0.85 * atrPrev;
    if (weeksInStage <= 13 && f.slope5 < 0) sub = "1A";
    else if (rangePos26 >= 0.6 && contracting && (f.rpSlope13 ?? 0) > 0) sub = "1B";
    else sub = "1";
  } else if (stage === 2) {
    let maxSlope = 0;
    for (let k = Math.max(stageSince, i - 25); k <= i; k++) maxSlope = Math.max(maxSlope, feat[k]?.slope5 ?? 0);
    const decel = maxSlope > 0 && f.slope5 < 0.5 * maxSlope;
    const maTests = f.crosses10 >= 2;
    const rpHigh26 = Math.max(...(rp.slice(Math.max(0, n - 26)).filter((x) => x !== null) as number[]));
    const rpDiv = c[i] >= 0.97 * hh26 && f.rp !== null && Number.isFinite(rpHigh26) && f.rp < 0.95 * rpHigh26;
    const extended = c[i] - f.ma > 3 * f.atr;
    const lateCount = [decel, maTests, rpDiv, extended].filter(Boolean).length;
    if (recentEvent(["BREAKOUT"])) sub = "2A"; // fresh breakout from a base (research §4.3)
    else if (lateCount >= 2) sub = "2B";
    else sub = "2";
    if (decel) reasons.push("MA slope slowing");
    if (extended) reasons.push("Extended far above MA");
    if (rpDiv) reasons.push("RP not confirming new highs");
  } else if (stage === 3) {
    const prevHigh = Math.max(...h.slice(Math.max(0, n - 26), n - 13)), lastHigh = Math.max(...h.slice(n - 13));
    if (weeksInStage <= 8) sub = "3A";
    else if (c[i] < f.ma && lastHigh < prevHigh && (f.rpSlope13 ?? 0) < 0) sub = "3B";
    else sub = "3";
  } else if (stage === 4) {
    const newLowRecent = Math.min(...l.slice(n - 8)) <= Math.min(...l.slice(Math.max(0, n - 26)));
    const slopeImproving = f.slope5 > (feat[i - 8]?.slope5 ?? f.slope5);
    const mature = weeksInStage > 13;
    if (recentEvent(["BREAKDOWN", "FAILED_BASE"])) sub = "4A";
    else if (mature && (slopeImproving || !newLowRecent || (f.rpSlope13 ?? -1) > 0)) {
      sub = !newLowRecent && c[i] > f.ma10 ? "4B-" : "4B";
    } else sub = "4";
  }

  // confidence (§9.5) — transparent rule score
  let conf = 0;
  const mkt = marketStage;
  const rvolEv = rvolAtEvent;
  if (stage === 2) {
    conf += (f.rising ? 15 : !f.falling ? 7 : 0) + (f.clearlyAbove ? 15 : c[i] > f.ma ? 7 : 0);
    conf += Math.min(10, f.aboveFrac10 * 10 / 0.7) + (f.slope13 > 0 ? 10 : 0);
    if (sub === "2A") conf += 20; else conf += c[i] >= 0.85 * hh52 ? 20 : 10;
    conf += ((f.rpSlope13 ?? 0) > 0 ? 6 : 0) + ((f.mrs52 ?? -1) > 0 ? 4 : 0);
    if (sub === "2A") conf += rvolEv === null ? 3 : rvolEv >= 2 ? 10 : rvolEv >= 1.5 ? 6 : rvolEv >= 1 ? 3 : 0;
    else conf += 6;
    conf += mkt === 2 ? 10 : mkt === 1 || mkt === 3 ? 5 : mkt === null ? 5 : 0;
  } else if (stage === 4) {
    conf += (f.falling ? 15 : !f.rising ? 7 : 0) + (f.clearlyBelow ? 15 : c[i] < f.ma ? 7 : 0);
    conf += Math.min(10, (1 - f.aboveFrac10) * 10 / 0.7) + (f.slope13 < 0 ? 10 : 0);
    conf += sub === "4A" ? 25 : pctFrom52wHigh <= -25 ? 20 : 12;
    conf += ((f.rpSlope13 ?? 0) < 0 ? 9 : 0) + ((f.mrs52 ?? 1) < 0 ? 6 : 0);
    conf += mkt === 4 ? 10 : mkt === 1 || mkt === 3 ? 5 : mkt === null ? 5 : 0;
  } else if (stage === 1 || stage === 3) {
    conf += f.flat ? 30 : 12;
    conf += f.proximityOk ? 25 : 10;
    conf += Math.min(20, (weeksInStage / 13) * 15 + (weeksInStage >= 26 ? 5 : 0));
    conf += lastDir !== null ? 15 : 8;
    conf += stage === 1 ? ((f.rpSlope13 ?? -1) >= 0 ? 10 : 0) : ((f.rpSlope13 ?? 1) < 0 ? 10 : 0);
  } else {
    conf = 30;
  }
  if (young) conf = Math.min(conf, 60); // short history: provisional
  conf = Math.max(0, Math.min(100, Math.round(conf)));

  // upside-transition quality for fresh Stage 2 (volume asymmetry: only upside needs volume)
  let quality: StageResult["quality"] = null;
  if (sub === "2A") {
    const pts = (rvolEv !== null && rvolEv >= 2 ? 1 : 0) + ((f.rpSlope13 ?? 0) > 0 ? 1 : 0) + (pctFrom52wHigh > -15 ? 1 : 0);
    quality = pts >= 3 ? "HIGH" : pts === 2 ? "MIXED" : "LOW";
    if (rvolEv !== null && rvolEv < 1.5) reasons.unshift("Breakout on weak volume");
  }

  // core reasons
  const maTxt = f.rising ? "rising" : f.falling ? "falling" : "flat";
  if (stage === 2) reasons.unshift(`Above ${maTxt} ${L}w MA`);
  else if (stage === 4) reasons.unshift(`Below ${maTxt} ${L}w MA`);
  else if (stage === 1 || stage === 3) reasons.unshift(`Sideways around ${maTxt} ${L}w MA · after Stage ${lastDir ?? "?"}`);
  else reasons.unshift("Conflicting signals");
  if (young) reasons.splice(1, 0, `Young listing (${n} weeks) — provisional, ${L}-week MA`);
  if (eventKind === "BREAKOUT" && eventWeeksAgo !== null && eventWeeksAgo < 13 && rvolEv !== null) reasons.push(`Breakout RVOL ${rvolEv.toFixed(1)}×`);
  if ((f.mrs52 ?? 0) > 0 && stage === 2) reasons.push("Outperforming SPY (MRS > 0)");
  if ((f.rpSlope13 ?? 0) < 0 && stage === 2) reasons.push("RP weakening");
  if ((f.rpSlope13 ?? 0) > 0 && (stage === 1 || stage === 4)) reasons.push("RP improving");
  if (sub === "4B-") reasons.push("No new low 8w · above 10w MA");
  if (stage === 1 && pctToRangeHigh !== null && rangeWeeks !== null) reasons.push(`${pctToRangeHigh.toFixed(1)}% below ${rangeWeeks}w range high`);

  const hist = confirmed.slice(Math.max(START, n - 104)).map((s) => (s === 0 ? "T" : String(s))).join("");
  const asOfDate = new Date((weekStart(bars[i].t) + 4 * DAY) * 1000).toISOString().slice(0, 10);

  return {
    stage,
    substage: stage === 0 ? "T" : sub,
    confidence: conf,
    quality,
    event,
    eventKind: event ? eventKind : null,
    eventWeeksAgo: event ? eventWeeksAgo : null,
    weeksInStage,
    lastDirectional: lastDir,
    history: hist,
    asOf: asOfDate,
    features: {
      close: round(c[i], 4),
      ma30: round(f.ma, 4),
      maSlope5Pct: round(f.slope5 * 100, 2),
      closeVsMaAtr: round((c[i] - f.ma) / f.atr, 2),
      aboveFrac10: round(f.aboveFrac10, 2),
      rvol4AtEvent: rvolEv === null ? null : round(rvolEv, 2),
      rpSlope13: f.rpSlope13 === null ? null : round(f.rpSlope13, 4),
      mrs52: f.mrs52 === null ? null : round(f.mrs52, 2),
      pctFrom52wHigh: round(pctFrom52wHigh, 1),
      rangeHigh: rangeHigh === null ? null : round(rangeHigh, 4),
      rangeLow: rangeLow === null ? null : round(rangeLow, 4),
      pctToRangeHigh: pctToRangeHigh === null ? null : round(pctToRangeHigh, 1),
      rangeWeeks,
      r26Pct: r26Pct === null ? null : round(r26Pct, 1),
      ytdPct: ytdPct === null ? null : round(ytdPct, 1),
    },
    reasons: reasons.slice(0, 4),
  };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

