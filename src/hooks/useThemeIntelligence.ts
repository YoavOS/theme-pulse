import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThemeIntelData {
  themeId: string;
  themeName: string;
  description: string | null;
  symbols: string[];
  tickers: {
    symbol: string;
    perf_1d: number;
    perf_1w: number;
    perf_1m: number;
    perf_3m: number;
    perf_ytd: number;
    price: number;
    status: string;
  }[];
  // Computed
  perf_1d: number;
  perf_1w: number;
  perf_1m: number;
  momentumScore: number;
  breadthUp: number;
  breadthTotal: number;
  label: "Breaking Out" | "Losing Steam" | "Consolidating" | "Accelerating" | "Recovering" | "Fading";
}

function computeMomentumScore(perf1d: number, perf1w: number, perf1m: number): number {
  // Raw weighted score
  const raw = perf1d * 0.20 + perf1w * 0.35 + perf1m * 0.45;
  return raw;
}

function normalizeMomentumScores(themes: ThemeIntelData[]): ThemeIntelData[] {
  if (themes.length === 0) return themes;
  const raws = themes.map(t => t.momentumScore);
  const min = Math.min(...raws);
  const max = Math.max(...raws);
  const range = max - min || 1;
  return themes.map(t => ({
    ...t,
    momentumScore: Math.round(((t.momentumScore - min) / range) * 100),
  }));
}

function getLabel(perf1d: number, perf1w: number, perf1m: number): ThemeIntelData["label"] {
  if (perf1d > 2 && perf1d > perf1m) return "Breaking Out";
  if (perf1d > 0 && perf1d > perf1m) return "Accelerating";
  if (perf1m > 2 && perf1d < perf1m * 0.5) return "Losing Steam";
  if (perf1m > 0 && perf1d < 0) return "Fading";
  if (perf1d > 0 && perf1m < 0) return "Recovering";
  return "Consolidating";
}

export function useThemeIntelligence() {
  const [themes, setThemes] = useState<ThemeIntelData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all three tables in parallel
      const [themesRes, tickersRes, perfRes] = await Promise.all([
        supabase.from("themes").select("id, name, description"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_performance").select("symbol, perf_1d, perf_1w, perf_1m, perf_3m, perf_ytd, price, status"),
      ]);

      if (!themesRes.data || !tickersRes.data || !perfRes.data) return;

      // Build perf map
      const perfMap = new Map<string, typeof perfRes.data[0]>();
      for (const p of perfRes.data) perfMap.set(p.symbol, p);

      // Build theme -> symbols map
      const themeSymbols = new Map<string, string[]>();
      for (const tk of tickersRes.data) {
        const arr = themeSymbols.get(tk.theme_id) || [];
        arr.push(tk.ticker_symbol);
        themeSymbols.set(tk.theme_id, arr);
      }

      // Build ThemeIntelData
      const result: ThemeIntelData[] = [];
      for (const t of themesRes.data) {
        const symbols = themeSymbols.get(t.id) || [];
        if (symbols.length === 0) continue;

        const tickers = symbols.map(s => {
          const p = perfMap.get(s);
          return {
            symbol: s,
            perf_1d: p?.perf_1d || 0,
            perf_1w: p?.perf_1w || 0,
            perf_1m: p?.perf_1m || 0,
            perf_3m: p?.perf_3m || 0,
            perf_ytd: p?.perf_ytd || 0,
            price: p?.price || 0,
            status: p?.status || "pending",
          };
        });

        const valid = tickers.filter(tk => tk.status === "done");
        if (valid.length === 0) continue;

        const avg = (field: "perf_1d" | "perf_1w" | "perf_1m") =>
          Math.round((valid.reduce((s, tk) => s + tk[field], 0) / valid.length) * 100) / 100;

        const perf_1d = avg("perf_1d");
        const perf_1w = avg("perf_1w");
        const perf_1m = avg("perf_1m");
        const breadthUp = valid.filter(tk => tk.perf_1d > 0).length;

        result.push({
          themeId: t.id,
          themeName: t.name,
          description: t.description,
          symbols,
          tickers,
          perf_1d,
          perf_1w,
          perf_1m,
          momentumScore: computeMomentumScore(perf_1d, perf_1w, perf_1m),
          breadthUp,
          breadthTotal: valid.length,
          label: getLabel(perf_1d, perf_1w, perf_1m),
        });
      }

      // Normalize momentum scores to 0-100
      const normalized = normalizeMomentumScores(result);
      // Sort by momentum score desc
      normalized.sort((a, b) => b.momentumScore - a.momentumScore);

      setThemes(normalized);
    } catch (err) {
      console.error("Theme intelligence fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Derived data
  const accelerating = themes.filter(t => t.perf_1d > t.perf_1m);
  const fading = themes.filter(t => t.perf_1m > 0 && t.perf_1d < t.perf_1m);

  return { themes, accelerating, fading, isLoading, refetch: fetchData };
}
