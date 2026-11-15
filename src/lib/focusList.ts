import { withGroupStage } from "@/lib/groupStage";
/**
 * Focus-list organizer: sorts a watchlist into the user's two setups and orders it for action.
 *
 *  • 21 EMA pullback — the stock ran ≥ `minRunPct` from its last daily 21 EMA touch (the user adds
 *    names before they pull back). Status by where it is in the cycle, in ADR units:
 *    at the EMA (≤ 0.5 ADR / touching) → approaching (≤ 1.5 ADR and falling) → extended → lost.
 *  • Breakout — the base scanner sees a base (incl. high-tight flags): breaking out (closed above the
 *    pivot) → near the pivot (ready, or within ~1 ADR) → building.
 *  • Neither → "no setup" with the reason.
 *
 * Output: industry blocks (your stocks first, then their strongest peers from the universe) inside
 * each setup group, blocks ordered by their most-ready stock; SPY / QQQ / IWM pinned on top.
 * Pure functions — the component loads the data.
 */

export interface Bar { ts: number; open: number | null; high: number | null; low: number | null; close: number | null; volume?: number | null }

export const MARKET = ["SPY", "QQQ", "IWM"] as const;

export type Setup = "pullback" | "breakout" | "none";
export type Status =
  | "pb_at" | "pb_near" | "pb_ext"
  | "bo_break" | "bo_near" | "bo_build"
  | "none";

export const STATUS_INFO: Record<Status, { setup: Setup; label: string; order: number; tip: string }> = {
  pb_at:    { setup: "pullback", label: "At the 21 EMA",     order: 0, tip: "Within your alert zone (≈0.5 ADR) of the daily 21 EMA, or touching it now — look for the first green candle." },
  bo_break: { setup: "breakout", label: "Breaking out",      order: 1, tip: "Closed above its base pivot recently (within the buy zone)." },
  bo_near:  { setup: "breakout", label: "Near the pivot",    order: 2, tip: "Base ready, or within about one day's range (ADR) below the pivot." },
  pb_near:  { setup: "pullback", label: "Pulling back",      order: 3, tip: "Falling toward the 21 EMA — within 1.5 ADR, or several days off its high." },
  bo_build: { setup: "breakout", label: "Building a base",   order: 4, tip: "A base is forming but isn't tight or close to the pivot yet." },
  pb_ext:   { setup: "pullback", label: "Extended — waiting", order: 5, tip: "Big run since the last EMA touch, still far above it — on watch for the pullback." },
  none:     { setup: "none",     label: "No setup now",      order: 6, tip: "Neither a pullback candidate nor a base right now." },
};

export interface EmaRead {
  asOf: string;
  close: number;
  ema: number;
  adr: number;            // $ — 14 completed days
  adrPct: number;         // % of price
  distAdr: number;        // (close − EMA) / ADR
  touchingNow: boolean;   // the latest bar's low reached the EMA
  runPct: number | null;  // EMA at the previous touch → highest high since
  runDays: number | null;
  daysSincePeak: number;
  offPeakPct: number;     // close vs that high
  downDays: number;       // consecutive lower closes
  noTouchInData: boolean;
}

const ema = (xs: number[], n: number) => {
  const out: (number | null)[] = xs.map(() => null);
  if (xs.length < n) return out;
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < xs.length; i++) { e = xs[i] * k + e * (1 - k); out[i] = e; }
  return out;
};

