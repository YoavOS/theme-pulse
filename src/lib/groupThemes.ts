import type { ThemeData, Ticker } from "@/data/themeData";
import { gicsForIndustry } from "@/lib/sectorTaxonomy";
import type { GroupMode } from "@/lib/groupColors";

/**
 * Re-buckets the curated theme dataset into Industry or Sector "themes" so
 * every existing theme-shaped view (heatmap, best list, drilldown, exports,
 * concentration panel) works unchanged for all three grouping modes.
 */
export function buildGroupedThemes(
  themes: ThemeData[],
  industryBySymbol: Map<string, string | null>,
  mode: GroupMode,
): ThemeData[] {
  if (mode === "theme") return themes;

  const buckets = new Map<string, Ticker[]>();
  const seen = new Set<string>();

  for (const t of themes) {
    for (const tk of t.tickers) {
      const sym = tk.symbol.toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      const industry = industryBySymbol.get(sym) ?? null;
      const key =
        mode === "industry"
          ? (industry ?? "").trim() || "Unknown"
          : gicsForIndustry(industry) ?? (industry ? "Other" : "Unknown");
      const arr = buckets.get(key) ?? [];
      arr.push(tk);
      buckets.set(key, arr);
    }
  }

  const avg = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
  const field = (list: Ticker[], k: keyof Ticker) =>
    avg(list.map(t => t[k]).filter((v): v is number => typeof v === "number"));

  const out: ThemeData[] = [];
  buckets.forEach((list, name) => {
    const valid = list.filter(t => !t.skipped && typeof t.pct === "number");
    out.push({
      theme_name: name,
      performance_pct: Number(avg(valid.map(t => t.pct)).toFixed(2)),
      up_count: valid.filter(t => t.pct > 0).length,
      down_count: valid.filter(t => t.pct < 0).length,
      na_count: list.length - valid.length,
      valid_count: valid.length,
      tickers: [...list].sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999)),
      perf_today: field(valid, "pct_today"),
      perf_1d: field(valid, "pct_1d"),
      perf_1w: field(valid, "pct_1w"),
      perf_1m: field(valid, "pct_1m"),
      perf_3m: field(valid, "pct_3m"),
    });
  });

  out.sort(
    (a, b) =>
      (a.theme_name === "Unknown" ? 1 : 0) - (b.theme_name === "Unknown" ? 1 : 0) ||
      b.performance_pct - a.performance_pct,
  );
  out.forEach((t, i) => { t.rank = i + 1; });
  return out;
}
