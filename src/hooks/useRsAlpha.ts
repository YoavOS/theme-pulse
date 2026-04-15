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
  source1m?: string;
  source3m?: string;
  source6m?: string;
}

export interface RsFilterStats {
  totalBeforeFilter: number;
  passedFilter: number;
  filteredByMarketCap: number;
  filteredByDollarVol: number;
  filteredByRange: number;
  filteredByPrice: number;
  universeSource: "themes" | "universe_table";
}

export interface UniverseScanStatus {
  isScanning: boolean;
  progress: string;
  lastScanned: Date | null;
  totalInUniverse: number;
}

export function useRsAlpha() {
  const [stocks, setStocks] = useState<RsStock[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [lastCalculated, setLastCalculated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterStats, setFilterStats] = useState<RsFilterStats | null>(null);
  const [universeScan, setUniverseScan] = useState<UniverseScanStatus>({
    isScanning: false, progress: "", lastScanned: null, totalInUniverse: 0,
  });

  // ── Get symbols: prefer rs_stock_universe table, fallback to theme tickers ──
  const getSymbolUniverse = useCallback(async (): Promise<{
    symbols: string[];
    themeMap: Map<string, string>;
    source: "themes" | "universe_table";
  }> => {
    // Try universe table first
    const { data: uniData, count } = await supabase
      .from("rs_stock_universe")
      .select("symbol, company_name, market_cap, current_price, sector", { count: "exact" })
      .eq("qualified", true);

    if (uniData && uniData.length > 50) {
      // Use universe table — build a pseudo theme map from sectors
      const themeMap = new Map<string, string>();
      for (const u of uniData) {
        themeMap.set(u.symbol, u.sector || "Unknown");
      }
      setUniverseScan(prev => ({ ...prev, totalInUniverse: uniData.length }));
      return { symbols: uniData.map(u => u.symbol), themeMap, source: "universe_table" };
    }

    // Fallback to theme tickers
    const { data: themes } = await supabase.from("themes").select("id, name");
    const { data: themeTickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");
    if (!themes || !themeTickers) throw new Error("Failed to load theme data");

    const idToName = new Map(themes.map(t => [t.id, t.name]));
    const themeMap = new Map<string, string>();
    for (const tt of themeTickers) {
      const name = idToName.get(tt.theme_id);
      if (name && name !== "__BENCHMARK__") {
        themeMap.set(tt.ticker_symbol, name);
      }
    }
    return { symbols: [...new Set(themeMap.keys())], themeMap, source: "themes" };
  }, []);

  // ── Fetch Yahoo history for symbols missing local data ──
  const fetchYahooReturns = useCallback(async (
    symbols: string[],
    periods: string[] = ["1mo", "3mo", "6mo"]
  ): Promise<Map<string, Record<string, { returnPct: number | null; source: string }>>> => {
    const resultMap = new Map<string, Record<string, { returnPct: number | null; source: string }>>();
    
    // Process in batches of 20 (edge function limit)
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("fetch-yahoo-history", {
          body: { symbols: batch, periods },
        });
        if (fnErr) {
          console.error("Yahoo history error:", fnErr);
          continue;
        }
        if (data?.results) {
          for (const [sym, periodData] of Object.entries(data.results as Record<string, any>)) {
            const symResults: Record<string, { returnPct: number | null; source: string }> = {};
            for (const [period, vals] of Object.entries(periodData as Record<string, any>)) {
              symResults[period] = { returnPct: vals.returnPct, source: vals.source || "yahoo" };
            }
            resultMap.set(sym, symResults);
          }
        }
      } catch (e) {
        console.error("Yahoo batch error:", e);
      }
    }
    return resultMap;
  }, []);

  // ── Main RS calculation ──
  const calculateRs = useCallback(async () => {
    setIsCalculating(true);
    setError(null);

    try {
      // 1. Get symbol universe
      const { symbols: allSymbols, themeMap: tickerThemeMap, source: universeSource } = await getSymbolUniverse();

      // 2. Get current prices
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

      // If using universe table, also pull prices from rs_stock_universe for symbols not in ticker_performance
      if (universeSource === "universe_table") {
        const { data: uniPrices } = await supabase
          .from("rs_stock_universe")
          .select("symbol, current_price")
          .eq("qualified", true);
        if (uniPrices) {
          for (const u of uniPrices) {
            if (!priceMap.has(u.symbol) && u.current_price && u.current_price > 0) {
              priceMap.set(u.symbol, Number(u.current_price));
            }
          }
        }
      }

      // SPY price
      const { data: spyRow } = await supabase
        .from("ticker_performance")
        .select("price")
        .eq("symbol", "SPY")
        .maybeSingle();
      const spyPrice = spyRow?.price ?? 0;

      // 3. Get filter data
      const mcMap = new Map<string, number>();
      if (universeSource === "universe_table") {
        const { data: uniMc } = await supabase
          .from("rs_stock_universe")
          .select("symbol, market_cap")
          .eq("qualified", true);
        if (uniMc) {
          for (const u of uniMc) if (u.market_cap) mcMap.set(u.symbol, Number(u.market_cap));
        }
      } else {
        const { data: fundData } = await supabase
          .from("fundamentals_cache")
          .select("symbol, market_cap");
        if (fundData) {
          for (const f of fundData) if (f.market_cap !== null) mcMap.set(f.symbol, f.market_cap);
        }
      }

      // Volume data
      const volMap = new Map<string, number>();
      for (let i = 0; i < allSymbols.length; i += 500) {
        const batch = allSymbols.slice(i, i + 500);
        const { data } = await supabase
          .from("ticker_volume_cache")
          .select("symbol, avg_20d")
          .in("symbol", batch);
        if (data) {
          for (const v of data) if (v.avg_20d && v.avg_20d > 0) volMap.set(v.symbol, v.avg_20d);
        }
      }

      // Avg daily range from eod_prices
      const rangeMap = new Map<string, number>();
      const now = new Date();
      const date30 = new Date(now);
      date30.setDate(date30.getDate() - 45);
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
          const grouped = new Map<string, number[]>();
          for (const row of eodRows) {
            if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
            grouped.get(row.symbol)!.push(Number(row.close_price));
          }
          for (const [sym, prices] of grouped) {
            if (prices.length < 2) continue;
            let totalRange = 0, count = 0;
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

      // 4. Apply filters
      const stats: RsFilterStats = {
        totalBeforeFilter: allSymbols.length,
        passedFilter: 0,
        filteredByMarketCap: 0,
        filteredByDollarVol: 0,
        filteredByRange: 0,
        filteredByPrice: 0,
        universeSource,
      };

      const filteredSymbols: string[] = [];
      for (const sym of allSymbols) {
        const price = priceMap.get(sym);
        if (!price || price < RS_FILTER_THRESHOLDS.MIN_PRICE) { stats.filteredByPrice++; continue; }
        const mc = mcMap.get(sym);
        if (mc !== undefined && mc < RS_FILTER_THRESHOLDS.MIN_MARKET_CAP) { stats.filteredByMarketCap++; continue; }
        const avgVol = volMap.get(sym);
        if (avgVol !== undefined) {
          if (avgVol * price < RS_FILTER_THRESHOLDS.MIN_DOLLAR_VOLUME) { stats.filteredByDollarVol++; continue; }
        }
        const avgRange = rangeMap.get(sym);
        if (avgRange !== undefined && avgRange < RS_FILTER_THRESHOLDS.MIN_AVG_DAILY_RANGE) { stats.filteredByRange++; continue; }
        filteredSymbols.push(sym);
      }
      stats.passedFilter = filteredSymbols.length;
      setFilterStats(stats);

      // 5. Try local eod_prices first for returns
      const symbolsWithSpy = [...filteredSymbols, "SPY"];
      const d1m = new Date(now); d1m.setDate(d1m.getDate() - 35);
      const d3m = new Date(now); d3m.setDate(d3m.getDate() - 100);
      const d6m = new Date(now); d6m.setDate(d6m.getDate() - 190);
      const d1w = new Date(now); d1w.setDate(d1w.getDate() - 7);

      const baselineMap = new Map<string, { tf: string; price: number }[]>();
      for (let i = 0; i < symbolsWithSpy.length; i += 500) {
        const batch = symbolsWithSpy.slice(i, i + 500);
        const { data: baselines } = await supabase.rpc("get_eod_baselines", {
          p_symbols: batch,
          p_date_1w: d1w.toISOString().split("T")[0],
          p_date_1m: d1m.toISOString().split("T")[0],
          p_date_3m: d3m.toISOString().split("T")[0],
          p_date_ytd: d6m.toISOString().split("T")[0],
        });
        if (baselines) {
          for (const b of baselines as any[]) {
            if (!baselineMap.has(b.symbol)) baselineMap.set(b.symbol, []);
            baselineMap.get(b.symbol)!.push({ tf: b.timeframe, price: Number(b.close_price) });
          }
        }
      }

      const calcLocalReturn = (sym: string, tf: string): number | null => {
        const cp = sym === "SPY" ? spyPrice : priceMap.get(sym);
        if (!cp) return null;
        const bl = baselineMap.get(sym)?.find(b => b.tf === tf);
        if (!bl || bl.price <= 0) return null;
        return Math.round(((cp - bl.price) / bl.price) * 10000) / 100;
      };

      // Check if we have enough local data for 3M/6M
      const spyHas3m = calcLocalReturn("SPY", "3M") !== null;
      const spyHas6m = calcLocalReturn("SPY", "YTD") !== null;

      // 6. For 3M/6M, use Yahoo Finance fallback if local data insufficient
      let yahooData = new Map<string, Record<string, { returnPct: number | null; source: string }>>();
      const needYahoo: string[] = [];

      if (!spyHas3m || !spyHas6m) {
        // Need Yahoo for everything since SPY baseline is missing
        needYahoo.push("SPY", ...filteredSymbols);
      } else {
        // Check individual stocks
        for (const sym of filteredSymbols) {
          const has3m = calcLocalReturn(sym, "3M") !== null;
          const has6m = calcLocalReturn(sym, "YTD") !== null;
          if (!has3m || !has6m) needYahoo.push(sym);
        }
      }

      if (needYahoo.length > 0) {
        const periods = [];
        if (!spyHas3m) periods.push("3mo");
        if (!spyHas6m) periods.push("6mo");
        if (periods.length === 0) periods.push("3mo", "6mo"); // for individual stocks

        console.log(`Fetching Yahoo history for ${needYahoo.length} symbols, periods: ${periods.join(",")}`);
        yahooData = await fetchYahooReturns(
          [...new Set(needYahoo)],
          periods
        );
      }

      // SPY returns (local first, Yahoo fallback)
      const spyReturn1m = calcLocalReturn("SPY", "1M");
      let spyReturn3m = calcLocalReturn("SPY", "3M");
      let spyReturn6m = calcLocalReturn("SPY", "YTD");

      if (spyReturn3m === null) spyReturn3m = yahooData.get("SPY")?.["3mo"]?.returnPct ?? null;
      if (spyReturn6m === null) spyReturn6m = yahooData.get("SPY")?.["6mo"]?.returnPct ?? null;

      // 7. Build RS stocks
      const results: RsStock[] = [];
      for (const symbol of filteredSymbols) {
        const themeName = tickerThemeMap.get(symbol) || "";
        const price = priceMap.get(symbol) ?? null;

        // 1M always from local
        const r1m = calcLocalReturn(symbol, "1M");
        let r3m = calcLocalReturn(symbol, "3M");
        let r6m = calcLocalReturn(symbol, "YTD");

        let src3m = "local", src6m = "local";
        if (r3m === null && yahooData.has(symbol)) {
          r3m = yahooData.get(symbol)!["3mo"]?.returnPct ?? null;
          src3m = "yahoo";
        }
        if (r6m === null && yahooData.has(symbol)) {
          r6m = yahooData.get(symbol)!["6mo"]?.returnPct ?? null;
          src6m = "yahoo";
        }

        const rs1m = r1m !== null && spyReturn1m !== null
          ? Math.round((r1m - spyReturn1m) * 100) / 100 : null;
        const rs3m = r3m !== null && spyReturn3m !== null
          ? Math.round((r3m - spyReturn3m) * 100) / 100 : null;
        const rs6m = r6m !== null && spyReturn6m !== null
          ? Math.round((r6m - spyReturn6m) * 100) / 100 : null;

        // Dynamic weighting based on available data
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
          symbol, themeName, price,
          return1m: r1m, return3m: r3m, return6m: r6m,
          spyReturn1m, spyReturn3m, spyReturn6m,
          rs1m, rs3m, rs6m, rsOverall,
          marketCap: mcMap.get(symbol) ?? null,
          avgDollarVolume: dollarVol,
          avgDailyRange: rangeMap.get(symbol) ?? null,
          source1m: "local",
          source3m: src3m,
          source6m: src6m,
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
  }, [getSymbolUniverse, fetchYahooReturns]);

  // ── Trigger background universe scan ──
  const scanUniverse = useCallback(async () => {
    setUniverseScan(prev => ({ ...prev, isScanning: true, progress: "Starting universe scan..." }));
    try {
      let offset = 0;
      let done = false;
      let totalQualified = 0;

      while (!done) {
        const { data, error: fnErr } = await supabase.functions.invoke("scan-universe", {
          body: { offset },
        });
        if (fnErr) throw new Error(fnErr.message);
        if (data?.error) throw new Error(data.error);

        totalQualified += data?.qualified_count || 0;
        done = data?.done ?? true;
        offset = data?.next_offset ?? offset + 50;

        setUniverseScan(prev => ({
          ...prev,
          progress: `Scanned ${offset} of ${data?.total_symbols || "?"} symbols (${totalQualified} qualified)...`,
        }));
      }

      setUniverseScan({
        isScanning: false,
        progress: "",
        lastScanned: new Date(),
        totalInUniverse: totalQualified,
      });
    } catch (err) {
      console.error("Universe scan error:", err);
      setUniverseScan(prev => ({ ...prev, isScanning: false, progress: "" }));
      setError(`Universe scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  return {
    stocks, isCalculating, lastCalculated, error, filterStats,
    calculateRs, universeScan, scanUniverse,
  };
}
