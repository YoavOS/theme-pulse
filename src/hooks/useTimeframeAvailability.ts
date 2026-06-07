import { useState, useEffect, useCallback } from "react";
import { supabase as _supabaseTyped } from "@/integrations/supabase/client";
const supabase: any = _supabaseTyped;

export type Timeframe = "today" | "1W" | "1M" | "3M";

export interface TimeframeAvailability {
  today: boolean;
  "1W": boolean;
  "1M": boolean;
  "3M": boolean;
  tradingDays: number;
  daysNeeded: Record<string, number>;
}

const THRESHOLDS: Record<string, number> = { "1W": 5, "1M": 20, "3M": 60 };

export function useTimeframeAvailability() {
  const [availability, setAvailability] = useState<TimeframeAvailability>({
    today: true, "1W": false, "1M": false, "3M": false,
    tradingDays: 0,
    daysNeeded: { "1W": 5, "1M": 20, "3M": 60 },
  });
  const [isChecking, setIsChecking] = useState(true);

  const check = useCallback(async () => {
    setIsChecking(true);
    try {
      // Source 1: native EOD trading-day count
      const { data: eodDates } = await supabase
        .from("eod_prices")
        .select("date")
        .order("date", { ascending: true });
      const uniqueDates = new Set((eodDates || []).map(r => r.date));
      const days = uniqueDates.size;

      // Source 2: Yahoo-backfilled ticker_performance.
      // If we have any non-null perf_1w/1m/3m, the corresponding TF is unlocked.
      const { data: perfRows } = await supabase
        .from("ticker_performance")
        .select("perf_1w, perf_1m, perf_3m");
      const has1W = (perfRows || []).some(r => r.perf_1w !== null && r.perf_1w !== 0);
      const has1M = (perfRows || []).some(r => r.perf_1m !== null && r.perf_1m !== 0);
      const has3M = (perfRows || []).some(r => r.perf_3m !== null && r.perf_3m !== 0);

      setAvailability({
        today: true,
        "1W": days >= THRESHOLDS["1W"] || has1W,
        "1M": days >= THRESHOLDS["1M"] || has1M,
        "3M": days >= THRESHOLDS["3M"] || has3M,
        tradingDays: days,
        daysNeeded: {
          "1W": Math.max(0, THRESHOLDS["1W"] - days),
          "1M": Math.max(0, THRESHOLDS["1M"] - days),
          "3M": Math.max(0, THRESHOLDS["3M"] - days),
        },
      });
    } catch (err) {
      console.error("Timeframe availability check error:", err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return { availability, isChecking, refresh: check };
}
