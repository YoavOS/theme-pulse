import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
      const { data } = await supabase
        .from("eod_prices")
        .select("date")
        .order("date", { ascending: true });

      const uniqueDates = new Set((data || []).map(r => r.date));
      const days = uniqueDates.size;

      setAvailability({
        today: true,
        "1W": days >= THRESHOLDS["1W"],
        "1M": days >= THRESHOLDS["1M"],
        "3M": days >= THRESHOLDS["3M"],
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
