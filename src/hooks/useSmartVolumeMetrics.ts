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
  /** Theme-level sparkline: average normalized volume per day across constituents (last 30 sessions). */
  sparkline: number[];
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
 * Caches results in-memory keyed by period so switching tabs doesn't re-fetch.
 *
 * Critical: every async write to React state checks the *current* period via a ref
 * before committing, so a flight in progress for an old period cannot overwrite
 * the displayed data for a newly selected period.
 */
export function useSmartVolumeMetrics(period: Timeframe) {
  const [data, setData] = useState<Record<string, SmartVolumeMetrics>>({});
  const [loadingSymbols, setLoadingSymbols] = useState<Set<string>>(() => new Set());

  // Cache slices keyed by period; queues keyed by period too.
  const cacheRef = useRef<Map<string, Record<string, SmartVolumeMetrics>>>(new Map());
  const queueRef = useRef<Map<string, Set<string>>>(new Map());
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inflightRef = useRef<Map<string, Set<string>>>(new Map());

  // Track the *current* period the user is viewing — async writes guard against this.
  const currentPeriodRef = useRef<Timeframe>(period);

  // When period changes, swap to the cache slice for that period
  useEffect(() => {
    currentPeriodRef.current = period;
    const slice = cacheRef.current.get(period) || {};
    setData({ ...slice });
    // Recompute loading set: any symbols in flight for THIS period are loading.
    const inflight = inflightRef.current.get(period) || new Set();
    setLoadingSymbols(new Set(inflight));
  }, [period]);

  const flushFor = useCallback(async (p: Timeframe) => {
    const queue = queueRef.current.get(p);
    if (!queue || queue.size === 0) return;
    const symbols = [...queue];
    queue.clear();

    const inflight = inflightRef.current.get(p) ?? new Set<string>();
    symbols.forEach(s => inflight.add(s));
    inflightRef.current.set(p, inflight);

    if (currentPeriodRef.current === p) {
      setLoadingSymbols(prev => new Set([...prev, ...symbols]));
    }

    const BATCH = 15;
    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/fetch-volume?period=${p}&symbols=${batch.join(",")}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
        );
        if (!res.ok) continue;
        const payload = await res.json();
        if (!payload?.results) continue;

        const slice = cacheRef.current.get(p) || {};
        for (const r of payload.results as SmartVolumeMetrics[]) {
          slice[r.symbol] = r;
        }
        cacheRef.current.set(p, slice);

        // Only push to React state if the user is STILL viewing this period.
        if (currentPeriodRef.current === p) {
          setData({ ...slice });
        }
      } catch (e) {
        console.error("smart volume fetch error:", e);
      } finally {
        batch.forEach(s => inflight.delete(s));
        if (currentPeriodRef.current === p) {
          setLoadingSymbols(prev => {
            const next = new Set(prev);
            batch.forEach(s => next.delete(s));
            return next;
          });
        }
      }
    }
  }, []);

  const fetchMetrics = useCallback((symbols: string[]) => {
    const p = period;
    const slice = cacheRef.current.get(p) || {};
    const inflight = inflightRef.current.get(p) || new Set();
    let queue = queueRef.current.get(p);
    if (!queue) {
      queue = new Set();
      queueRef.current.set(p, queue);
    }
    const needed = symbols.filter(s => !slice[s] && !queue!.has(s) && !inflight.has(s));
    if (needed.length === 0) return;
    needed.forEach(s => queue!.add(s));

    const existing = timerRef.current.get(p);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timerRef.current.delete(p);
      flushFor(p);
    }, 200);
    timerRef.current.set(p, t);
  }, [period, flushFor]);

  const getThemeMetrics = useCallback((symbols: string[]): ThemeSmartVolume => {
    const loading = symbols.some(s => loadingSymbols.has(s));
    const rows = symbols.map(s => data[s]).filter(Boolean).filter(r => !r.error);
    if (rows.length === 0) {
      return { relVol: null, volTrendPct: null, volConsistency: null, sustainedScore: null, sparkline: [], loading };
    }
    const relVol = avgOrNull(rows.map(r => r.rel_vol));
    const volTrendPct = avgOrNull(rows.map(r => r.vol_trend_pct));
    const volConsistency = avgOrNull(rows.map(r => r.vol_consistency));
    const sustainedScore = avgOrNull(rows.map(r => r.sustained_score));

    // Aggregate sparkline: normalize each ticker's sparkline to its own max,
    // then average per-day across all tickers. Yields a 0..1 series of "relative
    // daily participation" — robust to symbols of wildly different volume scales.
    let sparkline: number[] = [];
    const sparkSeries = rows.map(r => r.vol_sparkline).filter((s): s is number[] => Array.isArray(s) && s.length > 0);
    if (sparkSeries.length > 0) {
      const len = Math.min(...sparkSeries.map(s => s.length));
      const trimmed = sparkSeries.map(s => s.slice(-len));
      const normalized = trimmed.map(s => {
        const max = Math.max(...s, 1);
        return s.map(v => v / max);
      });
      sparkline = Array.from({ length: len }, (_, i) => {
        const day = normalized.map(s => s[i]);
        return day.reduce((a, b) => a + b, 0) / day.length;
      });
    }

    return {
      relVol: relVol !== null ? Math.round(relVol * 100) / 100 : null,
      volTrendPct: volTrendPct !== null ? Math.round(volTrendPct * 10) / 10 : null,
      volConsistency: volConsistency !== null ? Math.round(volConsistency) : null,
      sustainedScore: sustainedScore !== null ? Math.round(sustainedScore * 100) / 100 : null,
      sparkline,
      loading,
    };
  }, [data, loadingSymbols]);

  return { data, fetchMetrics, getThemeMetrics, loadingSymbols };
}
