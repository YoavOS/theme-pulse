import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// Client side of the Base Scanner (engine: supabase/functions/_shared/baseEngine.ts,
// computed inside the stage-scan function). Loads results and holds display helpers.

export type BaseLabel = "htf" | "cup" | "double_bottom" | "ascending" | "vcp" | "flat" | "box" | "ipo" | "generic";
export type BaseState = "ready" | "qualified" | "developing" | "watch" | "triggered" | "extended" | "failed";

export const LABEL_NAMES: Record<BaseLabel, string> = {
  htf: "High-tight flag",
  vcp: "VCP",
  cup: "Cup w/ handle",
  double_bottom: "Double bottom",
  ascending: "Ascending base",
  flat: "Flat base",
  box: "Box",
  ipo: "IPO base",
  generic: "Base",
};
export const ALL_LABELS: BaseLabel[] = ["vcp", "flat", "cup", "double_bottom", "ascending", "htf", "box", "ipo", "generic"];

export const STATE_NAMES: Record<BaseState, string> = {
  ready: "Ready", qualified: "Qualified", developing: "Developing", watch: "Watch",
  triggered: "Triggered", extended: "Extended", failed: "Failed",
};
export const STATE_TIPS: Record<BaseState, string> = {
  ready: "Score ≥ 75, within ~8% below the pivot and stop risk ≤ 12% — the watchlist for a breakout.",
  qualified: "Score ≥ 75 and within 10% of the pivot — not tight or close enough yet.",
  developing: "Score 65+ but still forming — far from the pivot, low in its range, a wide stop or below the 30-week MA (see its warnings).",
  watch: "Score below 65 — research only.",
  triggered: "Closed above the pivot — within the IBD buy zone (≤ 5% above). A pullback to the pivot (retest) is normal and not a failure.",
  extended: "More than 5% above the pivot — not an orthodox entry any more.",
  failed: "Closed more than 3% back below the pivot after the breakout — a decisive loss of the breakout level.",
};
export const ALL_STATES: BaseState[] = ["ready", "triggered", "qualified", "developing", "extended", "failed", "watch"];

export interface BaseTrigger {
  status: "none" | "triggered" | "extended" | "failed";
  date: string | null;
  rvol: number | null;
  closeLocation: number | null;
  rangeExpansion: number | null;
  exceptional: boolean;
  extensionPct: number | null;
  source: "daily" | "weekly" | null;
  acceptDays?: number;
  acceptSessions?: number;
  minClosePct?: number;
  retest?: boolean;
  vol?: { pct: number; accel: number | null; preDry: number | null; udr50: number | null; dirVol20: number | null; score: number; weakClose: boolean };
}

export interface BaseFeatures {
  weeks: number;
  baseStart: string;
  baseHigh: number;
  baseLow: number;
  depthPct: number;
  rangePos: number;
  priorImpulsePct: number;
  giveback: number;
  rangeContraction: number | null;
  atrContraction: number | null;
  atrPctile: number | null;
  pullbacks: number[];
  contractingFrac: number | null;
  medianDepthRatio: number | null;
  finalContractionPct: number;
  finalContractionAtr: number;
  tightClosesAtr: number;
  threeWeeksTight: boolean;
  dryUp: number | null;
  downUpVol: number | null;
  pivot: number;
  pivotContacts: number;
  support: number;
  stopRiskPct: number;
  latestClose: number;
  latestDate: string;
  distToPivotPct: number;
  aboveSma10: boolean;
  aboveSma30: boolean;
  aboveSma40: boolean;
  sma10Above30: boolean;
  sma30Slope8Pct: number;
  pctFrom52wHigh: number;
  pctAbove52wLow: number;
  rsSlope13: number | null;
  rsHighDistPct: number | null;
  r26Pct: number | null;
  ext10wPct: number;
  ext30wPct: number;
  supportHolding: boolean;
  dollarVolM: number | null;
  baseCount: number;
  baseCountCapped: boolean;
  baseNumber?: number;
  labels: BaseLabel[];
  trigger: BaseTrigger;
  stageNow?: number | null;
  dataNote: string | null;
  gateFails?: string[];
  daily?: { dryUp5: number; tightRank: number; pullbacks: number[]; covered: boolean; sessions: number; contracting?: boolean; vcpFromDaily?: boolean; udr50?: number | null; dirVol20?: number | null } | null;
  earn?: EarnInfo | null;
  chart?: { c: number[]; h: number[]; l: number[]; ma: (number | null)[]; from: number; end: string };
  gatesOk: boolean;
}

