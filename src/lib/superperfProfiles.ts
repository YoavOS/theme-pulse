/**
 * Every profile the Superperformance list can filter on, in one place.
 *
 *  - "fundamental" profiles come from earnings reports and are stored per stock by the scan
 *    (the four classic checklists in their own columns, the evidence-based ones in profile_scores).
 *  - "price" profiles are computed live in the browser from data the app already has
 *    (the weekly Stages scan + its daily snapshot, and the RS ratings), so they need no scan
 *    and are never stale.
 */
import type { StockStage } from "@/lib/stageAnalysis";

export type ProfileSource = "fundamental" | "price";
export type ProfileKey =
  | "current" | "minervini" | "oneil" | "ryan"
  | "momentum" | "growth" | "margins" | "cash" | "quality" | "turnaround"
  | "st_momentum" | "setup";

export interface ProfileDef {
  key: ProfileKey;
  label: string;
  short: string;
  source: ProfileSource;
  /** Where the score lives on a saved row (fundamental profiles only). */
  column?: "current_score" | "minervini_score" | "oneil_score" | "ryan_score";
  help: string;
  defaultThreshold: number;
}

export const PROFILES: ProfileDef[] = [
  { key: "current", label: "Current", short: "Current", source: "fundamental", column: "current_score", defaultThreshold: 80,
    help: "Growth right now: the last few quarters' earnings and sales." },
  { key: "minervini", label: "Minervini", short: "Minervini", source: "fundamental", column: "minervini_score", defaultThreshold: 80,
    help: "Mark Minervini's SEPA fundamentals: accelerating earnings and sales, margins, ROE." },
  { key: "oneil", label: "O'Neil", short: "O'Neil", source: "fundamental", column: "oneil_score", defaultThreshold: 80,
    help: "William O'Neil's CAN SLIM: current-quarter and annual earnings growth." },
  { key: "ryan", label: "Ryan", short: "Ryan", source: "fundamental", column: "ryan_score", defaultThreshold: 65,
    help: "David Ryan's strict checklist. It rarely scores above 75, so its default bar is lower." },
  { key: "momentum", label: "Earnings momentum", short: "Earn. mom.", source: "fundamental", defaultThreshold: 70,
    help: "Is earning power rising? EPS vs a year ago, earnings surprise, operating leverage, estimate revisions." },
  { key: "growth", label: "Sales acceleration", short: "Sales accel.", source: "fundamental", defaultThreshold: 70,
    help: "Is sales growth speeding up? Quarterly sales growth vs the last two quarters." },
  { key: "margins", label: "Margin expansion", short: "Margins", source: "fundamental", defaultThreshold: 70,
    help: "Are gross and operating margins widening vs a year ago?" },
  { key: "cash", label: "Cash flow", short: "Cash", source: "fundamental", defaultThreshold: 70,
    help: "Is the cash real and growing? Operating and free cash flow vs the year before." },
  { key: "quality", label: "Quality", short: "Quality", source: "fundamental", defaultThreshold: 70,
    help: "How well does the business hold up? Profitability, Piotroski score, cash conversion, dilution." },
  { key: "turnaround", label: "Turnaround", short: "Turnaround", source: "fundamental", defaultThreshold: 70,
    help: "A business coming back from losses or a margin collapse. Only scored when there was something to turn around." },
  { key: "st_momentum", label: "Short-term momentum", short: "ST mom.", source: "price", defaultThreshold: 75,
    help: "Price strength over the last 1–4 weeks: return vs the market, RS rating, near the 52-week high, above the 21-day EMA, rising volume. Live, no scan needed." },
  { key: "setup", label: "Breakout setup", short: "Setup", source: "price", defaultThreshold: 75,
    help: "Ready to break out: Stage 2, passes the trend template, tight 10-day range, close to the top of its base, volume drying up. Live, no scan needed." },
];
export const PROFILE_BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));
export const FUNDAMENTAL_KEYS = PROFILES.filter((p) => p.source === "fundamental").map((p) => p.key);

export type Thresholds = Record<ProfileKey, number>;
export const DEFAULT_THRESHOLDS = Object.fromEntries(PROFILES.map((p) => [p.key, p.defaultThreshold])) as Thresholds;

const THRESHOLDS_KEY = "superperf_thresholds_v3";
const LIST_KEY = "superperf_list_profiles_v1";

