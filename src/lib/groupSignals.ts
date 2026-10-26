/**
 * Small, explainable signals for a dashboard group (theme / industry / sector):
 *  - volume strength: how heavy the group's trading is vs normal
 *  - breadth read:    whether the move is carried by most stocks or by a few
 *
 * Both use the median stock, so one stock with 8× volume or +40% can't make a
 * whole group look strong on its own.
 */
import type { TickerVolume } from "@/hooks/useVolumeData";

export type VolumeBasis = "today" | "recent";

export interface VolumeStrength {
  /** Median ratio across the group's stocks (1 = normal). */
  ratio: number;
  /** Stocks with usable volume data. */
  n: number;
  /** today = today's volume vs its 20-day average; recent = 10-day average vs 3-month average. */
  basis: VolumeBasis;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** The volume comparison that fits a timeframe: a single day for Today, a 2-week trend otherwise. */
export function volumeBasisFor(timeframe: string): VolumeBasis {
  return timeframe === "Today" ? "today" : "recent";
}

export function tickerVolumeRatio(v: TickerVolume | undefined, basis: VolumeBasis): number | null {
  if (!v || v.error) return null;
  if (basis === "today") return v.avg_20d > 0 && v.today_vol > 0 ? v.today_vol / v.avg_20d : null;
  return v.avg_3m > 0 && v.avg_10d > 0 ? v.avg_10d / v.avg_3m : null;
}

export function groupVolume(
  symbols: string[],
  volumeMap: Record<string, TickerVolume> | undefined,
  timeframe: string,
): VolumeStrength | null {
  if (!volumeMap) return null;
  const basis = volumeBasisFor(timeframe);
  const ratios: number[] = [];
  for (const s of symbols) {
    const r = tickerVolumeRatio(volumeMap[s] ?? volumeMap[s.toUpperCase()], basis);
    if (r !== null) ratios.push(r);
  }
  const m = median(ratios);
  if (m === null) return null;
  return { ratio: Math.round(m * 100) / 100, n: ratios.length, basis };
}

export function volumeWords(v: VolumeStrength): string {
  const r = v.ratio;
  const level = r >= 2 ? "very heavy" : r >= 1.5 ? "heavy" : r >= 1.15 ? "above normal" : r > 0.85 ? "normal" : "light";
  return v.basis === "today"
    ? `${level} volume today (${r.toFixed(1)}× the 20-day average)`
    : `${level} volume lately (last 2 weeks at ${r.toFixed(1)}× the 3-month average)`;
}

export type BreadthKind = "broad-up" | "narrow-up" | "broad-down" | "narrow-down" | "mixed";

export interface BreadthRead {
  up: number;
  total: number;
  pctUp: number;
  /** Change of the typical (median) stock. */
  medianPct: number | null;
  /** Share of the group's total gains coming from its 2 best stocks (0–1), when the group is up. */
  topTwoShare: number | null;
  kind: BreadthKind | null;
}

export const BREADTH_LABEL: Record<BreadthKind, string> = {
  "broad-up": "Broad rally",
  "narrow-up": "Narrow: led by a few",
  "broad-down": "Broad selling",
  "narrow-down": "Narrow: a few dragging",
  mixed: "Mixed",
};

export const BREADTH_HELP: Record<BreadthKind, string> = {
  "broad-up": "Most of the group's stocks are rising, so the move has wide support.",
  "narrow-up": "The group is up, but only a few stocks are carrying it.",
  "broad-down": "Most of the group's stocks are falling.",
  "narrow-down": "The group is down because of a few stocks; most are holding up.",
  mixed: "Some stocks up, some down. No clear message.",
};

/** Groups smaller than this don't get a label: 2 of 3 stocks is not a trend. */
export const MIN_BREADTH_STOCKS = 4;

export function readBreadth(pcts: number[], groupPct: number): BreadthRead {
  const v = pcts.filter((x) => Number.isFinite(x));
  const total = v.length;
  const up = v.filter((x) => x > 0).length;
  const pctUp = total ? Math.round((up / total) * 100) : 0;
  const med = median(v);
  const gains = v.filter((x) => x > 0).sort((a, b) => b - a);
  const gainSum = gains.reduce((a, b) => a + b, 0);
  const topTwoShare = groupPct > 0 && gainSum > 0 && gains.length >= 3 ? (gains[0] + (gains[1] ?? 0)) / gainSum : null;

  let kind: BreadthKind | null = null;
  if (total >= MIN_BREADTH_STOCKS) {
    if (groupPct > 0.25) {
      // Few stocks rising, or most of the gain from two stocks while many others sit flat or down.
      if (pctUp < 50 || (topTwoShare !== null && topTwoShare >= 0.6 && total >= 6 && pctUp < 70)) kind = "narrow-up";
      else if (pctUp >= 70) kind = "broad-up";
      else kind = "mixed";
    } else if (groupPct < -0.25) {
      if (pctUp > 50) kind = "narrow-down";
      else if (pctUp <= 30) kind = "broad-down";
      else kind = "mixed";
    } else kind = "mixed";
  }
  return { up, total, pctUp, medianPct: med === null ? null : Math.round(med * 100) / 100, topTwoShare, kind };
}
