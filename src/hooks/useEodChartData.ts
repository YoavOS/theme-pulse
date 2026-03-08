import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EodRow {
  symbol: string;
  date: string;
  close_price: number;
  theme_name: string;
}

export function useEodChartData() {
  const [data, setData] = useState<EodRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uniqueDates, setUniqueDates] = useState<string[]>([]);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from("eod_prices")
        .select("symbol, date, close_price, theme_name")
        .order("date", { ascending: true });

      if (error) throw error;
      const eodRows = (rows || []) as EodRow[];
      setData(eodRows);

      const dates = [...new Set(eodRows.map(r => r.date))].sort();
      setUniqueDates(dates);
    } catch (err) {
      console.error("useEodChartData error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, isLoading, uniqueDates, refetch: fetch };
}