export function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY) ?? localStorage.getItem("superperf_thresholds_v2");
    return raw ? { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) } : { ...DEFAULT_THRESHOLDS };
  } catch { return { ...DEFAULT_THRESHOLDS }; }
}
export function saveThresholds(t: Thresholds) {
  try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

/** Which profiles define "a Superperformance stock", and whether it must pass any or all of them. */
export interface ListSettings { profiles: ProfileKey[]; match: "any" | "all" }
export const DEFAULT_LIST: ListSettings = { profiles: ["current", "minervini"], match: "any" };
export function loadListSettings(): ListSettings {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return { ...DEFAULT_LIST };
    const p = JSON.parse(raw) as ListSettings;
    const profiles = (p.profiles ?? []).filter((k) => PROFILE_BY_KEY.has(k));
    return { profiles: profiles.length ? profiles : DEFAULT_LIST.profiles, match: p.match === "all" ? "all" : "any" };
  } catch { return { ...DEFAULT_LIST }; }
}
export function saveListSettings(s: ListSettings) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event("superperf-settings")); } catch { /* ignore */ }
}

// ── Saved rows ────────────────────────────────────────────────────────────────

export interface SavedRow {
  symbol: string;
  current_score: number | null;
  minervini_score: number | null;
  oneil_score: number | null;
  ryan_score: number | null;
  last_scanned: string;
  profile_scores?: Partial<Record<ProfileKey, number | null>> | null;
  breakdown?: Breakdown | null;
  last_report?: string | null;
  next_report?: string | null;
}

/** Compact breakdown stored with a score: criterion label, value, and 1 / 0 / -1 for pass / neutral / fail. */
export type Breakdown = Partial<Record<ProfileKey, { s: number | null; h?: string; v?: string; n?: string; c: [string, string, number][] }>> & { err?: string };

