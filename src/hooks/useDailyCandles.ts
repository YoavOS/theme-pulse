import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DailyCandle { open: number; close: number }

// Module-level cache shared across modal instances; cleared on full reload.
const CACHE = new Map<string, DailyCandle | null>();
let cacheStamp = 0; // refreshed on manual reset

/**
 * Fetches today's daily candle (open + close) for a list of symbols.
 * - De-duplicates against an in-memory cache so re-renders don't refetch.
 * - Returns a map + counts and a stable refetch function.
 * - Symbols are fetched in batches of 200 via the `daily-candles` edge function.
 */
export function useDailyCandles(symbols: string[], enabled = true) {
  const [map, setMap] = useState<Map<string, DailyCandle | null>>(new Map());
  const [loading, setLoading] = useState(false);
  const inflight = useRef<Set<string>>(new Set());

  const sync = useCallback(() => {
    const next = new Map<string, DailyCandle | null>();
    for (const s of symbols) {
      if (CACHE.has(s)) next.set(s, CACHE.get(s) ?? null);
    }
    setMap(next);
  }, [symbols]);

  const fetchMissing = useCallback(async (force = false) => {
    if (!enabled) return;
    const need = symbols.filter(
      (s) => s && (force || !CACHE.has(s)) && !inflight.current.has(s),
    );
    if (need.length === 0) { sync(); return; }
    need.forEach((s) => inflight.current.add(s));
    setLoading(true);
    try {
      const CHUNK = 200;
      for (let i = 0; i < need.length; i += CHUNK) {
        const slice = need.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("daily-candles", {
          body: { symbols: slice },
        });
        if (error) throw new Error(error.message);
        const results = (data as { results?: Record<string, DailyCandle | null> })?.results ?? {};
        for (const s of slice) CACHE.set(s, results[s] ?? null);
        sync();
      }
    } catch {
      // Fail soft — cells will just stay unknown.
    } finally {
      need.forEach((s) => inflight.current.delete(s));
      setLoading(false);
    }
  }, [symbols, enabled, sync]);

  // Auto-fetch whenever the symbol list changes.
  const symKey = symbols.join("|");
  useEffect(() => {
    if (!enabled) return;
    sync();
    void fetchMissing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symKey, enabled, cacheStamp]);

  let green = 0, red = 0, doji = 0, known = 0;
  for (const s of symbols) {
    const c = map.get(s);
    if (!c) continue;
    known++;
    if (c.close > c.open) green++;
    else if (c.close < c.open) red++;
    else doji++;
  }

  return {
    candleMap: map,
    loading,
    known,
    green,
    red,
    doji,
    refresh: () => { cacheStamp++; void fetchMissing(true); },
  };
}
