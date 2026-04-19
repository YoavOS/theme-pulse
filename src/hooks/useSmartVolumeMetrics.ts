import { useState, useCallback, useRef, useEffect } from "react";
import type { Timeframe } from "./useTimeframeAvailability";

export interface SmartVolumeMetrics {
  symbol: string;
  rel_vol: number | null;
  vol_trend_pct: number | null;
  vol_consistency: number | null;
  sustained_score: number | null;
  vol_sparkline?: number[];
  today_vol_estimated?: boolean;
  error?: string;
}

export interface ThemeSmartVolume {
  relVol: number | null;
  volTrendPct: number | null;
  volConsistency: number | null;
  sustainedScore: number | null;
  loading: boolean;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function avgOrNull(nums: (number | null | undefined)[]): number | null {
  const v = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Fetches per-period smart volume metrics from the `fetch-volume` edge function.
 * Caches results in-memory keyed by `${period}:${symbol}` so switching tabs
 * doesn't re-fetch. Batches queued symbols with a 200ms debounce.
 */
export function useSmartVolumeMetrics(period: Timeframe) {
  const [data, setData] = useState<Record<string, SmartVolumeMetrics>>({});
  const [loadingSymbols, setLoadingSymbols] = useState<Set<string>>(() => new Set());

  const cacheRef = useRef<Map<string, Record<string, SmartVolumeMetrics>>>(new Map());
  const queueRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When period changes, swap to the cache slice for that period
  useEffect(() => {
    const slice = cacheRef.current.get(period) || {};
    setData(slice);
  }, [period]);

  const flush = useCallback(async () => {
    const symbols = [...queueRef.current];
    queueRef.current.clear();
    if (symbols.length === 0) return;

    setLoadingSymbols(prev => new Set([...prev, ...symbols]));

    const BATCH = 15;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/fetch-volume?period=${period}&symbols=${batch.join(",")}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
        );
        if (!res.ok) continue;
        const payload = await res.json();
        if (!payload?.results) continue;

        const slice = cacheRef.current.get(period) || {};
        for (const r of payload.results as SmartVolumeMetrics[]) {
          slice[r.symbol] = r;
        }
        cacheRef.current.set(period, slice);
        setData({ ...slice });
      } catch (e) {
        console.error("smart volume fetch error:", e);
      }
    }

    setLoadingSymbols(prev => {
      const next = new Set(prev);
      symbols.forEach(s => next.delete(s));
      return next;
    });
  }, [period]);

  const fetchMetrics = useCallback((symbols: string[]) => {
    const slice = cacheRef.current.get(period) || {};
    const needed = symbols.filter(s => !slice[s] && !queueRef.current.has(s));
    if (needed.length === 0) return;
    needed.forEach(s => queueRef.current.add(s));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 200);
  }, [period, flush]);

  const getThemeMetrics = useCallback((symbols: string[]): ThemeSmartVolume => {
    const loading = symbols.some(s => loadingSymbols.has(s));
    const rows = symbols.map(s => data[s]).filter(Boolean).filter(r => !r.error);
    if (rows.length === 0) {
      return { relVol: null, volTrendPct: null, volConsistency: null, sustainedScore: null, loading };
    }
    const relVol = avgOrNull(rows.map(r => r.rel_vol));
    const volTrendPct = avgOrNull(rows.map(r => r.vol_trend_pct));
    const volConsistency = avgOrNull(rows.map(r => r.vol_consistency));
    const sustainedScore = avgOrNull(rows.map(r => r.sustained_score));
    return {
      relVol: relVol !== null ? Math.round(relVol * 100) / 100 : null,
      volTrendPct: volTrendPct !== null ? Math.round(volTrendPct * 10) / 10 : null,
      volConsistency: volConsistency !== null ? Math.round(volConsistency) : null,
      sustainedScore: sustainedScore !== null ? Math.round(sustainedScore * 100) / 100 : null,
      loading,
    };
  }, [data, loadingSymbols]);

  return { data, fetchMetrics, getThemeMetrics, loadingSymbols };
}