export function savedScore(row: SavedRow | undefined, key: ProfileKey): number | null {
  if (!row) return null;
  const def = PROFILE_BY_KEY.get(key);
  if (!def || def.source !== "fundamental") return null;
  const v = def.column ? row[def.column] : row.profile_scores?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Price profiles (live) ────────────────────────────────────────────────────

export interface PriceInputs {
  stage?: StockStage | null;
  /** RS rating 1–99 (overall). */
  rsRating?: number | null;
  /** Stock return minus SPY, in % (from RS Alpha). */
  rs1w?: number | null;
  rs1m?: number | null;
  /** Relative strength made a new high in the last 20 days. */
  rsNewHigh?: boolean | null;
}

export interface PricePart { label: string; value: string; earned: number; max: number; good: boolean | null }
export interface PriceProfile { score: number | null; parts: PricePart[] }

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const pp = (label: string, max: number, earned: number, value: string, good: boolean | null): PricePart =>
  ({ label, max, earned: Math.max(0, Math.min(max, earned)), value, good });
const sgn = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

/** Score = points earned out of the points that could be tested; null when under half could be. */
function total(parts: PricePart[], fullMax = 100): PriceProfile {
  const max = parts.reduce((a, p) => a + p.max, 0);
  if (max < fullMax / 2) return { score: null, parts };
  return { score: Math.round((parts.reduce((a, p) => a + p.earned, 0) / max) * 100), parts };
}

/** Short-term momentum: what the price did over the last 1–4 weeks. */
export function shortTermMomentum(x: PriceInputs): PriceProfile {
  const f = x.stage?.features, d = f?.dly;
  const parts: PricePart[] = [];
  const r1m = fin(x.rs1m) ? x.rs1m : null;
  const r21 = fin(d?.r21Pct) ? d!.r21Pct! : null;
  if (r1m !== null) parts.push(pp("1-month return vs the market", 25, r1m >= 15 ? 25 : r1m >= 8 ? 18 : r1m >= 3 ? 11 : r1m > 0 ? 5 : 0, sgn(r1m), r1m >= 8 ? true : r1m < 0 ? false : null));
  else if (r21 !== null) parts.push(pp("21-day return", 25, r21 >= 20 ? 25 : r21 >= 10 ? 18 : r21 >= 4 ? 11 : r21 > 0 ? 5 : 0, sgn(r21), r21 >= 10 ? true : r21 < 0 ? false : null));
  if (fin(x.rs1w)) { const v = x.rs1w; parts.push(pp("Last week vs the market", 10, v >= 3 ? 10 : v > 0 ? 6 : 0, sgn(v), v > 0 ? true : v < -3 ? false : null)); }
  if (fin(x.rsRating)) { const v = x.rsRating; parts.push(pp("RS rating", 20, v >= 90 ? 20 : v >= 80 ? 14 : v >= 70 ? 8 : 0, String(v), v >= 85 ? true : v < 60 ? false : null)); }
  if (fin(f?.pctFrom52wHigh)) { const v = Math.abs(f!.pctFrom52wHigh); parts.push(pp("Distance from the 52-week high", 15, v <= 5 ? 15 : v <= 10 ? 10 : v <= 15 ? 5 : 0, `${v.toFixed(1)}% below`, v <= 8 ? true : v > 25 ? false : null)); }
  if (fin(d?.ema21Pct)) {
    const v = d!.ema21Pct, adr = fin(d?.adrPct) && d!.adrPct > 0 ? d!.adrPct : 4;
    const extended = v > adr * 3;
    parts.push(pp("Above the 21-day EMA (not stretched)", 15, v > 0 && !extended ? 15 : v > 0 ? 8 : 0, `${sgn(v)}${extended ? " (extended)" : ""}`, v > 0 && !extended ? true : v < 0 ? false : null));
  }
  if (fin(d?.vol5x50)) { const v = d!.vol5x50; parts.push(pp("Volume last week vs 50-day average", 10, v >= 1.3 ? 10 : v >= 1 ? 6 : 0, `${v.toFixed(2)}×`, v >= 1.2 ? true : null)); }
  if (x.rsNewHigh !== null && x.rsNewHigh !== undefined) parts.push(pp("RS line at a 20-day high", 5, x.rsNewHigh ? 5 : 0, x.rsNewHigh ? "yes" : "no", x.rsNewHigh ? true : null));
  return total(parts);
}

/** Breakout setup: a strong stock pausing in a tight base near its high. */
export function breakoutSetup(x: PriceInputs): PriceProfile {
  const st = x.stage, f = st?.features, d = f?.dly;
  const parts: PricePart[] = [];
  if (st) {
    // 2A (fresh breakout) and 2 score full; a mature 2B less; a late base (1B) partly.
    const sub = st.substage ?? String(st.stage);
    const pts = sub === "2A" || sub === "2" ? 20 : sub === "2B" ? 12 : sub === "1B" ? 10 : st.stage === 2 ? 16 : 0;
    parts.push(pp("Stage 2 uptrend", 20, pts, `Stage ${sub}`, pts >= 16 ? true : st.stage >= 3 ? false : null));
  }
  if (f?.tt) { const c = f.tt.count; parts.push(pp("Trend template rules passed", 15, f.tt.pass ? 15 : c >= 6 ? 10 : c >= 5 ? 5 : 0, `${c}/7`, f.tt.pass ? true : c <= 4 ? false : null)); }
  if (fin(d?.tight)) { const v = d!.tight; parts.push(pp("10-day range vs normal daily range", 20, v <= 1.5 ? 20 : v <= 2 ? 14 : v <= 2.5 ? 8 : 0, `${v.toFixed(1)}× ADR`, v <= 2 ? true : v > 3 ? false : null)); }
  const toTop = fin(f?.pctToRangeHigh) ? Math.abs(f!.pctToRangeHigh!) : fin(f?.pctFrom52wHigh) ? Math.abs(f!.pctFrom52wHigh) : null;
  if (toTop !== null) parts.push(pp(fin(f?.pctToRangeHigh) ? "Distance to the top of the base" : "Distance from the 52-week high", 20, toTop <= 3 ? 20 : toTop <= 6 ? 13 : toTop <= 10 ? 6 : 0, `${toTop.toFixed(1)}%`, toTop <= 5 ? true : toTop > 15 ? false : null));
  if (fin(d?.vol5x50)) { const v = d!.vol5x50; parts.push(pp("Volume drying up in the pause", 10, v <= 0.8 ? 10 : v <= 1 ? 6 : 0, `${v.toFixed(2)}× 50-day avg`, v <= 0.85 ? true : v > 1.5 ? null : null)); }
  if (fin(x.rsRating)) { const v = x.rsRating; parts.push(pp("RS rating", 15, v >= 85 ? 15 : v >= 75 ? 10 : v >= 65 ? 5 : 0, String(v), v >= 80 ? true : v < 60 ? false : null)); }
  return total(parts);
}

export function priceProfile(key: ProfileKey, x: PriceInputs): PriceProfile | null {
  if (key === "st_momentum") return shortTermMomentum(x);
  if (key === "setup") return breakoutSetup(x);
  return null;
}

/** Score of any profile for one stock: saved (fundamental) or live (price). */
export function scoreOf(key: ProfileKey, row: SavedRow | undefined, price: PriceInputs | null): number | null {
  const def = PROFILE_BY_KEY.get(key);
  if (!def) return null;
  if (def.source === "fundamental") return savedScore(row, key);
  return price ? priceProfile(key, price)?.score ?? null : null;
}

/** Does the stock pass the list's profiles? (Profiles without a score count as not passing.) */
export function passes(settings: ListSettings, thresholds: Thresholds, score: (k: ProfileKey) => number | null): boolean {
  if (!settings.profiles.length) return false;
  const ok = (k: ProfileKey) => { const v = score(k); return v !== null && v >= thresholds[k]; };
  return settings.match === "all" ? settings.profiles.every(ok) : settings.profiles.some(ok);
}
