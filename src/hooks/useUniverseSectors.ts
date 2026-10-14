import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface UniverseSectorRow {
  symbol: string;
  sector: string | null;   // granular Finnhub industry
  ret: number | null;      // 1M return, used for performance context
}

const PAGE = 1000;
const CACHE_KEY = "universe_sectors_v1";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — this data barely changes

/**
 * Loads symbol → industry for the qualified universe.
 * Heavily cached in localStorage so the dashboard concentration view
 * costs at most one query every 12 hours.
 */
export function useUniverseSectors() {
  const [rows, setRows] = useState<UniverseSectorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (loading || loaded) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; rows: UniverseSectorRow[] };
        if (Date.now() - parsed.ts < TTL_MS && Array.isArray(parsed.rows) && parsed.rows.length) {
          setRows(parsed.rows);
          setLoaded(true);
          return;
        }
      }
    } catch { /* ignore corrupt cache */ }

    setLoading(true);
    try {
      const all: UniverseSectorRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("qualified_rs_universe")
          .select("symbol, sector, return_1m")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        all.push(...data.map((r: any) => ({ symbol: r.symbol, sector: r.sector ?? null, ret: r.return_1m ?? null })));
        if (data.length < PAGE) break;
      }
      setRows(all);
      setLoaded(true);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows: all })); } catch { /* quota */ }
    } catch (e) {
      console.warn("useUniverseSectors load failed", e);
    } finally {
      setLoading(false);
    }
  }, [loading, loaded]);

  return { rows, loading, loaded, load };
}
