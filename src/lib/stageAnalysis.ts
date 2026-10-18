import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearBasesCache } from "@/lib/bases";

// Client side of Weinstein Stage Analysis (see supabase/functions/stage-scan
// and _shared/stageEngine.ts). The engine runs on the server; this file runs
// scans, loads results and holds the shared display helpers.

export type StageNum = 0 | 1 | 2 | 3 | 4; // 0 = transition / uncertain

export interface StageFeatures {
  close: number;
  ma30: number;
  maSlope5Pct: number;
  closeVsMaAtr: number;
  aboveFrac10: number;
  rvol4AtEvent: number | null;
  rpSlope13: number | null;
  mrs52: number | null;
  pctFrom52wHigh: number;
  rangeHigh?: number | null;
  rangeLow?: number | null;
  pctToRangeHigh?: number | null;
  rangeWeeks?: number | null;
  r26Pct?: number | null;   // 26-week return (%)
  ytdPct?: number | null;   // since the last weekly close of the previous year (%)
  /** breadth flags per week, base-32 (bit0 >10w MA, bit1 >40w MA, bit2 new 52w high, bit3 new 52w low, bit4 10w>40w) */
  flags?: string;
  /** Minervini Trend Template — 7 price rules on weekly proxies (the RS ≥ 70 rule is applied in the app) */
  tt?: { pass: boolean; count: number; failed: string[] } | null;
}

export interface StockStage {
  symbol: string;
  stage: StageNum;
  substage: string;
  confidence: number;
  quality: "HIGH" | "MIXED" | "LOW" | null;
  event: string | null;
  event_kind: string | null;
  event_weeks_ago: number | null;
  weeks_in_stage: number | null;
  history: string | null;
  features: StageFeatures | null;
  reasons: string[] | null;
  as_of: string;
  updated_at: string;
}

export const STAGE_COLORS: Record<StageNum, string> = {
  0: "hsl(220, 9%, 32%)",
  1: "hsl(220, 9%, 46%)",
  2: "hsl(222, 82%, 64%)",
  3: "hsl(47, 66%, 50%)",
  4: "hsl(329, 70%, 60%)",
};

export const STAGE_NAMES: Record<StageNum, string> = {
  0: "In transition",
  1: "Stage 1 · Basing",
  2: "Stage 2 · Advancing",
  3: "Stage 3 · Topping",
  4: "Stage 4 · Declining",
};

export const STAGE_TIPS: Record<StageNum, string> = {
  0: "Signals conflict — the engine does not force the stock into a stage (as the research recommends).",
  1: "After a decline, price moves sideways around a flattening 30-week MA. Watch — avoid tying up capital before the breakout.",
  2: "Price above a rising 30-week MA with higher highs / higher lows. Preferred long regime; 2A = fresh breakout (best entries), 2B = mature / late.",
  3: "After an advance, price chops around a flattening 30-week MA, often on heavy volume. Reduce / tighten risk; don't start new longs.",
  4: "Price below a falling 30-week MA with lower highs / lower lows. Avoid / exit longs. 4B− = first bounce off a low — often a bear-market rally, not a buy.",
};

export const SUBSTAGE_TIPS: Record<string, string> = {
  "1A": "Early base: within ~13 weeks of leaving Stage 4, MA still falling but improving.",
  "1": "Base: flat MA, price ranging around it.",
  "1B": "Late base: top of the range, volatility contracting, relative strength improving — watch for the breakout.",
  "2A": "Fresh breakout (last 13 weeks) above the base with price over a non-declining MA — the classic Weinstein entry zone.",
  "2": "Established advance above a rising MA.",
  "2B": "Mature advance: MA slope slowing, MA tests, RS divergence or very extended.",
  "3A": "Early top: first weeks of chop around a flattening MA after Stage 2.",
  "3": "Established top: flat MA and a sideways range after Stage 2.",
  "3B": "Late top: below the MA, lower highs, weak relative strength.",
  "4A": "Fresh breakdown (last 13 weeks) below support and a non-rising MA.",
  "4": "Mature decline below a falling MA.",
  "4B": "Late decline: slope easing, relative strength improving or no new low — still too early to buy.",
  "4B-": "First bounce: no new low for 8+ weeks and back above the 10-week MA. In this app's 2023–26 backtest it had the weakest follow-through of all substages (often a bear-market rally) — wait for a Stage 1 base and a Stage 2 breakout.",
  "T": "Conflicting signals — no stage assigned yet.",
};

const CACHE_KEY = "stock_stages_v1";
const CACHE_TTL = 6 * 60 * 60 * 1000;
const EVENT = "stock-stages-updated";

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("stage-scan", { body });
  if (error) throw new Error(error.message ?? String(error));
  const d = data as { ok?: boolean; error?: string; setupNeeded?: boolean };
  if (d && d.ok === false) throw new Error(d.setupNeeded ? "Stage Analysis isn't set up on the server yet." : d.error ?? "Stage scan failed");
  return data as T;
}

