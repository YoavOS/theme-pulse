export type RsNewHighBenchmark = "SPY" | "QQQ";

export interface RsNewHighSignal {
  symbol: string;
  isSignal: boolean;
  rsHighDaysAgo: number | null;
  priceHighDaysAgo: number | null;
  rsLatest: number | null;
  rsHigh: number | null;
  priceLatest: number | null;
  priceHigh: number | null;
  benchmark: RsNewHighBenchmark;
  lookbackDays: number;
}

export const RS_NEW_HIGH_LOOKBACKS = [20, 30, 65, 126, 252] as const;

export function formatRsNewHighBadge(signal?: RsNewHighSignal | null): string {
  if (!signal?.isSignal || signal.rsHighDaysAgo === null) return "—";
  return signal.rsHighDaysAgo === 0 ? "RS NH today" : `RS NH +${signal.rsHighDaysAgo}d`;
}

export function rsNewHighScore(signal?: RsNewHighSignal | null): number {
  if (!signal?.isSignal) return -1;
  const recency = signal.rsHighDaysAgo === null ? 0 : Math.max(0, 300 - signal.rsHighDaysAgo);
  const gap =
    signal.priceHighDaysAgo !== null && signal.rsHighDaysAgo !== null
      ? Math.max(0, signal.priceHighDaysAgo - signal.rsHighDaysAgo)
      : 0;
  return 1_000 + recency + gap;
}