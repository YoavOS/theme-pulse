import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface QualifiedRsRow {
  symbol: string;
  rs_overall: number | null;
  rs_1w: number | null;
  rs_1m: number | null;
  rs_3m: number | null;
  rs_6m: number | null;
}

const PAGE = 1000;

/**
 * Loads the qualified RS universe into a Map<symbol, rs row>.
 * Used by MoneyFlowTab to compute Rotation Strength (1W vs 3M RS change),
 * average RS rating, and top-stocks-to-watch.
 */
export function useQualifiedRsMap() {
  const [map, setMap] = useState<Map<string, QualifiedRsRow>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const all: QualifiedRsRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("qualified_rs_universe")
          .select("symbol, rs_overall, rs_1w, rs_1m, rs_3m, rs_6m")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as QualifiedRsRow[]));
        if (data.length < PAGE) break;
      }
      const m = new Map<string, QualifiedRsRow>();
      for (const r of all) m.set(r.symbol, r);
      setMap(m);
    } catch (e) {
      console.warn("useQualifiedRsMap load failed", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { rsMap: map, isLoading, reload: load };
}
