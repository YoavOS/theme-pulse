import { useCallback, useEffect, useMemo, useState } from "react";
import { loadBases, type StockBase } from "@/lib/bases";
import { onStagesUpdated } from "@/lib/stageAnalysis";

/** Latest base candidates (cached; refreshes after each stage/base scan). */
export function useStockBases(enabled = true) {
  const [rows, setRows] = useState<StockBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setRows(await loadBases(force));
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
    const m = new Map<string, StockBase>();
    for (const r of rows) m.set(r.symbol.toUpperCase(), r);
    return m;
  }, [rows]);

  return { rows, bySymbol, loading, error, reload };
}
