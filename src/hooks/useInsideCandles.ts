import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InsideCandle {
  daily: boolean | null;
  weekly: boolean | null;
  monthly: boolean | null;
}

const LS_KEY = "rs-inside-candles-v1";
const LS_TTL_MS = 12 * 60 * 60 * 1000; // 12h — inside-candle status can flip intraday

interface StoredEntry extends InsideCandle { at: number }
type Store = Record<string, StoredEntry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try { const raw = localStorage.getItem(LS_KEY); return raw ? (JSON.parse(raw) as Store) : {}; }
  catch { return {}; }
}
function writeStore(s: Store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore quota */ }
}

/**
 * Inside-candle flags (daily / weekly / monthly) for a list of symbols.
 * - localStorage 12h TTL keyed per symbol (warm cache = zero network).
 * - Missing/stale symbols batched into `inside-candles` edge function which
 *   reads `yahoo_history_cache` before hitting Yahoo.
 */
export function useInsideCandles(symbols: string[], enabled = true) {
  const [map, setMap] = useState<Map<string, InsideCandle>>(new Map());
  const [loading, setLoading] = useState(false);
  const inflight = useRef<Set<string>>(new Set());
  const symKey = symbols.join("|");

  const load = useCallback(async () => {
    if (!enabled || symbols.length === 0) return;
    const store = readStore();
    const now = Date.now();
    const fresh = new Map<string, InsideCandle>();
    const need: string[] = [];
    for (const s of symbols) {
      const hit = store[s];
      if (hit && now - hit.at < LS_TTL_MS) {
        fresh.set(s, { daily: hit.daily, weekly: hit.weekly, monthly: hit.monthly });
      } else if (!inflight.current.has(s)) {
        need.push(s);
      }
    }
    setMap(fresh);
    if (need.length === 0) return;

    need.forEach(s => inflight.current.add(s));
    setLoading(true);
    try {
      const CHUNK = 400;
      for (let i = 0; i < need.length; i += CHUNK) {
        const slice = need.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("inside-candles", { body: { symbols: slice } });
        if (error) throw new Error(error.message);
        const rows = (data as { rows?: Array<{ symbol: string } & InsideCandle> })?.rows ?? [];
        const nowInner = Date.now();
        const store2 = readStore();
        for (const r of rows) {
          const entry: InsideCandle = { daily: r.daily, weekly: r.weekly, monthly: r.monthly };
          fresh.set(r.symbol, entry);
          store2[r.symbol] = { ...entry, at: nowInner };
        }
        writeStore(store2);
        setMap(new Map(fresh));
      }
    } catch {
      // fail soft
    } finally {
      need.forEach(s => inflight.current.delete(s));
      setLoading(false);
    }
  }, [symbols, symKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [symKey, enabled]);

  return { insideMap: map, loading, reload: load };
}
