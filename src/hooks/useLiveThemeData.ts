import { useState, useCallback, useEffect, useRef } from "react";
import { ThemeData, demoThemes, getProcessedThemes } from "@/data/themeData";
import { useToast } from "@/hooks/use-toast";
import {
  saveScanCache,
  loadScanCache,
  loadLocalScanCache,
  saveLocalScanCache,
  clearLocalScanCache,
} from "@/hooks/useScanCache";

interface LiveDataState {
  themes: ThemeData[];
  isLoading: boolean;
  isLive: boolean;
  lastFetched: Date;
  rateLimited: boolean;
  symbolsFetched: number;
  usingCache: boolean;
  isStale: boolean;
}

const DEMO_STATE: LiveDataState = {
  themes: getProcessedThemes(demoThemes),
  isLoading: false,
  isLive: false,
  lastFetched: new Date(),
  rateLimited: false,
  symbolsFetched: 0,
  usingCache: false,
  isStale: false,
};

export function useLiveThemeData(timeframe: string = "Today") {
  const { toast } = useToast();
  const [state, setState] = useState<LiveDataState>(DEMO_STATE);
  const mountedRef = useRef(true);
  const themesRef = useRef(state.themes);
  const timeframeRef = useRef(timeframe);
  const initializedRef = useRef(false);

  useEffect(() => { themesRef.current = state.themes; }, [state.themes]);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── On mount: restore from cache (localStorage → Supabase) ──
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Instant: check localStorage
    const local = loadLocalScanCache();
    if (local && local.themes.length > 0) {
      const age = Date.now() - new Date(local.scannedAt).getTime();
      const isStale = age > 24 * 60 * 60 * 1000;
      setState({
        themes: getProcessedThemes(local.themes),
        isLoading: false,
        isLive: true,
        lastFetched: new Date(local.scannedAt),
        rateLimited: false,
        symbolsFetched: local.symbolsFetched,
        usingCache: true,
        isStale,
      });
    }

    // Then verify with Supabase in background
    loadScanCache().then((cached) => {
      if (!mountedRef.current) return;
      if (cached && cached.themes.length > 0) {
        setState({
          themes: getProcessedThemes(cached.themes),
          isLoading: false,
          isLive: true,
          lastFetched: new Date(cached.scannedAt),
          rateLimited: false,
          symbolsFetched: cached.symbolsFetched,
          usingCache: true,
          isStale: cached.isStale,
        });
        // Sync to localStorage
        saveLocalScanCache({
          themes: cached.themes,
          scannedAt: cached.scannedAt,
          timeframe: cached.timeframe,
          symbolsFetched: cached.symbolsFetched,
        });
      }
    });
  }, []);

  // ── Restore from cache on tab focus ──
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      
      // Instant: check localStorage
      const local = loadLocalScanCache();
      if (local && local.themes.length > 0 && mountedRef.current) {
        const age = Date.now() - new Date(local.scannedAt).getTime();
        setState({
          themes: getProcessedThemes(local.themes),
          isLoading: false,
          isLive: true,
          lastFetched: new Date(local.scannedAt),
          rateLimited: false,
          symbolsFetched: local.symbolsFetched,
          usingCache: true,
          isStale: age > 24 * 60 * 60 * 1000,
        });
      }

      // Verify with Supabase
      loadScanCache().then((cached) => {
        if (!mountedRef.current) return;
        if (cached && cached.themes.length > 0) {
          setState({
            themes: getProcessedThemes(cached.themes),
            isLoading: false,
            isLive: true,
            lastFetched: new Date(cached.scannedAt),
            rateLimited: false,
            symbolsFetched: cached.symbolsFetched,
            usingCache: true,
            isStale: cached.isStale,
          });
          saveLocalScanCache({
            themes: cached.themes,
            scannedAt: cached.scannedAt,
            timeframe: cached.timeframe,
            symbolsFetched: cached.symbolsFetched,
          });
        }
      });
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);

  // Accept scan results for a specific timeframe
  const setScanResults = useCallback((themes: ThemeData[], tf: string) => {
    if (!mountedRef.current) return;

    const processed = getProcessedThemes(themes);
    const totalSymbols = themes.reduce((sum, t) => sum + t.tickers.filter(tk => !tk.skipped).length, 0);

    // Save to both localStorage and Supabase
    saveScanCache(themes, tf, totalSymbols);

    // Only update UI if currently viewing this timeframe
    if (timeframeRef.current !== tf) return;

    setState({
      themes: processed,
      isLoading: false,
      isLive: true,
      lastFetched: new Date(),
      rateLimited: false,
      symbolsFetched: totalSymbols,
      usingCache: false,
      isStale: false,
    });
  }, []);

  const fetchLiveData = useCallback(async (themeNames?: string[]) => {
    setState((prev) => ({ ...prev, isLoading: true }));
    const tf = timeframeRef.current;

    try {
      const params: Record<string, string> = { timeframe: tf };
      if (themeNames?.length) params.themes = themeNames.join(",");
      const queryString = new URLSearchParams(params).toString();

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("Config missing");

      const url = `${supabaseUrl}/functions/v1/fetch-themes?${queryString}`;
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

      const currentThemes = themesRef.current;
      const mergedMap = new Map<string, ThemeData>();
      for (const t of currentThemes) mergedMap.set(t.theme_name, t);
      for (const t of liveThemes) mergedMap.set(t.theme_name, t);

      const merged = Array.from(mergedMap.values());
      const processed = getProcessedThemes(merged);
      const fetchedAt = result.fetched_at || new Date().toISOString();

      // Save to both layers
      const totalSymbols = result.symbols_fetched || 0;
      saveScanCache(merged, tf, totalSymbols);

      if (!mountedRef.current) return;

      setState({
        themes: processed,
        isLoading: false,
        isLive: true,
        lastFetched: new Date(fetchedAt),
        rateLimited: result.rate_limited || false,
        symbolsFetched: totalSymbols,
        usingCache: false,
        isStale: false,
      });

      if (result.rate_limited) {
        toast({ title: "Rate Limited", description: "Some data may be stale.", variant: "destructive" });
      } else {
        toast({ title: "Live Data Loaded", description: `${result.symbols_fetched} symbols · ${tf}` });
      }
    } catch (err) {
      console.error("Failed to fetch live data:", err);
      if (!mountedRef.current) return;
      setState((prev) => ({ ...prev, isLoading: false }));
      toast({ title: "Failed to fetch live data", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    }
  }, [toast]);

  const resetToDemo = useCallback(() => {
    clearLocalScanCache();
    setState({ ...DEMO_STATE, themes: getProcessedThemes(demoThemes) });
  }, []);

  return {
    ...state,
    fetchLiveData,
    resetToDemo,
    setScanResults,
  };
}
