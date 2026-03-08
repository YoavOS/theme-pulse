import { useState, useCallback, useRef } from "react";

export interface TickerVolume {
  symbol: string;
  today_vol: number;
  avg_20d: number;
  avg_10d: number;
  avg_3m: number;
  today_vol_estimated?: boolean;
  vol_data_points?: number;
  error?: string;
}

export interface ThemeDemandSignals {
  relVol: number | null;       // today_vol / avg_20d ratio
  relVolEstimated: boolean;    // true if using proxy data (not live volume)
  sustainedVol: number | null; // (avg_10d / avg_3m - 1) * 100
  spikingUp: number;
  spikingDown: number;
  totalTickers: number;
  loading: boolean;
}

const LOCAL_CACHE_KEY = "volume_cache_v4"; // bumped to force refetch from fixed edge function
const CACHE_MAX_AGE = 4 * 60 * 60 * 1000;

interface LocalCache {
  data: Record<string, TickerVolume>;
  fetchedAt: string;
}

function loadLocalCache(): Record<string, TickerVolume> | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalCache;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > CACHE_MAX_AGE) {
      localStorage.removeItem(LOCAL_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch { return null; }
}

function saveLocalCache(data: Record<string, TickerVolume>) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ data, fetchedAt: new Date().toISOString() }));
  } catch {}
}

export function useVolumeData() {
  const volumeMapRef = useRef<Record<string, TickerVolume> | null>(null);
  if (volumeMapRef.current === null) {
    volumeMapRef.current = loadLocalCache() || {};
  }
  const [volumeMap, setVolumeMap] = useState<Record<string, TickerVolume>>(() => volumeMapRef.current!);
  const [loadingSymbols, setLoadingSymbols] = useState<Set<string>>(() => new Set());
  const pendingQueue = useRef<Set<string>>(new Set());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // Debounced batch fetch — collects symbols from all cards, then fires one batch
  const processBatch = useCallback(async () => {
    const symbols = [...pendingQueue.current];
    pendingQueue.current.clear();
    if (symbols.length === 0) return;

    setLoadingSymbols(prev => new Set([...prev, ...symbols]));

    // Batch in groups of 15
    const batchSize = 15;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      try {
        const res = await fetch(
          `${supabaseUrl}/functions/v1/fetch-volume?symbols=${batch.join(",")}`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.results) {
            const updates: Record<string, TickerVolume> = {};
            for (const r of data.results) {
              updates[r.symbol] = r;
              volumeMapRef.current[r.symbol] = r;
            }
            setVolumeMap(prev => {
              const next = { ...prev, ...updates };
              saveLocalCache(next);
              return next;
            });
          }
        }
      } catch (e) {
        console.error("Volume fetch error:", e);
      }
    }

    setLoadingSymbols(prev => {
      const next = new Set(prev);
      symbols.forEach(s => next.delete(s));
      return next;
    });
  }, [supabaseUrl, anonKey]);

  const fetchVolume = useCallback((symbols: string[]) => {
    // Filter already cached
    const needed = symbols.filter(s => !volumeMapRef.current[s]);
    if (needed.length === 0) return;

    needed.forEach(s => pendingQueue.current.add(s));

    // Debounce: wait 200ms for all cards to register their symbols, then fire one batch
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(processBatch, 200);
  }, [processBatch]);

  const getThemeSignals = useCallback((tickerSymbols: string[]): ThemeDemandSignals => {
    const loading = tickerSymbols.some(s => loadingSymbols.has(s));
    const vols = tickerSymbols.map(s => volumeMap[s]).filter(Boolean).filter(v => !v.error && (v.avg_10d > 0 || v.avg_3m > 0));

    if (vols.length === 0) {
      return { relVol: null, relVolEstimated: false, sustainedVol: null, spikingUp: 0, spikingDown: 0, totalTickers: tickerSymbols.length, loading };
    }

    // A: Relative Volume = avg of (today_vol / avg_20d) across tickers with valid data
    const relVols = vols.filter(v => v.avg_20d > 0 && v.today_vol > 0).map(v => v.today_vol / v.avg_20d);
    const relVol = relVols.length > 0
      ? Math.round((relVols.reduce((a, b) => a + b, 0) / relVols.length) * 100) / 100
      : null;
    const relVolEstimated = vols.some(v => v.today_vol_estimated);

    // B: Sustained Volume = avg of ((avg_10d / avg_3m - 1) * 100) across tickers
    const susVols = vols.filter(v => v.avg_3m > 0 && v.avg_10d > 0).map(v => ((v.avg_10d / v.avg_3m) - 1) * 100);
    const sustainedVol = susVols.length > 0
      ? Math.round((susVols.reduce((a, b) => a + b, 0) / susVols.length) * 100) / 100
      : null;

    // C: Volume Spike = count tickers where |change| > 30%
    let spikingUp = 0;
    let spikingDown = 0;
    for (const v of vols) {
      if (v.avg_20d <= 0 || v.today_vol <= 0) continue;
      const changePct = ((v.today_vol - v.avg_20d) / v.avg_20d) * 100;
      if (changePct > 30) spikingUp++;
      else if (changePct < -30) spikingDown++;
    }

    return { relVol, relVolEstimated, sustainedVol, spikingUp, spikingDown, totalTickers: tickerSymbols.length, loading };
  }, [volumeMap, loadingSymbols]);

  const clearCache = useCallback(() => {
    localStorage.removeItem(LOCAL_CACHE_KEY);
    volumeMapRef.current = {};
    setVolumeMap({});
  }, []);

  return { fetchVolume, getThemeSignals, clearCache, volumeMap };
}
