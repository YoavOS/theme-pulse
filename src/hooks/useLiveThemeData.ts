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
    console.log(`Cache saved: ${data.themes.length} themes, ${data.symbolsFetched} symbols`);
  } catch { /* quota exceeded */ }
}

function loadCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedData;
    const age = Date.now() - new Date(parsed.fetchedAt).getTime();
    if (age > CACHE_MAX_AGE_MS) {
      console.log("Cache expired, removing");
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
    const realThemes = cached.themes.filter(t => t.dataSource === "real");
    console.log(`Loaded from cache: ${cached.themes.length} themes (${realThemes.length} real), age: ${Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60000)} min`);
    return {
      themes: getProcessedThemes(cached.themes),
      isLoading: false,
      isLive: true,
      lastFetched: new Date(cached.fetchedAt),
      rateLimited: cached.rateLimited,
      symbolsFetched: cached.symbolsFetched,
    };
  }
  console.log("No cache – starting with demo data");
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
  const themesRef = useRef(state.themes);
  useEffect(() => { themesRef.current = state.themes; }, [state.themes]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Restore from cache on tab focus — NEVER fall back to demo
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      const cached = loadCache();
      if (cached && mountedRef.current) {
        console.log("Tab focused – restoring from cache");
        setState({
          themes: getProcessedThemes(cached.themes),
          isLoading: false,
          isLive: true,
          lastFetched: new Date(cached.fetchedAt),
          rateLimited: cached.rateLimited,
          symbolsFetched: cached.symbolsFetched,
        });
        toast({ title: "Data restored", description: "Loaded latest real data from cache." });
      } else {
        console.log("Tab focused – no cache available");
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [toast]);

  // Merge partial scan results into current state + cache
  const mergeScanResults = useCallback((scanThemes: ThemeData[]) => {
    if (!mountedRef.current) return;

    setState((prev) => {
      const themeMap = new Map<string, ThemeData>();
      // Start with current real themes
      for (const t of prev.themes) {
        themeMap.set(t.theme_name, t);
      }
      // Overwrite with new scan results (mark as real)
      for (const t of scanThemes) {
        themeMap.set(t.theme_name, { ...t, dataSource: "real", lastUpdated: new Date().toISOString() });
      }
      // Only fill demo themes if we have NO real data yet
      const hasAnyReal = Array.from(themeMap.values()).some(t => t.dataSource === "real");
      if (!hasAnyReal) {
        for (const d of demoThemes) {
          if (!themeMap.has(d.theme_name)) {
            themeMap.set(d.theme_name, d);
          }
        }
      }

      const merged = Array.from(themeMap.values());
      const processed = getProcessedThemes(merged);

      const now = new Date().toISOString();
      const totalSymbols = merged.reduce((sum, t) => sum + t.tickers.filter(tk => !tk.skipped).length, 0);
      saveCache({
        themes: merged,
        fetchedAt: now,
        symbolsFetched: totalSymbols,
        rateLimited: false,
      });

      const realCount = merged.filter(t => t.dataSource === "real").length;
      console.log(`Merged scan: ${scanThemes.length} new, ${realCount} total real themes`);

      return {
        themes: processed,
        isLoading: false,
        isLive: true,
        lastFetched: new Date(now),
        rateLimited: false,
        symbolsFetched: totalSymbols,
      };
    });
  }, []);

  const fetchLiveData = useCallback(async (themeNames?: string[]) => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const params: Record<string, string> = {};
      if (themeNames?.length) {
        params.themes = themeNames.join(",");
      }
      const queryString = new URLSearchParams(params).toString();

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("Config missing");

      const url = `${supabaseUrl}/functions/v1/fetch-themes${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      const liveThemes: ThemeData[] = result.themes.map((t: any) => {
        const validTickers = t.tickers.filter((tk: any) => !tk.skipped);
        const up_count = validTickers.filter((tk: any) => tk.pct > 0).length;
        const down_count = validTickers.filter((tk: any) => tk.pct <= 0).length;
        const na_count = t.tickers.filter((tk: any) => tk.skipped).length;
        const performance_pct = validTickers.length > 0
          ? Math.round((validTickers.reduce((sum: number, tk: any) => sum + tk.pct, 0) / validTickers.length) * 100) / 100
          : 0;
        return {
          theme_name: t.theme_name,
          performance_pct,
          up_count,
          down_count,
          na_count,
          valid_count: validTickers.length,
          tickers: t.tickers,
          notes: t.notes || undefined,
          dataSource: "real" as const,
          lastUpdated: new Date().toISOString(),
        };
      });

      // Merge with existing
      const currentThemes = themesRef.current;
      const mergedMap = new Map<string, ThemeData>();
      for (const t of currentThemes) mergedMap.set(t.theme_name, t);
      for (const t of liveThemes) mergedMap.set(t.theme_name, t);
      // Only backfill demo themes if no real data exists
      const hasReal = Array.from(mergedMap.values()).some(t => t.dataSource === "real");
      if (!hasReal) {
        for (const d of demoThemes) {
          if (!mergedMap.has(d.theme_name)) mergedMap.set(d.theme_name, d);
        }
      }

      const merged = Array.from(mergedMap.values());
      const processed = getProcessedThemes(merged);
      const fetchedAt = result.fetched_at || new Date().toISOString();

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
        toast({ title: "Rate Limited", description: "Some data may be stale.", variant: "destructive" });
      } else {
        toast({ title: "Live Data Loaded", description: `${result.symbols_fetched} symbols across ${result.themes.length} themes` });
      }
    } catch (err) {
      console.error("Failed to fetch live data:", err);
      if (!mountedRef.current) return;
      setState((prev) => ({ ...prev, isLoading: false }));
      toast({ title: "Failed to fetch live data", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    }
  }, [toast]);

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
    mergeScanResults,
  };
}
