import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ThemeIntelData {
  themeId: string;
  themeName: string;
  description: string | null;
  symbols: string[];
  primaryTicker: string;
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
  hasEodHistory: boolean; // true if 1W/1M data is meaningful (not all zeros)
  sparklineData: number[]; // last 7 daily close prices for primary ticker
  momentumScore: number;
  breadthUp: number;
  breadthTotal: number;
  label: "Breaking Out" | "Losing Steam" | "Consolidating" | "Accelerating" | "Recovering" | "Fading";
}

function computeMomentumScore(perf1d: number, perf1w: number, perf1m: number): number {
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

      // Determine primary ticker per theme (first symbol with "done" status)
      // and collect all primary tickers for sparkline query
      const primaryTickers: string[] = [];
      const themeEntries: { id: string; name: string; description: string | null; symbols: string[]; primaryTicker: string }[] = [];

      for (const t of themesRes.data) {
        const symbols = themeSymbols.get(t.id) || [];
        if (symbols.length === 0) continue;
        // Pick the first "done" ticker as primary, fallback to first symbol
        const primary = symbols.find(s => perfMap.get(s)?.status === "done") || symbols[0];
        primaryTickers.push(primary);
        themeEntries.push({ id: t.id, name: t.name, description: t.description, symbols, primaryTicker: primary });
      }

      // Fetch sparkline data: last 7 distinct dates of eod_prices for primary tickers
      const sparklineMap = new Map<string, number[]>();
      if (primaryTickers.length > 0) {
        const { data: eodData } = await supabase
          .from("eod_prices")
          .select("symbol, date, close_price")
          .in("symbol", primaryTickers)
          .order("date", { ascending: false })
          .limit(primaryTickers.length * 10); // rough upper bound

        if (eodData) {
          // Group by symbol, take last 7 dates
          const bySymbol = new Map<string, { date: string; close: number }[]>();
          for (const row of eodData) {
            const arr = bySymbol.get(row.symbol) || [];
            arr.push({ date: row.date, close: row.close_price });
            bySymbol.set(row.symbol, arr);
          }
          for (const [symbol, rows] of bySymbol) {
            // Already sorted desc, take first 7 then reverse for chronological
            const last7 = rows.slice(0, 7).reverse();
            sparklineMap.set(symbol, last7.map(r => r.close));
          }
        }
      }

      // Check if any ticker has non-zero 1W or 1M data
      const hasAnyHistorical = perfRes.data.some(
        p => (p.perf_1w !== null && p.perf_1w !== 0) || (p.perf_1m !== null && p.perf_1m !== 0)
      );

      // Build ThemeIntelData
      const result: ThemeIntelData[] = [];
      for (const entry of themeEntries) {
        const tickers = entry.symbols.map(s => {
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

        // Check if this specific theme has non-zero historical data
        const themeHasHistory = hasAnyHistorical && valid.some(
          tk => (tk.perf_1w !== 0) || (tk.perf_1m !== 0)
        );

        result.push({
          themeId: entry.id,
          themeName: entry.name,
          description: entry.description,
          symbols: entry.symbols,
          primaryTicker: entry.primaryTicker,
          tickers,
          perf_1d,
          perf_1w,
          perf_1m,
          hasEodHistory: themeHasHistory,
          sparklineData: sparklineMap.get(entry.primaryTicker) || [],
          momentumScore: computeMomentumScore(perf_1d, perf_1w, perf_1m),
          breadthUp,
          breadthTotal: valid.length,
          label: getLabel(perf_1d, perf_1w, perf_1m),
        });
      }

      // Normalize momentum scores to 0-100
      const normalized = normalizeMomentumScores(result);
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

  const accelerating = themes.filter(t => t.perf_1d > t.perf_1m);
  const fading = themes.filter(t => t.perf_1m > 0 && t.perf_1d < t.perf_1m);

  return { themes, accelerating, fading, isLoading, refetch: fetchData };
}
