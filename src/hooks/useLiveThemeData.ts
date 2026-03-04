import { useState, useCallback } from "react";

import { ThemeData, demoThemes, getProcessedThemes } from "@/data/themeData";
import { useToast } from "@/hooks/use-toast";

interface LiveDataState {
  themes: ThemeData[];
  isLoading: boolean;
  isLive: boolean;
  lastFetched: Date;
  rateLimited: boolean;
  symbolsFetched: number;
}

export function useLiveThemeData() {
  const { toast } = useToast();
  const [state, setState] = useState<LiveDataState>({
    themes: getProcessedThemes(demoThemes),
    isLoading: false,
    isLive: false,
    lastFetched: new Date(),
    rateLimited: false,
    symbolsFetched: 0,
  });

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

      // Merge live data with demo themes (for themes not fetched live)
      const liveThemeMap = new Map<string, ThemeData>();
      for (const t of result.themes) {
        liveThemeMap.set(t.theme_name, t);
      }

      const merged = demoThemes.map(demo => {
        const live = liveThemeMap.get(demo.theme_name);
        if (live) {
          return {
            ...demo,
            performance_pct: live.performance_pct,
            up_count: live.up_count,
            down_count: live.down_count,
            tickers: live.tickers,
          };
        }
        return demo;
      });

      const processed = getProcessedThemes(merged);

      setState({
        themes: processed,
        isLoading: false,
        isLive: true,
        lastFetched: new Date(result.fetched_at),
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
      setState(prev => ({ ...prev, isLoading: false }));
      toast({
        title: "Failed to fetch live data",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [toast]);

  const resetToDemo = useCallback(() => {
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
