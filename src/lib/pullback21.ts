// ─────────────────────────────────────────────────────────────
// 21 EMA pullback check (daily).
//
// Distance to the 21 EMA is measured in the stock's own daily range (ADR), not in %:
// 2% away is "at the EMA" for a stock that moves 6% a day but far for one that moves 1.5%.
//   dist = (low − EMA21) / (EMA21 × ADR%)
//   > 1 ADR above       → far (not a pullback yet)
//   0.5 – 1 ADR above   → approaching
//   ±0.5 ADR            → in the zone   (a deeper wick that closes back above the EMA counts too)
//   > 0.5 ADR below and closes under the EMA → too deep
// Green light = the first green candle whose low is in the zone (or right after a candle that
// touched it). Entry = buy-stop just above that candle's high; stop = below the pullback low.
// Health checks: 21 EMA rising, above the 50 EMA, pullback on lighter volume, depth from the high.
// Thresholds are starting points (judgment calls) — kept as constants.
// ─────────────────────────────────────────────────────────────

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

export const ZONE = { far: 1, near: 0.5, deep: -0.5 } as const;
const ADR_DAYS = 20;
const LOOKBACK_TOUCH = 3;   // a green candle can follow a touch within this many bars
const SWING_DAYS = 15;      // where to look for the high the pullback started from
const MAX_DEPTH_ADR = 4;    // deeper than this from the high is not an orderly pullback

export type ZoneState = "far" | "approaching" | "zone" | "deep";
export type Light = "green" | "yellow" | "red" | "grey";

export interface Check { label: string; ok: boolean; detail: string }
export interface PullbackResult {
  light: Light;
  headline: string;
  advice: string;
  zone: ZoneState;
  distAdr: number;          // latest bar's low vs EMA21, in ADRs
  ema21: number; ema50: number; adrPct: number; price: number;
  trigger: number | null;   // buy-stop price (green light)
  stop: number | null;      // suggested stop
  triggered: boolean;       // price already traded above the trigger
  checks: Check[];
  lastBar: Bar;
  barInProgress: boolean;
  recent: { t: string; distAdr: number; green: boolean; zone: ZoneState }[]; // last 8 bars
}

export function ema(values: number[], len: number): number[] {
  const k = 2 / (len + 1), out: number[] = [];
  let prev = values.slice(0, len).reduce((a, b) => a + b, 0) / Math.min(len, values.length);
  values.forEach((v, i) => { prev = i < len ? prev : v * k + prev * (1 - k); out.push(i < len - 1 ? NaN : prev); });
  return out;
}

const zoneOf = (dLow: number, dClose: number): ZoneState =>
  dLow > ZONE.far ? "far" : dLow > ZONE.near ? "approaching" : dLow >= ZONE.deep || dClose >= 0 ? "zone" : "deep";

const r2 = (v: number) => Math.round(v * 100) / 100;

