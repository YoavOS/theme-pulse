/**
 * SPY Benchmark Hook
 * Provides SPY performance data for relative strength comparisons.
 * SPY is stored in ticker_performance and eod_prices with theme_name = '__BENCHMARK__'
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SpyData {
  perf_1d: number | null;
  perf_1w: number | null;
  perf_1m: number | null;
  perf_3m: number | null;
  perf_ytd: number | null;
  price: number | null;
}

const SPY_CACHE_KEY = "spyBenchmark";
const SPY_CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // 4h

function loadSpyCache(): SpyData | null {
  try {
    const raw = localStorage.getItem(SPY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > SPY_CACHE_MAX_AGE) return null;
    return parsed.data as SpyData;
  } catch { return null; }
}

function saveSpyCache(data: SpyData) {
  try { localStorage.setItem(SPY_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

const EMPTY: SpyData = { perf_1d: null, perf_1w: null, perf_1m: null, perf_3m: null, perf_ytd: null, price: null };

export function useSpyBenchmark() {
  const [spy, setSpy] = useState<SpyData>(() => loadSpyCache() || EMPTY);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSpy = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from("ticker_performance")
        .select("perf_1d, perf_1w, perf_1m, perf_3m, perf_ytd, price")
        .eq("symbol", "SPY")
        .single();

      if (data) {
        const spyData: SpyData = {
          perf_1d: data.perf_1d,
          perf_1w: data.perf_1w,
          perf_1m: data.perf_1m,
          perf_3m: data.perf_3m,
          perf_ytd: data.perf_ytd,
          price: data.price,
        };
        setSpy(spyData);
        saveSpyCache(spyData);
      }
    } catch (err) {
      console.error("SPY benchmark fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSpy(); }, [fetchSpy]);

  const getRelativeStrength = useCallback((themePerf: number, timeframe: string = "Today"): number | null => {
    const field = timeframe === "1W" ? "perf_1w" : timeframe === "1M" ? "perf_1m" : timeframe === "3M" ? "perf_3m" : timeframe === "YTD" ? "perf_ytd" : "perf_1d";
    const spyVal = spy[field];
    if (spyVal === null || spyVal === undefined) return null;
    return Math.round((themePerf - spyVal) * 100) / 100;
  }, [spy]);

  const getTickerRS = useCallback((tickerPerf: number): number | null => {
    if (spy.perf_1d === null) return null;
    return Math.round((tickerPerf - spy.perf_1d) * 100) / 100;
  }, [spy]);

  return { spy, isLoading, fetchSpy, getRelativeStrength, getTickerRS };
}

export function formatRS(rs: number | null): { text: string; color: string } {
  if (rs === null) return { text: "vs SPY: ~", color: "text-muted-foreground" };
  const sign = rs >= 0 ? "+" : "";
  const color = rs > 0 ? "text-[hsl(174,80%,50%)]" : rs < 0 ? "text-[hsl(40,80%,50%)]" : "text-muted-foreground";
  return { text: `vs SPY: ${sign}${rs.toFixed(2)}%`, color };
}
