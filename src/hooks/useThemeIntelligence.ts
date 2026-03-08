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
  hasEodHistory: boolean;
  sparklineData: number[];
  momentumScore: number;
  breadthUp: number;
  breadthTotal: number;
  label: "Breaking Out" | "Breaking Out (low vol)" | "Losing Steam" | "Consolidating" | "Accelerating" | "Recovering" | "Fading" | "Fading Hard";
  // Volume
  avgRelVol: number | null;
  sustainedVol: number | null;
  volumeSpikingUp: number;
  volumeSpikingDown: number;
}

interface VolCacheRow {
  symbol: string;
  today_vol: number | null;
  avg_20d: number | null;
  avg_10d: number | null;
  avg_3m: number | null;
}

function computeMomentumScore(perf1d: number, perf1w: number, perf1m: number, avgRelVol: number | null): number {
  const volumeBoost = avgRelVol !== null
    ? (avgRelVol > 1.8 ? 1.15 : avgRelVol > 1.4 ? 1.08 : avgRelVol < 0.8 ? 0.92 : 1.0)
    : 1.0;
  const raw = (perf1d * 0.20 + perf1w * 0.35 + perf1m * 0.45) * volumeBoost;
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

function getLabel(perf1d: number, perf1w: number, perf1m: number, avgRelVol: number | null): ThemeIntelData["label"] {
  const highVol = avgRelVol !== null && avgRelVol > 1.4;
  const lowVol = avgRelVol !== null && avgRelVol < 0.8;

  if (perf1d > 2 && perf1d > perf1m) {
    return highVol ? "Breaking Out" : "Breaking Out (low vol)";
  }
  if (perf1d > 0 && perf1d > perf1m) return "Accelerating";
  if (perf1m > 2 && perf1d < perf1m * 0.5) return "Losing Steam";
  if (perf1m > 0 && perf1d < 0) {
    return (highVol && perf1d < -1) ? "Fading Hard" : "Fading";
  }
  if (perf1d > 0 && perf1m < 0) return "Recovering";
  return "Consolidating";
}

function computeThemeVolume(symbols: string[], volMap: Map<string, VolCacheRow>): {
  avgRelVol: number | null;
  sustainedVol: number | null;
  spikingUp: number;
  spikingDown: number;
} {
  const vols = symbols.map(s => volMap.get(s)).filter((v): v is VolCacheRow =>
    !!v && ((v.avg_10d ?? 0) > 0 || (v.avg_3m ?? 0) > 0)
  );

  if (vols.length === 0) return { avgRelVol: null, sustainedVol: null, spikingUp: 0, spikingDown: 0 };

  // Rel Vol
  const relVols = vols.filter(v => (v.avg_20d ?? 0) > 0 && (v.today_vol ?? 0) > 0)
    .map(v => (v.today_vol! / v.avg_20d!));
  const avgRelVol = relVols.length > 0
    ? Math.round((relVols.reduce((a, b) => a + b, 0) / relVols.length) * 100) / 100
    : null;

  // Sustained Vol
  const susVols = vols.filter(v => (v.avg_3m ?? 0) > 0 && (v.avg_10d ?? 0) > 0)
    .map(v => ((v.avg_10d! / v.avg_3m!) - 1) * 100);
  const sustainedVol = susVols.length > 0
    ? Math.round((susVols.reduce((a, b) => a + b, 0) / susVols.length) * 100) / 100
    : null;

  // Spikes
  let spikingUp = 0, spikingDown = 0;
  for (const v of vols) {
    if ((v.avg_20d ?? 0) <= 0 || (v.today_vol ?? 0) <= 0) continue;
    const change = ((v.today_vol! - v.avg_20d!) / v.avg_20d!) * 100;
    if (change > 30) spikingUp++;
    else if (change < -30) spikingDown++;
  }

  return { avgRelVol, sustainedVol, spikingUp, spikingDown };
}

export function useThemeIntelligence() {
  const [themes, setThemes] = useState<ThemeIntelData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all tables in parallel (including volume cache)
      const [themesRes, tickersRes, perfRes, volRes] = await Promise.all([
        supabase.from("themes").select("id, name, description"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_performance").select("symbol, perf_1d, perf_1w, perf_1m, perf_3m, perf_ytd, price, status"),
        supabase.from("ticker_volume_cache").select("symbol, today_vol, avg_20d, avg_10d, avg_3m"),
      ]);

      if (!themesRes.data || !tickersRes.data || !perfRes.data) return;

      // Build volume map
      const volMap = new Map<string, VolCacheRow>();
      if (volRes.data) {
        for (const v of volRes.data) volMap.set(v.symbol, v as VolCacheRow);
      }

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

      const primaryTickers: string[] = [];
      const themeEntries: { id: string; name: string; description: string | null; symbols: string[]; primaryTicker: string }[] = [];

      for (const t of themesRes.data) {
        const symbols = themeSymbols.get(t.id) || [];
        if (symbols.length === 0) continue;
        const primary = symbols.find(s => perfMap.get(s)?.status === "done") || symbols[0];
        primaryTickers.push(primary);
        themeEntries.push({ id: t.id, name: t.name, description: t.description, symbols, primaryTicker: primary });
      }

      // Fetch sparkline data
      const sparklineMap = new Map<string, number[]>();
      if (primaryTickers.length > 0) {
        const { data: eodData } = await supabase
          .from("eod_prices")
          .select("symbol, date, close_price")
          .in("symbol", primaryTickers)
          .order("date", { ascending: false })
          .limit(primaryTickers.length * 10);

        if (eodData) {
          const bySymbol = new Map<string, { date: string; close: number }[]>();
          for (const row of eodData) {
            const arr = bySymbol.get(row.symbol) || [];
            arr.push({ date: row.date, close: row.close_price });
            bySymbol.set(row.symbol, arr);
          }
          for (const [symbol, rows] of bySymbol) {
            const last7 = rows.slice(0, 7).reverse();
            sparklineMap.set(symbol, last7.map(r => r.close));
          }
        }
      }

      const hasAnyHistorical = perfRes.data.some(
        p => (p.perf_1w !== null && p.perf_1w !== 0) || (p.perf_1m !== null && p.perf_1m !== 0)
      );

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

        const themeHasHistory = hasAnyHistorical && valid.some(
          tk => (tk.perf_1w !== 0) || (tk.perf_1m !== 0)
        );

        // Compute volume signals for this theme
        const vol = computeThemeVolume(entry.symbols, volMap);

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
          momentumScore: computeMomentumScore(perf_1d, perf_1w, perf_1m, vol.avgRelVol),
          breadthUp,
          breadthTotal: valid.length,
          label: getLabel(perf_1d, perf_1w, perf_1m, vol.avgRelVol),
          avgRelVol: vol.avgRelVol,
          sustainedVol: vol.sustainedVol,
          volumeSpikingUp: vol.spikingUp,
          volumeSpikingDown: vol.spikingDown,
        });
      }

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
