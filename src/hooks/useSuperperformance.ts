import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SuperperformanceProfileKey = "minervini" | "oneil" | "ryan" | "current";

export interface SuperperformanceRow {
  symbol: string;
  minervini_score: number | null;
  oneil_score: number | null;
  ryan_score: number | null;
  current_score: number | null;
  last_scanned: string;
}

const SCORE_COL: Record<SuperperformanceProfileKey, keyof SuperperformanceRow> = {
  minervini: "minervini_score",
  oneil: "oneil_score",
  ryan: "ryan_score",
  current: "current_score",
};

/**
 * Loads the lightweight Superperformance Stocks list. Each row carries optional
 * scores for every supported profile (Minervini, O'Neil, Ryan, Current).
 * The payload is tiny — symbol + four numeric scores + timestamp — so we keep
 * it cached in memory + refetchable.
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
        .select("symbol, minervini_score, oneil_score, ryan_score, current_score, last_scanned")
        .order("minervini_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRows((data ?? []) as unknown as SuperperformanceRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Sets of symbols qualifying (>=80) per profile. */
  const sets = useMemo(() => {
    const out: Record<SuperperformanceProfileKey, Set<string>> = {
      minervini: new Set(),
      oneil: new Set(),
      ryan: new Set(),
      current: new Set(),
    };
    for (const r of rows) {
      (Object.keys(SCORE_COL) as SuperperformanceProfileKey[]).forEach((k) => {
        const v = r[SCORE_COL[k]] as number | null | undefined;
        if (typeof v === "number" && v >= 80) out[k].add(r.symbol);
      });
    }
    return out;
  }, [rows]);

  return { rows, loading, error, reload: load, sets };
}