export interface EarnInfo {
  date: string; day0: string; sessionsAgo: number; epsActual: number | null; epsEstimate: number | null;
  surprisePx: number | null; revSurprisePct: number | null; ear: number; gap: number | null; volX: number | null; drift: number | null;
  label: "beat_bought" | "beat_sold" | "beat_flat" | "miss_bought" | "miss_sold" | "reaction_up" | "reaction_down" | "inline";
  fuel?: number; earPct?: number; surprisePct?: number;
}

export const EARN_LABELS: Record<EarnInfo["label"], { text: string; tone: "good" | "bad" | "flat" }> = {
  beat_bought: { text: "Beat & bought", tone: "good" },
  miss_bought: { text: "Missed, still bought", tone: "good" },
  reaction_up: { text: "Bought on earnings", tone: "good" },
  beat_flat: { text: "Beat, no reaction", tone: "flat" },
  inline: { text: "In line", tone: "flat" },
  beat_sold: { text: "Beat but sold", tone: "bad" },
  miss_sold: { text: "Missed & sold", tone: "bad" },
  reaction_down: { text: "Sold on earnings", tone: "bad" },
};

export interface Breakdown {
  trend: number; rs: number; geometry: number; contraction: number; volume: number; pivotRisk: number; market: number;
}

export interface StockBase {
  symbol: string;
  score: number | null;
  band: "prime" | "qualified" | "developing" | "research" | null;
  state: BaseState | null;
  primary_label: BaseLabel | null;
  labels: BaseLabel[] | null;
  tier: number | null;
  rs_pct: number | null;
  pivot: number | null;
  support: number | null;
  dist_to_pivot: number | null;
  stop_risk: number | null;
  features: BaseFeatures;
  breakdown: Breakdown | null;
  warnings: string[] | null;
  earnings_date: string | null;
  as_of: string;
  updated_at: string;
}

export const BREAKDOWN_PARTS: { key: keyof Breakdown; label: string; max: number }[] = [
  { key: "trend", label: "Trend & prior move", max: 20 },
  { key: "rs", label: "Relative strength", max: 15 },
  { key: "geometry", label: "Shape & repair", max: 20 },
  { key: "contraction", label: "Tightening", max: 20 },
  { key: "volume", label: "Volume / accumulation", max: 10 },
  { key: "pivotRisk", label: "Pivot & risk", max: 10 },
  { key: "market", label: "Market", max: 5 },
];

/** Manual chart checks from the research, per pattern (shown in the detail panel). */
export const CHART_CHECKS: Record<BaseLabel, string[]> = {
  ipo: [
    "Did the stock hold most of its post-listing run, or is the 'base' really a fading IPO pop?",
    "Is the lock-up expiry (usually ~6 months after listing) still ahead? It can flood supply.",
    "Is there real volume and institutional sponsorship, not a thin float swinging on a few trades?",
    "Is the right side quieter than the left, with the pivot at the post-listing high?",
    "Is there an earnings report soon? Young companies gap hard on their first few.",
  ],
  vcp: [
    "Do the contractions look like natural waves, not noise the swing detector created?",
    "Are lows holding higher (apart from an intentional shakeout)?",
    "Is the right side quieter, with fewer wide down bars than the left?",
    "Is the pivot a real level, not one isolated wick?",
    "Is volume drying up while price holds high — not because price is sagging?",
    "Is the final contraction tight enough for a logical stop?",
    "Is an earnings report likely to turn it into a gap trade?",
  ],
  flat: [
    "Is the base really flat, or slowly deteriorating below a falling average?",
    "Are the weekly closes tight even if the intraweek ranges are wider?",
    "Is support repeatedly defended?",
    "Did several failed breakouts create overhead supply?",
    "Did the stock advance enough before the shelf to make this a continuation?",
    "Is it a healthy Stage 2 pause or a late stall after a long run?",
  ],
  cup: [
    "Does the cup look like a real repair, not a sharp V-shaped rebound?",
    "Is the depth reasonable for the market correction and the stock's volatility?",
    "Are there repeated heavy distribution weeks on either side?",
    "Is the handle clearly in the upper half and shallower than the cup?",
    "Does the handle drift down or tighten — not wedge up into resistance?",
    "Is this an early-stage cup or a late one after a long run?",
  ],
  double_bottom: [
    "Is the middle rally significant, or are the two lows just neighbouring noise?",
    "Did the second low shake out the first and reclaim it — or is support failing?",
    "How did the second-low week close relative to its range?",
    "If second-low volume is high, does the strong close suggest absorption?",
    "Is the right side tighter and stronger than the left, with improving RS?",
    "Is the middle-peak pivot obvious and free of prior failed breakouts?",
  ],
  ascending: [
    "Are there three distinct, market-linked pullbacks — not arbitrary minor swings?",
    "Did the stock stay resilient while the market corrected?",
    "Is the ascent orderly, or turning into a parabolic rising wedge?",
    "Is it finding support near the 10-week average?",
    "Is it so extended that a normal pullback would exceed your risk budget?",
  ],
  htf: [
    "Was the burst driven by a durable catalyst and broad sponsorship — not a low-float squeeze?",
    "Is it liquid enough for your size under stress?",
    "Does the flag look calm relative to the impulse?",
    "Are offerings, lockups or binary events likely?",
    "Is one gap responsible for nearly the whole move?",
    "Can you cut position size enough for its normal volatility?",
  ],
  box: [
    "Are the top and bottom of the box clean, repeated levels?",
    "Is the box narrow enough for your risk budget?",
    "Is the longer trend still up (rising 30-week average) and RS firm?",
  ],
  generic: [
    "Is this a real continuation base, or a weak stock drifting sideways after a decline?",
    "Is resistance meaningful and nearby support logical?",
    "Do high-volume bars show demand, absorption, distribution or churn?",
    "Is RS improving for a real reason, not just because the market is falling faster?",
    "Are earnings, offerings or other binary events imminent?",
    "Does the chart look clean on both weekly and daily?",
  ],
};

