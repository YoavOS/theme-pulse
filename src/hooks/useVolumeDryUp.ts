import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 * Save weekly volume snapshots to volume_history table.
 * Called after Friday EOD save.
 */
export async function saveWeeklyVolumeHistory() {
  try {
    const [themesRes, tickersRes, volCacheRes] = await Promise.all([
      supabase.from("themes").select("id, name"),
      supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
      supabase.from("ticker_volume_cache").select("symbol, today_vol, avg_20d, avg_10d, avg_3m"),
    ]);

    if (!themesRes.data || !tickersRes.data || !volCacheRes.data) return;

    const volMap = new Map(volCacheRes.data.map(v => [v.symbol, v]));

    const themeSymbols = new Map<string, string[]>();
    for (const tk of tickersRes.data) {
      const arr = themeSymbols.get(tk.theme_id) || [];
      arr.push(tk.ticker_symbol);
      themeSymbols.set(tk.theme_id, arr);
    }

    // Get this Friday's date
    const now = new Date();
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    // Find most recent Friday
    const dayOfWeek = et.getDay();
    const daysToFriday = dayOfWeek === 0 ? 2 : dayOfWeek === 6 ? 1 : dayOfWeek >= 5 ? 0 : 5 - dayOfWeek;
    // Actually go back to last Friday
    const fridayOffset = dayOfWeek === 5 ? 0 : dayOfWeek === 6 ? 1 : dayOfWeek === 0 ? 2 : dayOfWeek;
    et.setDate(et.getDate() - fridayOffset);
    const weekEnding = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;

    const rows: { theme_name: string; week_ending: string; sustained_vol_pct: number | null; avg_rel_vol: number | null }[] = [];

    for (const theme of themesRes.data) {
      const symbols = themeSymbols.get(theme.id) || [];
      if (symbols.length === 0) continue;

      const vols = symbols.map(s => volMap.get(s)).filter((v): v is NonNullable<typeof v> =>
        !!v && ((v.avg_10d ?? 0) > 0 || (v.avg_3m ?? 0) > 0)
      );

      if (vols.length === 0) continue;

      const relVols = vols
        .filter(v => (v.avg_20d ?? 0) > 0 && (v.today_vol ?? 0) > 0)
        .map(v => Number(v.today_vol!) / Number(v.avg_20d!));
      const avgRelVol = relVols.length > 0
        ? Math.round((relVols.reduce((a, b) => a + b, 0) / relVols.length) * 100) / 100
        : null;

      const susVols = vols
        .filter(v => (v.avg_3m ?? 0) > 0 && (v.avg_10d ?? 0) > 0)
        .map(v => ((Number(v.avg_10d!) / Number(v.avg_3m!)) - 1) * 100);
      const sustainedVol = susVols.length > 0
        ? Math.round((susVols.reduce((a, b) => a + b, 0) / susVols.length) * 100) / 100
        : null;

      rows.push({
        theme_name: theme.name,
        week_ending: weekEnding,
        sustained_vol_pct: sustainedVol,
        avg_rel_vol: avgRelVol,
      });
    }

    // Upsert in batches
    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      await supabase
        .from("volume_history" as any)
        .upsert(rows.slice(i, i + BATCH), { onConflict: "theme_name,week_ending" });
    }

    console.log(`Volume history saved: ${rows.length} themes for week ending ${weekEnding}`);
  } catch (err) {
    console.error("Failed to save weekly volume history:", err);
  }
}
