import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStages, onStagesUpdated, type StockStage } from "@/lib/stageAnalysis";

/** Latest Weinstein stage for every stock (cached; refreshes after each stage scan). */
export function useStockStages(enabled = true) {
  const [rows, setRows] = useState<StockStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setRows(await loadStages(force));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    return onStagesUpdated(() => reload(true));
  }, [enabled, reload]);

  const bySymbol = useMemo(() => {
    const m = new Map<string, StockStage>();
    for (const r of rows) m.set(r.symbol.toUpperCase(), r);
    return m;
  }, [rows]);

  return { rows, bySymbol, loading, error, reload };
}
