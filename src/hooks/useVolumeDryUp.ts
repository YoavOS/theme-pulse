import { useState, useEffect, useCallback } from "react";
import { supabase as _supabaseTyped } from "@/integrations/supabase/client";
const supabase: any = _supabaseTyped;

export interface VolumeDryUpTheme {
  themeName: string;
  lastWeekSustained: number;
  thisWeekSustained: number;
  change: number;
  perf_1w: number;
}

const DRYUP_CACHE_KEY = "volume_dryup_cache";
const CACHE_MAX_AGE = 4 * 60 * 60 * 1000;

interface DryUpCache {
  themes: VolumeDryUpTheme[];
  fetchedAt: string;
}

function loadCache(): VolumeDryUpTheme[] | null {
  try {
    const raw = localStorage.getItem(DRYUP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DryUpCache;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > CACHE_MAX_AGE) {
      localStorage.removeItem(DRYUP_CACHE_KEY);
      return null;
    }
    return parsed.themes;
  } catch {
    return null;
  }
}

function saveCache(themes: VolumeDryUpTheme[]) {
  try {
    localStorage.setItem(DRYUP_CACHE_KEY, JSON.stringify({ themes, fetchedAt: new Date().toISOString() }));
  } catch {}
}

/**
 * Detects themes where volume is drying up after a period of elevated activity.
 * Uses eod_prices (last 10 trading days of volume) and ticker_volume_cache (3-month avg).
 * Zero new API calls — all from existing DB data.
 */
export function useVolumeDryUp() {
  const [dryUpThemes, setDryUpThemes] = useState<VolumeDryUpTheme[]>(() => loadCache() || []);
  const [isLoading, setIsLoading] = useState(false);

  const detect = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get theme structure
      const [themesRes, tickersRes, volCacheRes, perfRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_volume_cache").select("symbol, avg_3m"),
        supabase.from("ticker_performance").select("symbol, perf_1w, status"),
      ]);

      if (!themesRes.data || !tickersRes.data || !volCacheRes.data) {
        setIsLoading(false);
        return;
      }

      // Get last 10 trading days of EOD volume data
      const { data: eodData } = await supabase
        .from("eod_prices")
        .select("symbol, date, volume")
        .not("volume", "is", null)
        .order("date", { ascending: false })
        .limit(5000);

      if (!eodData || eodData.length === 0) {
        setIsLoading(false);
        return;
      }

      // Build maps
      const avg3mMap = new Map<string, number>();
      for (const v of volCacheRes.data) {
        if (v.avg_3m && v.avg_3m > 0) avg3mMap.set(v.symbol, Number(v.avg_3m));
      }

      const perfMap = new Map<string, number>();
      if (perfRes.data) {
        for (const p of perfRes.data) {
          if (p.status === "done") perfMap.set(p.symbol, p.perf_1w || 0);
        }
      }

      // Get unique dates sorted desc
      const uniqueDates = [...new Set(eodData.map(r => r.date))].sort().reverse();
      if (uniqueDates.length < 5) {
        setIsLoading(false);
        return;
      }

      const thisWeekDates = new Set(uniqueDates.slice(0, 5));
      const lastWeekDates = new Set(uniqueDates.slice(5, 10));

      // Build symbol -> daily volumes
      const symbolVolumes = new Map<string, { thisWeek: number[]; lastWeek: number[] }>();
      for (const row of eodData) {
        if (!row.volume || row.volume <= 0) continue;
        const entry = symbolVolumes.get(row.symbol) || { thisWeek: [], lastWeek: [] };
        if (thisWeekDates.has(row.date)) entry.thisWeek.push(Number(row.volume));
        else if (lastWeekDates.has(row.date)) entry.lastWeek.push(Number(row.volume));
        symbolVolumes.set(row.symbol, entry);
      }

      // Build theme map
      const themeSymbols = new Map<string, string[]>();
      for (const tk of tickersRes.data) {
        const arr = themeSymbols.get(tk.theme_id) || [];
        arr.push(tk.ticker_symbol);
        themeSymbols.set(tk.theme_id, arr);
      }

      const results: VolumeDryUpTheme[] = [];

      for (const theme of themesRes.data) {
        const symbols = themeSymbols.get(theme.id) || [];
        if (symbols.length === 0) continue;

        try {
          const thisWeekRatios: number[] = [];
          const lastWeekRatios: number[] = [];

          for (const sym of symbols) {
            const avg3m = avg3mMap.get(sym);
            if (!avg3m) continue;

            const vols = symbolVolumes.get(sym);
            if (!vols) continue;

            if (vols.thisWeek.length > 0) {
              const avgThisWeek = vols.thisWeek.reduce((a, b) => a + b, 0) / vols.thisWeek.length;
              thisWeekRatios.push(avgThisWeek / avg3m);
            }
            if (vols.lastWeek.length > 0) {
              const avgLastWeek = vols.lastWeek.reduce((a, b) => a + b, 0) / vols.lastWeek.length;
              lastWeekRatios.push(avgLastWeek / avg3m);
            }
          }

          if (thisWeekRatios.length === 0 || lastWeekRatios.length === 0) continue;

          const sustainedThisWeek = thisWeekRatios.reduce((a, b) => a + b, 0) / thisWeekRatios.length;
          const sustainedLastWeek = lastWeekRatios.reduce((a, b) => a + b, 0) / lastWeekRatios.length;

          const volumeDryUp =
            sustainedLastWeek > 1.3 &&
            sustainedThisWeek < 1.1 &&
            (sustainedLastWeek - sustainedThisWeek) > 0.25;

          if (volumeDryUp) {
            // Compute avg 1W perf for theme
            const themePerfValues = symbols
              .map(s => perfMap.get(s))
              .filter((v): v is number => v !== undefined);
            const avgPerf1w = themePerfValues.length > 0
              ? themePerfValues.reduce((a, b) => a + b, 0) / themePerfValues.length
              : 0;

            results.push({
              themeName: theme.name,
              lastWeekSustained: Math.round(sustainedLastWeek * 100) / 100,
              thisWeekSustained: Math.round(sustainedThisWeek * 100) / 100,
              change: Math.round((sustainedThisWeek - sustainedLastWeek) * 100) / 100,
              perf_1w: Math.round(avgPerf1w * 100) / 100,
            });
          }
        } catch {
          // Never crash — skip theme
        }
      }

      setDryUpThemes(results);
      saveCache(results);
    } catch (err) {
      console.error("Volume dry-up detection failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = loadCache();
    if (!cached) {
      detect();
    }
  }, [detect]);

  const isThemeDryingUp = useCallback(
    (themeName: string) => dryUpThemes.some(t => t.themeName === themeName),
    [dryUpThemes]
  );

  const getThemeDryUp = useCallback(
    (themeName: string) => dryUpThemes.find(t => t.themeName === themeName) || null,
    [dryUpThemes]
  );

  return { dryUpThemes, isThemeDryingUp, getThemeDryUp, detect, isLoading };
}

/**
 * Save weekly volume snapshots — disabled. The `volume_history` table was
 * dropped in the lightweight cleanup; weekly snapshots are no longer persisted.
 */
export async function saveWeeklyVolumeHistory() {
  return;
}

