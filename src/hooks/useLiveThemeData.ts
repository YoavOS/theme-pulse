import { useState, useCallback, useEffect, useRef } from "react";

import { ThemeData, demoThemes, getProcessedThemes } from "@/data/themeData";
import { useToast } from "@/hooks/use-toast";

const CACHE_KEY = "theme_live_data_cache";
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CachedData {
  themes: ThemeData[];
  fetchedAt: string;
  symbolsFetched: number;
  rateLimited: boolean;
}

function saveCache(data: CachedData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded, ignore */ }
}

function loadCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedData;
    const age = Date.now() - new Date(parsed.fetchedAt).getTime();
    if (age > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface LiveDataState {
  themes: ThemeData[];
  isLoading: boolean;
  isLive: boolean;
  lastFetched: Date;
  rateLimited: boolean;
  symbolsFetched: number;
}

function buildInitialState(): LiveDataState {
  const cached = loadCache();
  if (cached) {
    return {
      themes: getProcessedThemes(cached.themes),
      isLoading: false,
      isLive: true,
      lastFetched: new Date(cached.fetchedAt),
      rateLimited: cached.rateLimited,
      symbolsFetched: cached.symbolsFetched,
    };
  }
  return {
    themes: getProcessedThemes(demoThemes),
    isLoading: false,
    isLive: false,
    lastFetched: new Date(),
    rateLimited: false,
    symbolsFetched: 0,
  };
}

export function useLiveThemeData() {
  const { toast } = useToast();
  const [state, setState] = useState<LiveDataState>(buildInitialState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Restore from cache on tab focus / visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      console.log("Tab focused – reloading from cache");
      const cached = loadCache();
      if (cached && mountedRef.current) {
        setState({
          themes: getProcessedThemes(cached.themes),
          isLoading: false,
          isLive: true,
          lastFetched: new Date(cached.fetchedAt),
          rateLimited: cached.rateLimited,
          symbolsFetched: cached.symbolsFetched,
        });
        toast({
          title: "Data restored",
          description: "Showing cached real data from " + new Date(cached.fetchedAt).toLocaleTimeString(),
        });
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [toast]);

  const fetchLiveData = useCallback(async (themeNames?: string[]) => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const params: Record<string, string> = {};
      if (themeNames?.length) {
        params.themes = themeNames.join(",");
      }
      const queryString = new URLSearchParams(params).toString();

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error("Supabase config missing");
      }

      const url = `${supabaseUrl}/functions/v1/fetch-themes${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const result = await res.json();

      if (result.error) {
        throw new Error(result.error);
      }

      // Build a map of live themes keyed by theme_name
      const liveThemeMap = new Map<string, ThemeData>();
      for (const t of result.themes) {
        // Recompute up/down from actual ticker data
        const up_count = t.tickers.filter((tk: { pct: number }) => tk.pct > 0).length;
        const down_count = t.tickers.filter((tk: { pct: number }) => tk.pct <= 0).length;
        const performance_pct = t.tickers.length > 0
          ? Math.round((t.tickers.reduce((sum: number, tk: { pct: number }) => sum + tk.pct, 0) / t.tickers.length) * 100) / 100
          : 0;
        liveThemeMap.set(t.theme_name, {
          theme_name: t.theme_name,
          performance_pct,
          up_count,
          down_count,
          tickers: t.tickers,
          notes: t.notes || undefined,
        });
      }

      // Merge: start with all live themes, then add any demo themes not in live
      const mergedMap = new Map<string, ThemeData>();

      // Add all live themes first
      for (const [name, theme] of liveThemeMap) {
        mergedMap.set(name, theme);
      }

      // Add demo themes that weren't fetched live (preserving their demo data or previous cache)
      for (const demo of demoThemes) {
        if (!mergedMap.has(demo.theme_name)) {
          // If we fetched selectively, keep previous state for non-selected themes
          if (themeNames?.length) {
            // Find in current state
            const existing = state.themes.find(t => t.theme_name === demo.theme_name);
            mergedMap.set(demo.theme_name, existing || demo);
          } else {
            mergedMap.set(demo.theme_name, demo);
          }
        }
      }

      const merged = Array.from(mergedMap.values());
      const processed = getProcessedThemes(merged);

      const fetchedAt = result.fetched_at || new Date().toISOString();

      // Save to cache
      saveCache({
        themes: merged,
        fetchedAt,
        symbolsFetched: result.symbols_fetched || 0,
        rateLimited: result.rate_limited || false,
      });

      if (!mountedRef.current) return;

      setState({
        themes: processed,
        isLoading: false,
        isLive: true,
        lastFetched: new Date(fetchedAt),
        rateLimited: result.rate_limited || false,
        symbolsFetched: result.symbols_fetched || 0,
      });

      if (result.rate_limited) {
        toast({
          title: "Rate Limited",
          description: "Finnhub rate limit hit. Some data may be stale. Try again in a minute.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Live Data Loaded",
          description: `Fetched ${result.symbols_fetched} symbols across ${result.themes.length} themes`,
        });
      }
    } catch (err) {
      console.error("Failed to fetch live data:", err);
      if (!mountedRef.current) return;
      // On error, keep current state (don't revert to demo)
      setState(prev => ({ ...prev, isLoading: false }));
      toast({
        title: "Failed to fetch live data",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [toast, state.themes]);

  const resetToDemo = useCallback(() => {
    localStorage.removeItem(CACHE_KEY);
    setState({
      themes: getProcessedThemes(demoThemes),
      isLoading: false,
      isLive: false,
      lastFetched: new Date(),
      rateLimited: false,
      symbolsFetched: 0,
    });
  }, []);

  return {
    ...state,
    fetchLiveData,
    resetToDemo,
  };
}
