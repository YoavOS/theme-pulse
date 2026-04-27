import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface StockFundamentals {
  symbol: string;
  revenue_quarterly_yoy: number | null;
  revenue_ttm_yoy: number | null;
  revenue_annual_yoy: number | null;
  eps_quarterly_yoy: number | null;
  eps_ttm_yoy: number | null;
  eps_annual_yoy: number | null;
  roe: number | null;
  net_margin: number | null;
  debt_to_equity: number | null;
  sector: string | null;
}

const PAGE = 1000;

export function useStockFundamentalsMap() {
  const [map, setMap] = useState<Map<string, StockFundamentals>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all: StockFundamentals[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("stock_fundamentals")
          .select(
            "symbol, sector, revenue_quarterly_yoy, revenue_ttm_yoy, revenue_annual_yoy, eps_quarterly_yoy, eps_ttm_yoy, eps_annual_yoy, roe, net_margin, debt_to_equity"
          )
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as StockFundamentals[]));
        if (data.length < PAGE) break;
      }
      const m = new Map<string, StockFundamentals>();
      for (const f of all) m.set(f.symbol, f);
      setMap(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { map, isLoading, error, reload: load };
}
