import type { ThemeData, Ticker } from "@/data/themeData";
import { groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";

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
      const key = groupKeyForIndustry(industry, mode);
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

/** Universe row shape needed for Industry / Sub-Industry / Sector grouping. */
export interface UniverseGroupRow {
  symbol: string;
  sector: string | null;
  name?: string | null;
  r1d?: number | null;
  r1w?: number | null;
  r1m?: number | null;
  r3m?: number | null;
}

/**
 * Builds Industry / Sub-Industry / Sector "themes" from the whole qualified RS
 * universe (not just theme tickers). Returns come from the latest
 * "Recalculate RS Scores" run; "Today" uses the 1-day return.
 */
export function buildUniverseGroups(
  rows: UniverseGroupRow[],
  mode: GroupMode,
  timeframe: string,
): ThemeData[] {
  const pick = (r: UniverseGroupRow): number | null => {
    switch (timeframe) {
      case "1W": return r.r1w ?? null;
      case "1M": return r.r1m ?? null;
      case "3M": return r.r3m ?? null;
      default: return r.r1d ?? null; // Today / Overall headline
    }
  };

  const buckets = new Map<string, Ticker[]>();
  for (const r of rows) {
    const key = groupKeyForIndustry(r.sector, mode);
    const pct = pick(r);
    const tk: Ticker = {
      symbol: r.symbol.toUpperCase(),
      name: r.name ?? undefined,
      pct: pct ?? 0,
      skipped: pct === null,
      skipReason: pct === null ? "No return data from the last RS scan" : undefined,
      pct_today: r.r1d ?? undefined,
      pct_1d: r.r1d ?? undefined,
      pct_1w: r.r1w ?? undefined,
      pct_1m: r.r1m ?? undefined,
      pct_3m: r.r3m ?? undefined,
    };
    const arr = buckets.get(key) ?? [];
    arr.push(tk);
    buckets.set(key, arr);
  }

  const avg = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
  const field = (list: Ticker[], k: keyof Ticker) =>
    avg(list.map(t => t[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));

  const out: ThemeData[] = [];
  buckets.forEach((list, name) => {
    const valid = list.filter(t => !t.skipped);
    out.push({
      theme_name: name,
      performance_pct: Number(avg(valid.map(t => t.pct)).toFixed(2)),
      up_count: valid.filter(t => t.pct > 0).length,
      down_count: valid.filter(t => t.pct < 0).length,
      na_count: list.length - valid.length,
      valid_count: valid.length,
      tickers: [...list].sort((a, b) => (b.skipped ? -999 : b.pct) - (a.skipped ? -999 : a.pct)),
      dataSource: "real",
      perf_today: field(valid, "pct_today"),
      perf_1d: field(valid, "pct_1d"),
      perf_1w: field(list, "pct_1w"),
      perf_1m: field(list, "pct_1m"),
      perf_3m: field(list, "pct_3m"),
    });
  });

  const last = (n: string) => (n === "Unknown" || n === "Other" ? 1 : 0);
  out.sort((a, b) => last(a.theme_name) - last(b.theme_name) || b.performance_pct - a.performance_pct);
  out.forEach((t, i) => { t.rank = i + 1; });
  return out;
}