/** All stage rows (cached in the browser; cleared after every scan). */
let loadStagesInflight: Promise<StockStage[]> | null = null;
/** Concurrent callers (several hooks reloading after a scan) share one network load. */
export function loadStages(force = false): Promise<StockStage[]> {
  if (loadStagesInflight) return loadStagesInflight;
  const p = loadStagesImpl(force);
  loadStagesInflight = p;
  p.finally(() => { if (loadStagesInflight === p) loadStagesInflight = null; }).catch(() => { /* handled by the caller */ });
  return p;
}

async function loadStagesImpl(force: boolean): Promise<StockStage[]> {
  if (!force) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { ts: number; rows: StockStage[] };
        if (Date.now() - p.ts < CACHE_TTL && Array.isArray(p.rows)) return p.rows;
      }
    } catch { /* ignore */ }
  }
  const rows: StockStage[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as SupabaseClient)
      .from("stock_stages")
      .select("symbol, stage, substage, confidence, quality, event, event_kind, event_weeks_ago, weeks_in_stage, history, features, reasons, as_of, updated_at")
      .order("symbol")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as unknown as StockStage[]));
    if (data.length < 1000) break;
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows })); } catch { /* quota */ }
  return rows;
}

export function onStagesUpdated(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

let running: Promise<{ processed: number; failed: number }> | null = null;
export const isStageScanRunning = () => running !== null;

/**
 * Classify the whole stock list. Calls `onProgress(done, total)` as chunks finish.
 * Only one scan runs at a time (a second caller gets the same promise).
 */
export function runStageScan(onProgress?: (done: number, total: number) => void): Promise<{ processed: number; failed: number }> {
  if (running) return running;
  running = (async () => {
    const { symbols, serverTime } = await invoke<{ symbols: string[]; serverTime: string }>({ action: "symbols" });
    const startedAt = serverTime; // server clock — see stage-scan "symbols"
    // Benchmark first so the market stage is computed once.
    const list = ["SPY", ...symbols.filter((s) => s !== "SPY")];
    const CHUNK = 60;
    let done = 0, processed = 0, failed = 0;
    onProgress?.(0, list.length);
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
    // two chunks in flight
    let next = 0;
    const lane = async () => {
      while (next < chunks.length) {
        const ch = chunks[next++];
        try {
          const r = await invoke<{ processed: number; failed: string[] }>({ action: "chunk", symbols: ch });
          processed += r.processed; failed += r.failed.length;
        } catch (e) {
          failed += ch.length;
          console.warn("stage chunk failed", e);
        }
        done += ch.length;
        onProgress?.(done, list.length);
      }
    };
    await Promise.all([lane(), lane()]);
    // Finalize: base scores (RS percentiles, earnings) always; pruning of stocks that left
    // the list only after a clearly successful scan.
    if (processed > 0) {
      try {
        await invoke({ action: "finalize", startedAt, prune: processed >= list.length * 0.8 });
      } catch (e) {
        console.warn("stage finalize failed", e);
      }
    }
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    clearBasesCache();
    window.dispatchEvent(new Event(EVENT));
    return { processed, failed };
  })().finally(() => { running = null; });
  return running;
}

/** Health label for a group (see the Stage Analysis page legend). */
export function groupHealth(s2Pct: number, s4Pct: number): { label: string; tone: "strong" | "healthy" | "neutral" | "weak" } {
  if (s4Pct >= 50) return { label: "Weak", tone: "weak" };
  if (s2Pct >= 50) return { label: "Strong", tone: "strong" };
  if (s2Pct >= 35) return { label: "Healthy", tone: "healthy" };
  return { label: "Neutral", tone: "neutral" };
}

/** Stage N weeks ago from the history string (null if unknown). */
// ── Market regime (breadth) ─────────────────────────────────────
export type RegimeColor = "green" | "yellow" | "red";
export interface RegimeWeek { p50: number; p200: number; hl: number; spyUp: boolean | null; color: RegimeColor; n: number }

const flagBits = (ch: string | undefined) => (ch ? parseInt(ch, 32) : NaN);

/**
 * Weekly market regime from every stock's breadth flags (aligned rows only, newest last).
 * Thresholds follow the breadth research (StockCharts conventions; composite in the style of
 * the "% above 50/200-day MA + new highs vs lows + index trend" gate):
 *   green  = SPY above a rising-aligned 40w MA, ≥ 50% above the 40w (≈200-day), ≥ 60% above the
 *            10w (≈50-day) and High–Low index ≥ 55
 *   red    = < 40% above both MAs, or High–Low index < 40 and falling
 *   yellow = everything else
 */
export function regimeSeries(rows: StockStage[]): RegimeWeek[] {
  const stocks = rows.filter((r) => r.symbol !== "SPY" && r.features?.flags);
  const spy = rows.find((r) => r.symbol === "SPY")?.features?.flags ?? "";
  const len = Math.max(0, ...stocks.map((r) => r.features!.flags!.length));
  const raw: Omit<RegimeWeek, "color" | "hl">[] = [];
  const rh: number[] = [];
  for (let ago = len - 1; ago >= 0; ago--) {
    let n = 0, a10 = 0, a40 = 0, nh = 0, nl = 0;
    for (const r of stocks) {
      const f = r.features!.flags!;
      const b = flagBits(f[f.length - 1 - ago]);
      if (!Number.isFinite(b)) continue;
      n++;
      if (b & 1) a10++;
      if (b & 2) a40++;
      if (b & 4) nh++;
      if (b & 8) nl++;
    }
    const sb = flagBits(spy[spy.length - 1 - ago]);
    raw.push({ p50: n ? (a10 / n) * 100 : 0, p200: n ? (a40 / n) * 100 : 0, spyUp: Number.isFinite(sb) ? (sb & 2) !== 0 && (sb & 16) !== 0 : null, n });
    rh.push(nh + nl ? (nh / (nh + nl)) * 100 : 50);
  }
  // High–Low index: record-high percent smoothed over 2 weeks (≈ the 10-day convention)
  return raw.map((w, k) => {
    const hl = k > 0 ? (rh[k] + rh[k - 1]) / 2 : rh[k];
    const hlPrev = k > 2 ? (rh[k - 2] + rh[k - 3]) / 2 : hl;
    let color: RegimeColor = "yellow";
    if ((w.p200 < 40 && w.p50 < 40) || (hl < 40 && hl < hlPrev)) color = "red";
    else if (w.spyUp !== false && w.p200 >= 50 && w.p50 >= 60 && hl >= 55) color = "green";
    return { ...w, hl, color };
  });
}

export const REGIME_TEXT: Record<RegimeColor, { label: string; tip: string }> = {
  green: { label: "Breakout-friendly", tip: "Broad participation and a rising market: take qualified breakouts at normal size." },
  yellow: { label: "Selective", tip: "Mixed breadth: smaller size, only the strongest setups, prefer tight early entries." },
  red: { label: "Hostile", tip: "Most stocks below their trend: avoid routine breakouts; wait for breadth to repair (a follow-through day or breadth thrust plus improving breadth)." },
};

export function stageWeeksAgo(r: StockStage, weeks: number): StageNum | null {
  const h = r.history ?? "";
  const ch = h[h.length - 1 - weeks];
  if (!ch) return null;
  return ch === "T" ? 0 : (Number(ch) as StageNum);
}

export interface StageChartData { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; ma: (number | null)[] }
const chartCache = new Map<string, Promise<StageChartData>>();
/** Weekly bars for one stock's chart (fetched on demand by the stage-scan function; memoised per session). */
export function loadStageChart(symbol: string): Promise<StageChartData> {
  const key = symbol.toUpperCase();
  let p = chartCache.get(key);
  if (!p) {
    p = invoke<StageChartData>({ action: "chart", symbol: key });
    p.catch(() => chartCache.delete(key));
    chartCache.set(key, p);
  }
  return p;
}

/** One ticker per line — the format TradingView's "Import list" accepts. */
export function downloadTradingViewList(symbols: string[], name: string) {
  const blob = new Blob([symbols.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Stage filter shared by lists across the app ──────────────────
export type StageFilterMode =
  | "any" | "s2" | "s2a" | "s2_or_1b" | "tt" | "exclude_34" | "s1" | "s3" | "s4" | "s4bminus";

export const STAGE_FILTER_OPTIONS: { value: StageFilterMode; label: string }[] = [
  { value: "any", label: "Any stage" },
  { value: "s2", label: "Only Stage 2" },
  { value: "s2a", label: "Only 2A (fresh breakouts)" },
  { value: "s2_or_1b", label: "Stage 2 or 1B (early strength)" },
  { value: "tt", label: "Minervini Trend Template (7 price rules)" },
  { value: "exclude_34", label: "Exclude Stage 3 & 4" },
  { value: "s1", label: "Only Stage 1" },
  { value: "s3", label: "Only Stage 3" },
  { value: "s4", label: "Only Stage 4" },
  { value: "s4bminus", label: "Only 4B− (first bounce off a low)" },
];

export function passesStageFilter(r: StockStage | undefined, mode: StageFilterMode, minConfidence = 0): boolean {
  if (mode === "any" && minConfidence <= 0) return true;
  if (!r) return false; // not classified → excluded when a stage filter is active
  if (r.confidence < minConfidence) return false;
  switch (mode) {
    case "any": return true;
    case "s2": return r.stage === 2;
    case "s2a": return r.substage === "2A";
    case "s2_or_1b": return r.stage === 2 || r.substage === "1B";
    case "tt": return !!r.features?.tt?.pass;
    case "exclude_34": return r.stage !== 3 && r.stage !== 4;
    case "s1": return r.stage === 1;
    case "s3": return r.stage === 3;
    case "s4": return r.stage === 4;
    case "s4bminus": return r.substage === "4B-";
  }
}
