import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UNIVERSE_SECTORS_CACHE_KEY } from "@/lib/classification";

export interface UniverseSectorRow {
  symbol: string;
  sector: string | null;   // canonical sub-industry once classified, else raw provider label
  ret: number | null;      // 1M return (kept for existing callers)
  name?: string | null;
  r1d?: number | null;     // returns in %, from the latest "Recalculate RS Scores" run
  r1w?: number | null;
  r1m?: number | null;
  r3m?: number | null;
}

const PAGE = 1000;
const CACHE_KEY = UNIVERSE_SECTORS_CACHE_KEY;
const TTL_MS = 12 * 60 * 60 * 1000;

interface CachePayload {
  ts: number;
  asOf: string | null;
  rows: UniverseSectorRow[];
  extra?: UniverseSectorRow[];
}

/** Timestamp of the latest RS calculation (one tiny query) — used to invalidate the cache. */
async function latestRsCalc(): Promise<string | null> {
  const { data } = await supabase
    .from("qualified_rs_universe")
    .select("rs_calculated_at")
    .not("rs_calculated_at", "is", null)
    .order("rs_calculated_at", { ascending: false })
    .limit(1);
  return data?.[0]?.rs_calculated_at ?? null;
}

const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Loads the qualified RS universe with industry labels and returns
 * (1D/1W/1M/3M), plus the permanent classification of tickers outside it
 * (e.g. theme tickers) as `extra`.
 *
 * Cached in localStorage; the cache is reused until a newer RS scan exists
 * (checked with one tiny query) or 12h pass, and is cleared after a
 * classification run.
 */
export function useUniverseSectors() {
  const [rows, setRows] = useState<UniverseSectorRow[]>([]);
  const [extra, setExtra] = useState<UniverseSectorRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (force = false) => {
    if (loading || (loaded && !force)) return;
    setLoading(true);
    try {
      const latest = await latestRsCalc().catch(() => null);

      if (!force) {
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as CachePayload;
            const fresh = Date.now() - parsed.ts < TTL_MS && parsed.asOf === latest;
            if (fresh && Array.isArray(parsed.rows) && parsed.rows.length) {
              setRows(parsed.rows);
              setExtra(Array.isArray(parsed.extra) ? parsed.extra : []);
              setAsOf(parsed.asOf);
              setLoaded(true);
              return;
            }
          }
        } catch { /* ignore corrupt cache */ }
      }

      const all: UniverseSectorRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("qualified_rs_universe")
          .select("symbol, sector, company_name, return_1d, return_1w, return_1m, return_3m")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) {
          all.push({
            symbol: r.symbol,
            sector: r.sector ?? null,
            name: r.company_name ?? null,
            ret: num(r.return_1m),
            r1d: num(r.return_1d),
            r1w: num(r.return_1w),
            r1m: num(r.return_1m),
            r3m: num(r.return_3m),
          });
        }
        if (data.length < PAGE) break;
      }

      // Permanent classifications (ignored if the table doesn't exist yet).
      const classified = new Map<string, string>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("ticker_classification")
          .select("symbol, sub_industry")
          .eq("status", "done")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data) if (r.sub_industry) classified.set(r.symbol.toUpperCase(), r.sub_industry);
        if (data.length < PAGE) break;
      }
      const inUniverse = new Set<string>();
      for (const r of all) {
        const sym = r.symbol.toUpperCase();
        inUniverse.add(sym);
        const c = classified.get(sym);
        if (c) r.sector = c;
      }
      const extraRows: UniverseSectorRow[] = [];
      classified.forEach((sub, sym) => { if (!inUniverse.has(sym)) extraRows.push({ symbol: sym, sector: sub, ret: null }); });

      setRows(all);
      setExtra(extraRows);
      setAsOf(latest);
      setLoaded(true);
      try {
        const payload: CachePayload = { ts: Date.now(), asOf: latest, rows: all, extra: extraRows };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch { /* quota */ }
    } catch (e) {
      console.warn("useUniverseSectors load failed", e);
    } finally {
      setLoading(false);
    }
  }, [loading, loaded]);

  return { rows, extra, asOf, loading, loaded, load };
}
