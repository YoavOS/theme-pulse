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

/** Stock-list row needed for Industry / Sub-Industry / Sector grouping (labels only). */
export interface UniverseGroupRow {
  symbol: string;
  sector: string | null;
  name?: string | null;
}

/** Per-ticker numbers from the Dashboard's own Full Scan (percent). */
export type ScanPerfMap = Record<string, { perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number }>;

export type OverallWeights = { w1d: number; w1w: number; w1m: number; w3m: number };

/**
 * Builds Industry / Sub-Industry / Sector "themes" from the whole stock list,
 * using performance from the Dashboard's own Full Scan (not RS Alpha).
 * Stocks the scan hasn't covered yet are kept as "no data".
 */
export function buildUniverseGroups(
  rows: UniverseGroupRow[],
  perf: ScanPerfMap,
  mode: GroupMode,
  timeframe: string,
  overallWeights?: OverallWeights,
): ThemeData[] {
  const wRaw = overallWeights ?? { w1d: 0, w1w: 0, w1m: 60, w3m: 40 };
  const blend = (p: ScanPerfMap[string]) => {
    let num = 0, den = 0;
    const add = (v: number, w: number) => { if (w > 0 && Number.isFinite(v)) { num += w * v; den += w; } };
    add(p.perf_1d, wRaw.w1d); add(p.perf_1w, wRaw.w1w); add(p.perf_1m, wRaw.w1m); add(p.perf_3m, wRaw.w3m);
    return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  };
  const pick = (p: ScanPerfMap[string]): number => {
    switch (timeframe) {
      case "1W": return p.perf_1w;
      case "1M": return p.perf_1m;
      case "3M": return p.perf_3m;
      case "Overall": return blend(p);
      default: return p.perf_1d; // Today = 1-day change at scan time
    }
  };

  const buckets = new Map<string, Ticker[]>();
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    const p = perf[sym];
    const key = groupKeyForIndustry(r.sector, mode);
    const tk: Ticker = p
      ? {
          symbol: sym, name: r.name ?? undefined, pct: pick(p) ?? 0,
          pct_today: p.perf_1d, pct_1d: p.perf_1d, pct_1w: p.perf_1w, pct_1m: p.perf_1m, pct_3m: p.perf_3m,
        }
      : { symbol: sym, name: r.name ?? undefined, pct: 0, skipped: true, skipReason: "Not in the last Full Scan" };
    const arr = buckets.get(key) ?? [];
    arr.push(tk);
    buckets.set(key, arr);
  }

  const avg = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0);
  const field = (list: Ticker[], k: keyof Ticker) =>
    Math.round(avg(list.map(t => t[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v))) * 100) / 100;

  const out: ThemeData[] = [];
  buckets.forEach((list, name) => {
    const valid = list.filter(t => !t.skipped);
    if (valid.length === 0) return; // nothing scanned in this group yet
    out.push({
      theme_name: name,
      performance_pct: Math.round(avg(valid.map(t => t.pct)) * 100) / 100,
      up_count: valid.filter(t => t.pct > 0).length,
      down_count: valid.filter(t => t.pct <= 0).length,
      na_count: list.length - valid.length,
      valid_count: valid.length,
      tickers: [...valid].sort((a, b) => b.pct - a.pct).concat(list.filter(t => t.skipped)),
      dataSource: "real",
      perf_today: field(valid, "pct_today"),
      perf_1d: field(valid, "pct_1d"),
      perf_1w: field(valid, "pct_1w"),
      perf_1m: field(valid, "pct_1m"),
      perf_3m: field(valid, "pct_3m"),
    });
  });

  const last = (n: string) => (n === "Unknown" || n === "Other" ? 1 : 0);
  out.sort((a, b) => last(a.theme_name) - last(b.theme_name) || b.performance_pct - a.performance_pct);
  out.forEach((t, i) => { t.rank = i + 1; });
  return out;
}
