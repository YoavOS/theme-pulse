/**
 * TradingView watchlist "sections" format: each group goes under a `###Name`
 * heading. Groups are ordered best first (highest average score) and worst
 * last; tickers inside a group are ordered by their own score.
 */
export interface TvItem { symbol: string; group: string; score: number | null }

export function rankedGroups(items: TvItem[]): { name: string; avg: number | null; symbols: string[] }[] {
  const m = new Map<string, TvItem[]>();
  for (const it of items) m.set(it.group, [...(m.get(it.group) ?? []), it]);
  const out = [...m.entries()].map(([name, arr]) => {
    const sc = arr.map((x) => x.score).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const sorted = [...arr].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    return { name, avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null, symbols: sorted.map((x) => x.symbol) };
  });
  return out.sort((a, b) => (b.avg ?? -Infinity) - (a.avg ?? -Infinity) || b.symbols.length - a.symbols.length);
}

export function tvSectionsText(items: TvItem[]): string {
  return rankedGroups(items)
    .map((g) => `###${g.name.replace(/[,\n]/g, " ")}\n${g.symbols.join("\n")}`)
    .join("\n");
}

export type ExportFormat = "lines" | "sections";
export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = { lines: "One per line", sections: "TradingView sections" };