const CACHE_KEY = "stock_bases_v1";
const CACHE_TTL = 6 * 60 * 60 * 1000;

/** All base rows (cached in the browser; cleared after every scan — see stageAnalysis.runStageScan). */
let loadBasesInflight: Promise<StockBase[]> | null = null;
/** Concurrent callers (several hooks reloading after a scan) share one network load. */
export function loadBases(force = false): Promise<StockBase[]> {
  if (loadBasesInflight) return loadBasesInflight;
  const p = loadBasesImpl(force);
  loadBasesInflight = p;
  p.finally(() => { if (loadBasesInflight === p) loadBasesInflight = null; }).catch(() => { /* handled by the caller */ });
  return p;
}

async function loadBasesImpl(force: boolean): Promise<StockBase[]> {
  if (!force) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { ts: number; rows: StockBase[] };
        if (Date.now() - p.ts < CACHE_TTL && Array.isArray(p.rows)) return p.rows;
      }
    } catch { /* ignore */ }
  }
  const rows: StockBase[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as SupabaseClient)
      .from("stock_bases")
      .select("*")
      .not("score", "is", null)
      .order("score", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as unknown as StockBase[]));
    if (data.length < 1000) break;
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows })); } catch { /* quota */ }
  return rows;
}

export function clearBasesCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** Strict preset (research "strict" columns) applied on top of the balanced results. */
export function passesStrict(b: StockBase): boolean {
  const f = b.features;
  const triggered = b.state === "triggered" || b.state === "extended";
  return (b.rs_pct ?? 0) >= 90 &&
    f.pctFrom52wHigh >= -15 &&
    f.rangePos >= 0.85 &&
    (triggered || (b.dist_to_pivot ?? 99) <= 5) &&
    (b.stop_risk ?? 99) <= 8 &&
    (f.dryUp === null || f.dryUp <= 0.8);
}

/** Tightening grade from the contraction component (0–20). */
export function tighteningGrade(b: StockBase): "A" | "B" | "C" | "D" {
  const c = b.breakdown?.contraction ?? 0;
  return c >= 16 ? "A" : c >= 12 ? "B" : c >= 8 ? "C" : "D";
}

// ── Base filter shared by list builders ──────────────────────────
export interface BaseFilter {
  minScore: number;           // 0 = off
  label: BaseLabel | "any";
  state: "any" | "ready" | "ready_triggered" | "not_failed";
}
export const DEFAULT_BASE_FILTER: BaseFilter = { minScore: 0, label: "any", state: "any" };

export const isBaseFilterActive = (f: BaseFilter | undefined) =>
  !!f && (f.minScore > 0 || f.label !== "any" || f.state !== "any");

export function passesBaseFilter(b: StockBase | undefined, f: BaseFilter): boolean {
  if (!isBaseFilterActive(f)) return true;
  if (!b || b.score === null) return false;          // no qualifying base → excluded when active
  if (b.score < f.minScore) return false;
  if (f.label !== "any" && !(b.labels ?? []).includes(f.label)) return false;
  switch (f.state) {
    case "ready": return b.state === "ready";
    case "ready_triggered": return b.state === "ready" || b.state === "triggered";
    case "not_failed": return b.state !== "failed";
    default: return true;
  }
}
