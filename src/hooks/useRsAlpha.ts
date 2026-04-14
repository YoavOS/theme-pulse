import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RsStock {
  symbol: string;
  themeName: string;
  price: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  spyReturn1m: number | null;
  spyReturn3m: number | null;
  spyReturn6m: number | null;
  rs1m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  rsOverall: number | null;
}

export function useRsAlpha() {
  const [stocks, setStocks] = useState<RsStock[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [lastCalculated, setLastCalculated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const calculateRs = useCallback(async () => {
    setIsCalculating(true);
    setError(null);

    try {
      // 1. Get all tickers and their themes
      const { data: themes } = await supabase.from("themes").select("id, name");
      const { data: themeTickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");
      if (!themes || !themeTickers) throw new Error("Failed to load theme data");

      const themeMap = new Map(themes.map(t => [t.id, t.name]));
      const tickerThemeMap = new Map<string, string>();
      for (const tt of themeTickers) {
        const name = themeMap.get(tt.theme_id);
        if (name && name !== "__BENCHMARK__") {
          tickerThemeMap.set(tt.ticker_symbol, name);
        }
      }

      // 2. Get current prices and scan-based perf from ticker_performance
      const allSymbols = [...new Set(tickerThemeMap.keys())];
      // Fetch in pages of 1000
      const perfMap = new Map<string, { price: number; perf_1m: number; perf_3m: number }>();
      for (let i = 0; i < allSymbols.length; i += 500) {
        const batch = allSymbols.slice(i, i + 500);
        const { data: perfData } = await supabase
          .from("ticker_performance")
          .select("symbol, price, perf_1m, perf_3m")
          .in("symbol", batch);
        if (perfData) {
          for (const p of perfData) {
            perfMap.set(p.symbol, {
              price: p.price ?? 0,
              perf_1m: p.perf_1m ?? 0,
              perf_3m: p.perf_3m ?? 0,
            });
          }
        }
      }

      // 3. Get SPY performance
      const { data: spyPerf } = await supabase
        .from("ticker_performance")
        .select("price, perf_1m, perf_3m")
        .eq("symbol", "SPY")
        .single();

      const spyReturn1m = spyPerf?.perf_1m ?? null;
      const spyReturn3m = spyPerf?.perf_3m ?? null;

      // 4. Calculate 6M returns from eod_prices if available
      const now = new Date();
      const date6m = new Date(now);
      date6m.setDate(date6m.getDate() - 180);
      const date6mStr = date6m.toISOString().split("T")[0];

      // Get 6M baseline prices for all symbols + SPY
      const symbolsFor6m = [...allSymbols, "SPY"];
      const return6mMap = new Map<string, number>();

      // Fetch baselines in batches
      for (let i = 0; i < symbolsFor6m.length; i += 500) {
        const batch = symbolsFor6m.slice(i, i + 500);
        const { data: baselines } = await supabase
          .from("eod_prices")
          .select("symbol, close_price, date")
          .in("symbol", batch)
          .lte("date", date6mStr)
          .order("date", { ascending: false });

        if (baselines) {
          // Get most recent price on or before date6m per symbol
          const seen = new Set<string>();
          for (const row of baselines) {
            if (seen.has(row.symbol)) continue;
            seen.add(row.symbol);
            const currentPrice = row.symbol === "SPY"
              ? (spyPerf?.price ?? 0)
              : (perfMap.get(row.symbol)?.price ?? 0);
            if (currentPrice && row.close_price) {
              const pct = Math.round(((currentPrice - Number(row.close_price)) / Number(row.close_price)) * 10000) / 100;
              return6mMap.set(row.symbol, pct);
            }
          }
        }
      }

      const spyReturn6m = return6mMap.get("SPY") ?? null;

      // 5. Build RS stocks
      const results: RsStock[] = [];
      for (const [symbol, themeName] of tickerThemeMap) {
        const perf = perfMap.get(symbol);
        if (!perf) continue;

        const r1m = perf.perf_1m || null;
        const r3m = perf.perf_3m || null;
        const r6m = return6mMap.get(symbol) ?? null;

        const rs1m = r1m !== null && spyReturn1m !== null
          ? Math.round((r1m - spyReturn1m) * 100) / 100 : null;
        const rs3m = r3m !== null && spyReturn3m !== null
          ? Math.round((r3m - spyReturn3m) * 100) / 100 : null;
        const rs6m = r6m !== null && spyReturn6m !== null
          ? Math.round((r6m - spyReturn6m) * 100) / 100 : null;

        // Overall = 50% 1M + 30% 3M + 20% 6M
        let rsOverall: number | null = null;
        const parts: { val: number; weight: number }[] = [];
        if (rs1m !== null) parts.push({ val: rs1m, weight: 0.5 });
        if (rs3m !== null) parts.push({ val: rs3m, weight: 0.3 });
        if (rs6m !== null) parts.push({ val: rs6m, weight: 0.2 });

        if (parts.length > 0) {
          const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
          rsOverall = Math.round(parts.reduce((s, p) => s + p.val * (p.weight / totalWeight), 0) * 100) / 100;
        }

        results.push({
          symbol,
          themeName,
          price: perf.price || null,
          return1m: r1m,
          return3m: r3m,
          return6m: r6m,
          spyReturn1m,
          spyReturn3m,
          spyReturn6m,
          rs1m,
          rs3m,
          rs6m,
          rsOverall,
        });
      }

      setStocks(results);
      setLastCalculated(new Date());
    } catch (err) {
      console.error("RS calculation error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCalculating(false);
    }
  }, []);

  return { stocks, isCalculating, lastCalculated, error, calculateRs };
}
