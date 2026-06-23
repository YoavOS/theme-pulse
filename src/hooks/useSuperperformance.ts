import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SuperperformanceRow {
  symbol: string;
  minervini_score: number;
  last_scanned: string;
}

/**
 * Loads the lightweight Superperformance Stocks list (Minervini score >= 80).
 * Tiny payload — three columns only — so we keep it cached in memory + refetchable.
 */
export function useSuperperformance() {
  const [rows, setRows] = useState<SuperperformanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("superperformance_stocks" as any)
        .select("symbol, minervini_score, last_scanned")
        .order("minervini_score", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as unknown as SuperperformanceRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { rows, loading, error, reload: load };
}