export function analyzePullback(barsIn: Bar[], barInProgress = false): PullbackResult | { error: string } {
  const bars = barsIn.filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  if (bars.length < 60) return { error: "Not enough daily history (need 60+ days)." };
  const closes = bars.map((b) => b.c);
  const e21 = ema(closes, 21), e50 = ema(closes, 50);
  const n = bars.length, last = n - 1;
  // ADR from completed bars only
  const adrEnd = barInProgress ? last : n;
  const adrBars = bars.slice(Math.max(0, adrEnd - ADR_DAYS), adrEnd);
  const adrPct = (adrBars.reduce((a, b) => a + (b.h / b.l - 1), 0) / adrBars.length) * 100;
  const adrAt = (i: number) => e21[i] * (adrPct / 100);
  const dLow = (i: number) => (bars[i].l - e21[i]) / adrAt(i);
  const dClose = (i: number) => (bars[i].c - e21[i]) / adrAt(i);
  const zAt = (i: number) => zoneOf(dLow(i), dClose(i));
  const green = (i: number) => bars[i].c > bars[i].o;

  // Swing high the pullback started from
  let hi = last;
  for (let i = last; i >= Math.max(0, n - SWING_DAYS); i--) if (bars[i].h > bars[hi].h) hi = i;
  const pbBars = bars.slice(hi + 1);
  const pbLow = Math.min(...bars.slice(hi).map((b) => b.l));
  const depthAdr = (bars[hi].h - pbLow) / (bars[hi].h * adrPct / 100);
  const vol50 = bars.slice(-51, -1).reduce((a, b) => a + b.v, 0) / 50;
  const pbVol = pbBars.length ? pbBars.reduce((a, b) => a + b.v, 0) / pbBars.length : NaN;

  const checks: Check[] = [
    { label: "21 EMA rising", ok: e21[last] > e21[last - 5], detail: `${r2(((e21[last] / e21[last - 5]) - 1) * 100)}% over 5 days` },
    { label: "Above the 50 EMA", ok: e21[last] > e50[last] && bars[last].c > e50[last], detail: `21 EMA ${r2(e21[last])} · 50 EMA ${r2(e50[last])}` },
    { label: "Pullback on lighter volume", ok: !pbBars.length || pbVol < vol50, detail: pbBars.length ? `${Math.round((pbVol / vol50) * 100)}% of 50-day avg` : "no pullback days yet" },
    { label: "Orderly depth", ok: depthAdr <= MAX_DEPTH_ADR, detail: `${r2(depthAdr)} ADR off the high (${bars[hi].t})` },
  ];
  const trendOk = checks[0].ok && checks[1].ok;

  // Signal bar = latest completed bar (today's bar counts only if complete).
  const sig = barInProgress ? last - 1 : last;
  // First touch of the zone in the last few completed bars (not before the swing high).
  const from = Math.max(hi, sig - LOOKBACK_TOUCH - 2);
  let firstTouch = -1;
  for (let j = from; j <= sig; j++) if (zAt(j) === "zone") { firstTouch = j; break; }
  // First green candle from the touch on (the touch candle itself can be it).
  let fg = -1;
  if (firstTouch >= 0) for (let j = firstTouch; j <= sig; j++) if (green(j) && zAt(j) !== "deep") { fg = j; break; }
  if (fg >= 0 && sig - fg > LOOKBACK_TOUCH) fg = -1;   // too old to act on
  const zone = zAt(last);
  const base = { zone, distAdr: r2(dLow(last)), ema21: r2(e21[last]), ema50: r2(e50[last]), adrPct: r2(adrPct), price: bars[last].c, checks, lastBar: bars[last], barInProgress,
    recent: bars.slice(-8).map((b, k) => { const i = n - 8 + k; return { t: b.t, distAdr: r2(dLow(i)), green: green(i), zone: zAt(i) }; }) };

  const fmt = (v: number) => v.toFixed(2);
  if (!trendOk) return { ...base, light: "red", headline: "Trend not intact", advice: "The 21 EMA isn't rising above the 50 — this isn't a pullback in an uptrend. Skip.", trigger: null, stop: null, triggered: false };
  if (zone === "deep" || zAt(sig) === "deep") return { ...base, light: "red", headline: "Too deep", advice: `Closed more than ${-ZONE.deep} ADR under the 21 EMA — the pullback is turning into a breakdown. Wait for it to reclaim the EMA.`, trigger: null, stop: null, triggered: false };
  if (fg >= 0) {
    const trigger = r2(bars[fg].h + Math.max(0.01, bars[fg].h * 0.001));
    const stop = r2(Math.min(bars[fg].l, pbLow) - Math.max(0.01, bars[fg].l * 0.001));
    let trigIdx = -1;
    for (let j = fg + 1; j <= last; j++) if (bars[j].h >= trigger) { trigIdx = j; break; }
    const caution = checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
    const cautionText = caution.length ? ` Caution: ${caution.join(", ")}.` : "";
    if (trigIdx >= 0) {
      const ext = (bars[last].c - trigger) / (trigger * adrPct / 100);
      return { ...base, light: ext <= 0.5 ? "green" : "grey", headline: "Triggered",
        advice: `The first green candle (${bars[fg].t}) triggered above ${fmt(trigger)} on ${bars[trigIdx].t}. Price is ${r2(ext)} ADR past the entry — ${ext <= 0.5 ? "still close to it" : "don't chase; wait for the next setup"}. Stop under ${fmt(stop)}.${cautionText}`,
        trigger, stop, triggered: true };
    }
    return { ...base, light: "green", headline: "Green light",
      advice: `First green candle at the 21 EMA (${bars[fg].t}). Buy-stop above ${fmt(trigger)}, stop under ${fmt(stop)}.${cautionText}`,
      trigger, stop, triggered: false };
  }
  if (zone === "zone" || firstTouch >= 0) return { ...base, light: "yellow", headline: "In the zone — wait", advice: `Touching the 21 EMA. Wait for the first green candle${barInProgress ? " to close" : ""}, then buy above its high.`, trigger: null, stop: null, triggered: false };
  if (zone === "approaching") return { ...base, light: "yellow", headline: "Approaching", advice: `${base.distAdr} ADR above the 21 EMA — close, but not there yet. The zone starts at ${ZONE.near} ADR (about ${fmt(e21[last] + ZONE.near * adrAt(last))}).`, trigger: null, stop: null, triggered: false };
  return { ...base, light: "grey", headline: "Not a pullback yet", advice: `${base.distAdr} ADR above the 21 EMA. The zone starts around ${fmt(e21[last] + ZONE.near * adrAt(last))}.`, trigger: null, stop: null, triggered: false };
}
