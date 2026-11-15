import { createContext, useSyncExternalStore } from "react";
import { loadStages, onStagesUpdated, stageWeeksAgo, STAGE_COLORS, type StageNum, type StockStage } from "@/lib/stageAnalysis";
import { loadUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";

/**
 * The Weinstein stage of a whole group (industry / sub-industry / sector), from EVERY stock of that
 * group in the universe — not just the stocks a list happens to show — so one industry carries the
 * same label on every screen. Same rows as the Stages tab ("Your list" scope, latest week only).
 *
 *   S1 … S4  ≥ 50% of the group's classified stocks are in that stage
 *   S1→2     Stage 1 + 2 dominate and the Stage 2 share grew ≥ 10 pts in 4 weeks (or S1 with S2 surging)
 *   S2→3     Stage 2 + 3 dominate and Stage 2 shrank ≥ 10 pts (or S2 still on top but down ≥ 15 pts)
 *   S3→4, S4→1  the same idea further round the cycle
 *   mixed    nothing dominates
 *   (none)   fewer than 5 classified stocks — too few to call
 */

export type GroupStageLabel = "S1" | "S2" | "S3" | "S4" | "S1→2" | "S2→3" | "S3→4" | "S4→1" | "mixed";

export interface GroupStage {
  name: string;
  label: GroupStageLabel;
  /** stage whose color the label takes (the destination for a transition; 0 = mixed) */
  tone: StageNum;
  n: number;
  counts: Record<1 | 2 | 3 | 4, number>;
  /** share (%) per stage now and 4 weeks ago */
  now: Record<1 | 2 | 3 | 4, number>;
  then: Record<1 | 2 | 3 | 4, number> | null;
  tip: string;
}

const MIN_STOCKS = 5;
const MODES: Exclude<GroupMode, "theme">[] = ["industry", "subIndustry", "sector"];

function judge(now: Record<1 | 2 | 3 | 4, number>, then: Record<1 | 2 | 3 | 4, number> | null): { label: GroupStageLabel; tone: StageNum } {
  const d = (s: 1 | 2 | 3 | 4) => (then ? now[s] - then[s] : 0);
  if (now[2] >= 50) return d(2) <= -15 ? { label: "S2→3", tone: 3 } : { label: "S2", tone: 2 };
  if (now[1] >= 50) return d(2) >= 15 ? { label: "S1→2", tone: 2 } : { label: "S1", tone: 1 };
  if (now[3] >= 50) return { label: "S3", tone: 3 };
  if (now[4] >= 50) return { label: "S4", tone: 4 };
  if (now[1] + now[2] >= 60 && d(2) >= 10) return { label: "S1→2", tone: 2 };
  if (now[2] + now[3] >= 60 && (d(2) <= -10 || d(3) >= 10)) return { label: "S2→3", tone: 3 };
  if (now[3] + now[4] >= 60 && d(4) >= 10) return { label: "S3→4", tone: 4 };
  if (now[4] + now[1] >= 60 && d(1) >= 10) return { label: "S4→1", tone: 1 };
  return { label: "mixed", tone: 0 };
}

const LABEL_WORDS: Record<GroupStageLabel, string> = {
  S1: "mostly basing (Stage 1)", S2: "mostly advancing (Stage 2)", S3: "mostly topping (Stage 3)", S4: "mostly declining (Stage 4)",
  "S1→2": "moving from bases into Stage 2", "S2→3": "Stage 2 is fading into tops (Stage 3)", "S3→4": "tops are breaking down (Stage 4)",
  "S4→1": "declines are turning into bases (Stage 1)", mixed: "no stage dominates",
};

export function computeGroupStages(rows: StockStage[], labelBySymbol: Map<string, string | null>, mode: Exclude<GroupMode, "theme">): Map<string, GroupStage> {
  const stocks = rows.filter((r) => r.symbol !== "SPY");
  const asOf = stocks.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
  const acc = new Map<string, { now: number[]; then: number[]; nThen: number }>();
  for (const r of stocks) {
    if (r.as_of !== asOf || !labelBySymbol.has(r.symbol.toUpperCase())) continue;
    const g = groupKeyForIndustry(labelBySymbol.get(r.symbol.toUpperCase()) ?? null, mode);
    if (!g || g.startsWith("Other") || g === "Unknown" || g === "Unclassified") continue;
    const a = acc.get(g) ?? { now: [0, 0, 0, 0, 0], then: [0, 0, 0, 0, 0], nThen: 0 };
    if (r.stage >= 1) a.now[r.stage]++;
    const t = stageWeeksAgo(r, 4);
    if (t !== null && t >= 1) { a.then[t]++; a.nThen++; }
    acc.set(g, a);
  }
  const out = new Map<string, GroupStage>();
  for (const [name, a] of acc) {
    const n = a.now[1] + a.now[2] + a.now[3] + a.now[4];
    if (n < MIN_STOCKS) continue;
    const pct = (arr: number[], tot: number) => ({ 1: (arr[1] / tot) * 100, 2: (arr[2] / tot) * 100, 3: (arr[3] / tot) * 100, 4: (arr[4] / tot) * 100 });
    const now = pct(a.now, n);
    const then = a.nThen >= MIN_STOCKS ? pct(a.then, a.nThen) : null;
    const { label, tone } = judge(now, then);
    const top = ([1, 2, 3, 4] as const).reduce((b, s) => (a.now[s] > a.now[b] ? s : b), 2 as 1 | 2 | 3 | 4);
    const tip = `${name}: ${LABEL_WORDS[label]}. ${a.now[top]} of ${n} stocks in Stage ${top} · `
      + ([1, 2, 3, 4] as const).map((s) => `S${s} ${Math.round(now[s])}%`).join(" · ")
      + (then ? `. Stage 2 share 4 weeks ago: ${Math.round(then[2])}% (now ${Math.round(now[2])}%).` : ".")
      + " Counted over every stock of the group in your universe.";
    out.set(name, { name, label, tone, n, counts: { 1: a.now[1], 2: a.now[2], 3: a.now[3], 4: a.now[4] }, now, then, tip });
  }
  return out;
}

// ── Shared store: loaded once on first use, recomputed after every stage scan ──────────────────
let maps: Record<Exclude<GroupMode, "theme">, Map<string, GroupStage>> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
let version = 0;

async function build(force: boolean) {
  const [rows, uni] = await Promise.all([loadStages(force), loadUniverseSectors()]);
  const labels = new Map<string, string | null>();
  for (const r of uni.extra) labels.set(r.symbol.toUpperCase(), r.sector);
  for (const r of uni.rows) labels.set(r.symbol.toUpperCase(), r.sector);
  maps = { industry: computeGroupStages(rows, labels, "industry"), subIndustry: computeGroupStages(rows, labels, "subIndustry"), sector: computeGroupStages(rows, labels, "sector") };
  version++;
  listeners.forEach((l) => l());
}

let subscribed = false;
export function ensureGroupStages(): void {
  if (maps || loading) return;
  loading = build(false).catch((e) => console.warn("group stages failed", e)).finally(() => { loading = null; });
  if (!subscribed) {
    subscribed = true;
    onStagesUpdated(() => { loading = build(true).catch(() => undefined).finally(() => { loading = null; }); });
  }
}

export function subscribeGroupStages(cb: () => void): () => void {
  listeners.add(cb);
  ensureGroupStages();
  return () => { listeners.delete(cb); };
}
export const groupStagesVersion = () => version;

/** Stage of a group by name. `mode` picks the taxonomy; without it industry → sub-industry → sector. */
export function groupStageOf(name: string | null | undefined, mode?: GroupMode): GroupStage | null {
  if (!name || !maps) return null;
  if (mode === "theme") return null;
  const key = name.trim();
  if (mode) return maps[mode].get(key) ?? null;
  for (const m of MODES) { const g = maps[m].get(key); if (g) return g; }
  return null;
}

export const groupStageColor = (g: GroupStage) => STAGE_COLORS[g.tone];

/** "Semiconductors - S2" for TradingView exports: plain ASCII ("S1>2"), and the name is shortened
 *  so the stage survives TradingView's 40-character section limit. Unchanged when the stage isn't known. */
export function withGroupStage(name: string, mode?: GroupMode, max = 40): string {
  ensureGroupStages(); // first export on a screen without tags starts the load
  const g = groupStageOf(name, mode);
  if (!g) return name;
  const suffix = ` - ${g.label.replace("→", ">")}`;
  const room = max - suffix.length;
  const base = name.length > room ? name.slice(0, room).replace(/[\s&|,-]+$/, "") : name;
  return `${base}${suffix}`;
}

/** Re-renders when the group stages load or change (after a stage scan). */
export function useGroupStagesVersion() {
  return useSyncExternalStore(subscribeGroupStages, groupStagesVersion, groupStagesVersion);
}

/** Which taxonomy the names on screen belong to (the dashboard's group mode). "theme" hides the
 *  tags; undefined = look the name up as industry → sub-industry → sector. */
export const GroupStageModeContext = createContext<GroupMode | undefined>(undefined);
