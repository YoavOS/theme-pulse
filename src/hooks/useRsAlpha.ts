import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Filter thresholds (easy to adjust) ──
export const RS_FILTER_THRESHOLDS = {
  MIN_MARKET_CAP: 1000,        // $1B in Finnhub units (millions)
  MIN_DOLLAR_VOLUME: 10_000_000, // $10M average daily dollar volume
  MIN_AVG_DAILY_RANGE: 3,       // 3% average daily range
  MIN_PRICE: 6,                 // $6 minimum price
};

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
  marketCap: number | null;
  avgDollarVolume: number | null;
  avgDailyRange: number | null;
}

export interface RsFilterStats {
  totalBeforeFilter: number;
  passedFilter: number;
  filteredByMarketCap: number;
  filteredByDollarVol: number;
  filteredByRange: number;
  filteredByPrice: number;
}

export function useRsAlpha() {
  const [stocks, setStocks] = useState<RsStock[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [lastCalculated, setLastCalculated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterStats, setFilterStats] = useState<RsFilterStats | null>(null);

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

      const allSymbols = [...new Set(tickerThemeMap.keys())];

      // 2. Get current prices from ticker_performance
      const priceMap = new Map<string, number>();
      for (let i = 0; i < allSymbols.length; i += 500) {
        const batch = allSymbols.slice(i, i + 500);
        const { data } = await supabase
          .from("ticker_performance")
          .select("symbol, price")
          .in("symbol", batch);
        if (data) {
          for (const p of data) {
            if (p.price && p.price > 0) priceMap.set(p.symbol, p.price);
          }
        }
      }

      // Also get SPY price
      const { data: spyRow } = await supabase
        .from("ticker_performance")
        .select("price")
        .eq("symbol", "SPY")
        .maybeSingle();
      const spyPrice = spyRow?.price ?? 0;

      // 3. Get filter data: market cap from fundamentals_cache
      const mcMap = new Map<string, number>();
      const { data: fundData } = await supabase
        .from("fundamentals_cache")
        .select("symbol, market_cap");
      if (fundData) {
        for (const f of fundData) {
          if (f.market_cap !== null) mcMap.set(f.symbol, f.market_cap);
        }
      }

      // 4. Get volume data from ticker_volume_cache
      const volMap = new Map<string, number>(); // avg shares per day
      for (let i = 0; i < allSymbols.length; i += 500) {
        const batch = allSymbols.slice(i, i + 500);
        const { data } = await supabase
          .from("ticker_volume_cache")
          .select("symbol, avg_20d")
          .in("symbol", batch);
        if (data) {
          for (const v of data) {
            if (v.avg_20d && v.avg_20d > 0) volMap.set(v.symbol, v.avg_20d);
          }
        }
      }

      // 5. Calculate avg daily range from eod_prices (consecutive close diffs)
      const rangeMap = new Map<string, number>();
      const now = new Date();
      const date30 = new Date(now);
      date30.setDate(date30.getDate() - 45); // fetch ~45 days to get ~30 trading days
      const date30Str = date30.toISOString().split("T")[0];

      for (let i = 0; i < allSymbols.length; i += 500) {
        const batch = allSymbols.slice(i, i + 500);
        const { data: eodRows } = await supabase
          .from("eod_prices")
          .select("symbol, close_price, date")
          .in("symbol", batch)
          .gte("date", date30Str)
          .order("symbol")
          .order("date", { ascending: true });

        if (eodRows && eodRows.length > 0) {
          // Group by symbol
          const grouped = new Map<string, number[]>();
          for (const row of eodRows) {
            if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
            grouped.get(row.symbol)!.push(Number(row.close_price));
          }
          for (const [sym, prices] of grouped) {
            if (prices.length < 2) continue;
            let totalRange = 0;
            let count = 0;
            for (let j = 1; j < prices.length; j++) {
              if (prices[j - 1] > 0) {
                totalRange += Math.abs(prices[j] - prices[j - 1]) / prices[j - 1] * 100;
                count++;
              }
            }
            if (count > 0) rangeMap.set(sym, Math.round(totalRange / count * 100) / 100);
          }
        }
      }

      // 6. Apply filters
      const stats: RsFilterStats = {
        totalBeforeFilter: allSymbols.length,
        passedFilter: 0,
        filteredByMarketCap: 0,
        filteredByDollarVol: 0,
        filteredByRange: 0,
        filteredByPrice: 0,
      };

      const filteredSymbols: string[] = [];
      for (const sym of allSymbols) {
        const price = priceMap.get(sym);
        if (!price || price < RS_FILTER_THRESHOLDS.MIN_PRICE) {
          stats.filteredByPrice++;
          continue;
        }

        const mc = mcMap.get(sym);
        if (mc !== undefined && mc < RS_FILTER_THRESHOLDS.MIN_MARKET_CAP) {
          stats.filteredByMarketCap++;
          continue;
        }

        const avgVol = volMap.get(sym);
        if (avgVol !== undefined) {
          const dollarVol = avgVol * price;
          if (dollarVol < RS_FILTER_THRESHOLDS.MIN_DOLLAR_VOLUME) {
            stats.filteredByDollarVol++;
            continue;
          }
        }

        const avgRange = rangeMap.get(sym);
        if (avgRange !== undefined && avgRange < RS_FILTER_THRESHOLDS.MIN_AVG_DAILY_RANGE) {
          stats.filteredByRange++;
          continue;
        }

        filteredSymbols.push(sym);
      }
      stats.passedFilter = filteredSymbols.length;
      setFilterStats(stats);

      // 7. Calculate returns from eod_prices using get_eod_baselines
      const symbolsWithSpy = [...filteredSymbols, "SPY"];
      const d1w = new Date(now); d1w.setDate(d1w.getDate() - 7);
      const d1m = new Date(now); d1m.setDate(d1m.getDate() - 35);
      const d3m = new Date(now); d3m.setDate(d3m.getDate() - 100);
      const d6m = new Date(now); d6m.setDate(d6m.getDate() - 190);
      const dYtd = new Date(now.getFullYear(), 0, 1);

      // Fetch baselines in batches of 500 (RPC doesn't support huge arrays well)
      const baselineMap = new Map<string, { tf: string; price: number }[]>();
      for (let i = 0; i < symbolsWithSpy.length; i += 500) {
        const batch = symbolsWithSpy.slice(i, i + 500);
        const { data: baselines, error: blErr } = await supabase.rpc("get_eod_baselines", {
          p_symbols: batch,
          p_date_1w: d1w.toISOString().split("T")[0],
          p_date_1m: d1m.toISOString().split("T")[0],
          p_date_3m: d3m.toISOString().split("T")[0],
          p_date_ytd: d6m.toISOString().split("T")[0], // use p_date_ytd param for 6M
        });
        if (blErr) {
          console.error("Baseline fetch error:", blErr);
          continue;
        }
        if (baselines) {
          for (const b of baselines as { symbol: string; timeframe: string; close_price: number }[]) {
            if (!baselineMap.has(b.symbol)) baselineMap.set(b.symbol, []);
            baselineMap.get(b.symbol)!.push({ tf: b.timeframe, price: Number(b.close_price) });
          }
        }
      }

      // Helper to calc return
      const calcReturn = (sym: string, timeframe: string): number | null => {
        const currentPrice = sym === "SPY" ? spyPrice : priceMap.get(sym);
        if (!currentPrice) return null;
        const baselines = baselineMap.get(sym);
        if (!baselines) return null;
        const bl = baselines.find(b => b.tf === timeframe);
        if (!bl || bl.price <= 0) return null;
        return Math.round(((currentPrice - bl.price) / bl.price) * 10000) / 100;
      };

      // SPY returns
      const spyReturn1m = calcReturn("SPY", "1M");
      const spyReturn3m = calcReturn("SPY", "3M");
      const spyReturn6m = calcReturn("SPY", "YTD"); // we used p_date_ytd for 6M

      // 8. Build RS stocks
      const results: RsStock[] = [];
      for (const symbol of filteredSymbols) {
        const themeName = tickerThemeMap.get(symbol) || "";
        const price = priceMap.get(symbol) ?? null;

        const r1m = calcReturn(symbol, "1M");
        const r3m = calcReturn(symbol, "3M");
        const r6m = calcReturn(symbol, "YTD"); // we used p_date_ytd for 6M

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

        const avgVol = volMap.get(symbol);
        const dollarVol = avgVol && price ? avgVol * price : null;

        results.push({
          symbol,
          themeName,
          price,
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
          marketCap: mcMap.get(symbol) ?? null,
          avgDollarVolume: dollarVol,
          avgDailyRange: rangeMap.get(symbol) ?? null,
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

  return { stocks, isCalculating, lastCalculated, error, filterStats, calculateRs };
}
