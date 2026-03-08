import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Uses the get_eod_baselines RPC to calculate timeframe performance
 * from stored EOD data instead of external API calls.
 */
export function useEodPerformance() {
  /**
   * Calculate performance for all given symbols using EOD historical data.
   * Returns a map: symbol -> { perf_1w, perf_1m, perf_3m, perf_ytd, hasData: boolean }
   */
  const calculateFromEod = useCallback(async (
    symbols: string[],
    todayPrices: Record<string, number> // symbol -> current close price
  ): Promise<Record<string, {
    perf_1w: number | null;
    perf_1m: number | null;
    perf_3m: number | null;
    perf_ytd: number | null;
  }>> => {
    if (symbols.length === 0) return {};

    const now = new Date();
    const toDateStr = (d: Date) => d.toISOString().split("T")[0];

    const date1w = new Date(now);
    date1w.setDate(date1w.getDate() - 7);
    const date1m = new Date(now);
    date1m.setDate(date1m.getDate() - 30);
    const date3m = new Date(now);
    date3m.setDate(date3m.getDate() - 90);
    const dateYtd = new Date(now.getFullYear(), 0, 1);

    const { data, error } = await supabase.rpc("get_eod_baselines", {
      p_symbols: symbols,
      p_date_1w: toDateStr(date1w),
      p_date_1m: toDateStr(date1m),
      p_date_3m: toDateStr(date3m),
      p_date_ytd: toDateStr(dateYtd),
    });

    if (error || !data) {
      console.error("EOD baselines error:", error);
      return {};
    }

    // Build result map
    const result: Record<string, {
      perf_1w: number | null;
      perf_1m: number | null;
      perf_3m: number | null;
      perf_ytd: number | null;
    }> = {};

    // Initialize all symbols
    for (const s of symbols) {
      result[s] = { perf_1w: null, perf_1m: null, perf_3m: null, perf_ytd: null };
    }

    // Fill in from RPC results
    for (const row of data as { symbol: string; timeframe: string; close_price: number }[]) {
      const currentPrice = todayPrices[row.symbol];
      if (!currentPrice || !row.close_price || row.close_price === 0) continue;

      const pct = Math.round(((currentPrice - Number(row.close_price)) / Number(row.close_price)) * 10000) / 100;
      const entry = result[row.symbol];
      if (!entry) continue;

      switch (row.timeframe) {
        case "1W": entry.perf_1w = pct; break;
        case "1M": entry.perf_1m = pct; break;
        case "3M": entry.perf_3m = pct; break;
        case "YTD": entry.perf_ytd = pct; break;
      }
    }

    return result;
  }, []);

  /**
   * Check how many days of EOD data exist and readiness per timeframe
   */
  const checkCoverage = useCallback(async () => {
    const { count } = await supabase
      .from("eod_prices")
      .select("*", { count: "exact", head: true });

    const { data: dateRange } = await supabase
      .from("eod_prices")
      .select("date")
      .order("date", { ascending: true })
      .limit(1);

    const { data: latestDate } = await supabase
      .from("eod_prices")
      .select("date")
      .order("date", { ascending: false })
      .limit(1);

    const firstDate = dateRange?.[0]?.date || null;
    const lastDate = latestDate?.[0]?.date || null;

    // Count unique trading days
    const { data: uniqueDays } = await supabase
      .from("eod_prices")
      .select("date")
      .order("date");

    const uniqueDates = new Set(uniqueDays?.map(d => d.date) || []);
    const tradingDays = uniqueDates.size;

    return {
      totalRows: count || 0,
      tradingDays,
      firstDate,
      lastDate,
      ready1w: tradingDays >= 5,
      ready1m: tradingDays >= 20,
      ready3m: tradingDays >= 60,
      readyYtd: tradingDays >= 5, // just needs some data from around Jan 1
      daysNeeded1w: Math.max(0, 5 - tradingDays),
      daysNeeded1m: Math.max(0, 20 - tradingDays),
      daysNeeded3m: Math.max(0, 60 - tradingDays),
    };
  }, []);

  return { calculateFromEod, checkCoverage };
}