/** Read the daily 21 EMA cycle from daily bars (oldest → newest). */
export function readEma(raw: Bar[]): EmaRead | null {
  const bars = raw
    .filter((b) => b.close !== null && b.high !== null && b.low !== null && (b.close as number) > 0)
    .map((b) => ({ ts: b.ts, close: b.close as number, high: b.high as number, low: b.low as number }))
    .sort((a, b) => a.ts - b.ts);
  if (bars.length < 40) return null;
  const C = bars.map((b) => b.close), H = bars.map((b) => b.high), L = bars.map((b) => b.low);
  const E = ema(C, 21);
  const n = bars.length - 1;
  const e = E[n];
  if (e === null) return null;
  // ADR from the 14 completed days before the latest bar
  const rng: number[] = [];
  for (let i = Math.max(0, n - 14); i < n; i++) rng.push(H[i] - L[i]);
  const adr = rng.reduce((a, b) => a + b, 0) / Math.max(1, rng.length);
  if (!(adr > 0)) return null;
  const touched = (i: number) => E[i] !== null && L[i] <= (E[i] as number);
  // current touching streak, then the run before it back to the previous touch
  let s = n;
  while (s >= 0 && touched(s)) s--;
  const touchingNow = s < n;
  let p = s;
  while (p >= 0 && E[p] !== null && !touched(p)) p--;
  const firstEma = E.findIndex((v) => v !== null);
  const noTouch = p < firstEma || E[p] === null;
  const from = noTouch ? firstEma : p;
  let peak = -Infinity, peakIdx = from;
  for (let i = from + 1; i <= s; i++) if (H[i] > peak) { peak = H[i]; peakIdx = i; }
  const base = noTouch ? C[from] : (E[p] as number);
  const runPct = s > from && peak > 0 && base > 0 ? (peak / base - 1) * 100 : null;
  let down = 0;
  for (let i = n; i > 0 && C[i] < C[i - 1]; i--) down++;
  const hiNow = Math.max(...H.slice(peakIdx, n + 1));
  return {
    asOf: new Date(bars[n].ts * 1000).toISOString().slice(0, 10),
    close: C[n], ema: e, adr, adrPct: (adr / C[n]) * 100,
    distAdr: (C[n] - e) / adr,
    touchingNow,
    runPct, runDays: s > from ? s - from : null,
    daysSincePeak: n - peakIdx,
    offPeakPct: (C[n] / hiNow - 1) * 100,
    downDays: down,
    noTouchInData: noTouch,
  };
}

export interface BaseRead { state: string | null; label: string | null; distToPivot: number | null; pivot: number | null; score: number | null }

export interface Classified { status: Status; setup: Setup; reason: string; also: string | null; readiness: number }

const f1 = (v: number) => v.toFixed(1);

/** Decide the setup and status for one stock. */
export function classify(e: EmaRead | null, b: BaseRead | null, stage: number | null, minRunPct: number): Classified {
  // Pullback reading
  let pb: Classified | null = null;
  if (e && e.runPct !== null && e.runPct >= minRunPct && stage !== 4) {
    const run = `+${e.runPct.toFixed(0)}% from the last EMA touch${e.noTouchInData ? " (no touch in the data)" : ""}`;
    const where = `${e.distAdr >= 0 ? f1(e.distAdr) : `−${f1(-e.distAdr)}`} ADR ${e.distAdr >= 0 ? "above" : "below"} the 21 EMA`;
    if (e.distAdr < -1) {
      pb = { status: "none", setup: "none", reason: `${run}, but closed ${f1(-e.distAdr)} ADR below the 21 EMA — the pullback broke the line`, also: null, readiness: 99 };
    } else if (e.touchingNow || Math.abs(e.distAdr) <= 0.5) {
      pb = { status: "pb_at", setup: "pullback", reason: `${run} · ${e.touchingNow ? "touching the EMA now" : where}`, also: null, readiness: Math.abs(e.distAdr) };
    } else if (e.distAdr <= 1.5 && (e.downDays >= 2 || e.daysSincePeak >= 3)) {
      pb = { status: "pb_near", setup: "pullback", reason: `${run} · ${where} · ${e.downDays >= 2 ? `${e.downDays} lower closes` : `${e.daysSincePeak} days off the high`}`, also: null, readiness: 1 + e.distAdr };
    } else {
      pb = { status: "pb_ext", setup: "pullback", reason: `${run} · ${where} (${Math.abs(e.offPeakPct).toFixed(0)}% below its high)`, also: null, readiness: 3 + e.distAdr / 10 };
    }
  }
  // Breakout reading
  let bo: Classified | null = null;
  if (b && b.state && !["failed", "extended", "watch"].includes(b.state)) {
    const name = b.label ? b.label : "base";
    const dist = b.distToPivot;
    const adrPct = e?.adrPct ?? null;
    const distAdr = dist !== null && adrPct ? dist / adrPct : null;
    if (b.state === "triggered") {
      bo = { status: "bo_break", setup: "breakout", reason: `${name} · closed above the ${b.pivot ? `$${b.pivot.toFixed(2)} ` : ""}pivot`, also: null, readiness: 0.2 };
    } else if (b.state === "ready" || (distAdr !== null && distAdr <= 1)) {
      bo = { status: "bo_near", setup: "breakout", reason: `${name} · ${dist !== null ? `${dist.toFixed(1)}% below the pivot` : "ready"}${distAdr !== null ? ` (${f1(distAdr)} ADR)` : ""}`, also: null, readiness: 0.5 + (distAdr ?? 1) };
    } else {
      bo = { status: "bo_build", setup: "breakout", reason: `${name} forming${dist !== null ? ` · ${dist.toFixed(1)}% below the pivot` : ""}`, also: null, readiness: 2.5 + (distAdr ?? 2) / 10 };
    }
  }
  // Both: the one closer to triggering leads; the other is noted
  const live = [pb, bo].filter((x): x is Classified => !!x && x.status !== "none");
  if (live.length) {
    live.sort((x, y) => STATUS_INFO[x.status].order - STATUS_INFO[y.status].order || x.readiness - y.readiness);
    const [lead, other] = live;
    return { ...lead, also: other ? `also ${STATUS_INFO[other.status].label.toLowerCase()} (${other.setup})` : null };
  }
  if (pb) return pb;
  // No setup: say why
  const why: string[] = [];
  if (stage === 4) why.push("Stage 4 (declining)");
  else if (stage === 3) why.push("Stage 3 (topping)");
  if (e) {
    if (e.runPct !== null && e.runPct < minRunPct) why.push(`only +${e.runPct.toFixed(0)}% since the last EMA touch`);
    if (e.distAdr < -1) why.push(`${f1(-e.distAdr)} ADR below the 21 EMA`);
  } else why.push("no daily history yet");
  if (b?.state === "failed") why.push("base breakout failed");
  if (b?.state === "extended") why.push("extended above its base pivot");
  return { status: "none", setup: "none", reason: why.join(" · ") || "no base and no big run", also: null, readiness: 99 };
}

