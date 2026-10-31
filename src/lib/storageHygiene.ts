/**
 * Keeps the browser's localStorage small. It is limited to ~5 million characters for the
 * whole site; when it fills up, new cache writes fail silently and screens re-download data.
 *
 * Runs once per page load, when the browser is idle:
 *  - removes keys from older versions of the app (renamed or moved caches),
 *  - expires per-stock caches (Minervini reports, AI summaries, catalysts) and caps how many
 *    are kept, since each one is written once and was never removed before.
 */

/** Keys the current app no longer reads (old versions, removed screens, moved to IndexedDB). */
const OBSOLETE_KEYS = [
  "stock_stages_v1", "stock_bases_v1", // now in IndexedDB
  "rs-52w-highs-v1", "rs-52w-highs-v2",
  "universe_sectors_v1", "universe_sectors_v2", "universe_sectors_v3", "universe_sectors_v4",
  "volume_cache_v1", "volume_cache_v2", "volume_cache_v3", "volume_cache_v4",
  "market_flag_cache_v1", "superperf_thresholds_v1",
  "rs-setup-metrics", "rs-setup-metrics-v2",
  "overviewView", "overviewTimeframe", "spyBenchmark", // Intelligence tab / removed SPY overlay
];
const OBSOLETE_PREFIXES = ["intel-collapsibles-"];

/** Per-item caches: prefix → [max age, max entries kept]. */
const ITEM_CACHES: [string, number, number][] = [
  ["minervini:", 24 * 3600e3, 15],          // ~40 KB per stock report
  ["theme-strength-ai-v1:", 3 * 24 * 3600e3, 40],
  ["volCatalyst:v1:", 3 * 24 * 3600e3, 60],
];

/** Best-effort timestamp from a cached JSON value (ts / at / fetchedAt / generatedAt / savedAt). */
function stampOf(raw: string | null): number | null {
  if (!raw || raw[0] !== "{") return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    for (const k of ["ts", "at", "fetchedAt", "generatedAt", "savedAt", "cachedAt"]) {
      const v = o[k];
      if (typeof v === "number" && v > 1e12) return v;
      if (typeof v === "string") { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
    }
  } catch { /* not JSON */ }
  return null;
}

export function cleanupStorage(): { removed: number; freedKB: number } {
  let removed = 0, freed = 0;
  try {
    const keys = Object.keys(localStorage);
    const drop = (k: string) => {
      freed += (localStorage.getItem(k)?.length ?? 0) + k.length;
      localStorage.removeItem(k);
      removed++;
    };
    for (const k of keys) {
      if (OBSOLETE_KEYS.includes(k) || OBSOLETE_PREFIXES.some((p) => k.startsWith(p))) drop(k);
    }
    const now = Date.now();
    for (const [prefix, maxAge, maxCount] of ITEM_CACHES) {
      const items = Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ k, t: stampOf(localStorage.getItem(k)) ?? 0 }))
        .sort((a, b) => b.t - a.t);
      // Entries without a readable timestamp are only subject to the count limit.
      items.forEach((it, i) => { if (i >= maxCount || (it.t > 0 && now - it.t > maxAge)) drop(it.k); });
    }
  } catch { /* storage unavailable */ }
  return { removed, freedKB: Math.round((freed * 2) / 1024) };
}

/** Schedule the cleanup for when the page is idle (never during the first render). */
export function scheduleStorageCleanup() {
  const run = () => {
    const r = cleanupStorage();
    if (r.removed) console.info(`[storage] removed ${r.removed} stale cache entries (~${r.freedKB} KB)`);
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 10_000 });
  else window.setTimeout(run, 4000);
}