/** 0–100 quality for ordering equally-ready stocks (RS first, then fundamentals and trend). */
export function quality(q: { rsRating: number | null; superperf: boolean; growth: number; stage: number | null; baseScore: number | null }): number {
  let s = (q.rsRating ?? 40) * 0.55;            // up to ~54
  if (q.superperf) s += 15;
  s += Math.min(3, q.growth) * 6;               // up to 18
  if (q.stage === 2) s += 8;
  if (q.baseScore !== null) s += Math.max(0, q.baseScore - 60) / 8;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export interface Row {
  symbol: string;
  industry: string;
  peer: boolean;
  cls: Classified;
  ema: EmaRead | null;
  quality: number;
  rsRating: number | null;
  ret1d: number | null;
}

export interface Block { industry: string; status: Status; rows: Row[] }

/** Group rows into status → industry blocks; blocks ordered by their most-ready stock. */
export function buildBlocks(rows: Row[]): Block[] {
  const byKey = new Map<string, Block>();
  for (const r of rows) {
    const key = `${r.cls.status}|${r.industry}`;
    const b = byKey.get(key) ?? { industry: r.industry, status: r.cls.status, rows: [] };
    b.rows.push(r);
    byKey.set(key, b);
  }
  const blocks = [...byKey.values()];
  for (const b of blocks) b.rows.sort((x, y) => Number(x.peer) - Number(y.peer) || x.cls.readiness - y.cls.readiness || y.quality - x.quality);
  const lead = (b: Block) => Math.min(...b.rows.filter((r) => !r.peer).map((r) => r.cls.readiness));
  const best = (b: Block) => Math.max(...b.rows.filter((r) => !r.peer).map((r) => r.quality));
  blocks.sort((a, b) => STATUS_INFO[a.status].order - STATUS_INFO[b.status].order || lead(a) - lead(b) || best(b) - best(a));
  return blocks;
}

/** TradingView watchlist text: market first, then one section per block (or per status). */
export function tvText(blocks: Block[], opts: { sectionPerIndustry: boolean; includeNone: boolean }): string {
  const seen = new Set<string>();
  const out: string[] = ["###Market", ...MARKET];
  MARKET.forEach((m) => seen.add(m));
  let lastStatus: Status | null = null;
  for (const b of blocks) {
    if (b.status === "none" && !opts.includeNone) continue;
    const syms = b.rows.map((r) => r.symbol).filter((s) => !seen.has(s));
    if (!syms.length) continue;
    syms.forEach((s) => seen.add(s));
    const head = STATUS_INFO[b.status].label.replace(/ — .*/, "");
    if (opts.sectionPerIndustry) out.push(`###${head} · ${withGroupStage(b.industry, "industry")}`.replace(/[,\n]/g, " "));
    else if (b.status !== lastStatus) out.push(`###${head}`);
    lastStatus = b.status;
    out.push(...syms);
  }
  return out.join("\n");
}
