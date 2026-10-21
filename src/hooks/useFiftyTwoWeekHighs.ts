import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FiftyTwoWeekHigh {
  high52w: number | null;
  latestClose: number | null;
  lastHighDaysAgo: number | null;
  pctBelowHigh: number | null;
  /** days since the most recent bar at the 52-week low */
  lastLowDaysAgo?: number | null;
}

// localStorage-backed 24h cache — keyed per symbol so partial universes reuse hits.
const LS_KEY = "rs-52w-highs-v2"; // v2 adds lastLowDaysAgo
const LS_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredEntry extends FiftyTwoWeekHigh { at: number }
type Store = Record<string, StoredEntry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch { return {}; }
}
function writeStore(s: Store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota — ignore */ }
}

/**
 * Fetches 52-week high info for a list of symbols with heavy caching.
 * - Reads localStorage first (24h TTL per symbol) — no network for warm cache.
 * - Only fetches missing/stale symbols via `fifty-two-week-highs` edge function,
 *   which itself reads yahoo_history_cache (server-side 7d TTL) before hitting Yahoo.
 */
export function useFiftyTwoWeekHighs(symbols: string[], enabled = true) {
  const [map, setMap] = useState<Map<string, FiftyTwoWeekHigh>>(new Map());
  const [loading, setLoading] = useState(false);
  const inflight = useRef<Set<string>>(new Set());

  const symKey = symbols.join("|");

  const load = useCallback(async () => {
    if (!enabled || symbols.length === 0) return;
    const store = readStore();
    const now = Date.now();
    const fresh = new Map<string, FiftyTwoWeekHigh>();
    const need: string[] = [];
    for (const s of symbols) {
      const hit = store[s];
      if (hit && now - hit.at < LS_TTL_MS) {
        fresh.set(s, { high52w: hit.high52w, latestClose: hit.latestClose, lastHighDaysAgo: hit.lastHighDaysAgo, pctBelowHigh: hit.pctBelowHigh, lastLowDaysAgo: hit.lastLowDaysAgo ?? null });
      } else if (!inflight.current.has(s)) {
        need.push(s);
      }
    }
    setMap(fresh);
    const valid = need.filter(s => /^[A-Z][A-Z0-9.-]{0,9}$/.test(String(s ?? "").toUpperCase().trim()));
    need.length = 0; need.push(...valid);
    if (need.length === 0) return;

    need.forEach(s => inflight.current.add(s));
    setLoading(true);
    try {
      const CHUNK = 400;
      for (let i = 0; i < need.length; i += CHUNK) {
        const slice = need.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("fifty-two-week-highs", { body: { symbols: slice } });
        if (error) throw new Error(error.message);
        const rows = (data as { rows?: Array<{ symbol: string } & FiftyTwoWeekHigh> })?.rows ?? [];
        const nowInner = Date.now();
        const store2 = readStore();
        for (const r of rows) {
          const entry = { high52w: r.high52w, latestClose: r.latestClose, lastHighDaysAgo: r.lastHighDaysAgo, pctBelowHigh: r.pctBelowHigh, lastLowDaysAgo: r.lastLowDaysAgo ?? null };
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

  const stats = useMemo(() => {
    let known = 0, hitToday = 0, hit7d = 0, hit30d = 0, hit90d = 0, hit180d = 0;
    for (const [, v] of map) {
      if (v.lastHighDaysAgo === null) continue;
      known++;
      const d = v.lastHighDaysAgo;
      if (d <= 0) hitToday++;
      if (d <= 7) hit7d++;
      if (d <= 30) hit30d++;
      if (d <= 90) hit90d++;
      if (d <= 180) hit180d++;
    }
    return { known, hitToday, hit7d, hit30d, hit90d, hit180d };
  }, [map]);

  return { highsMap: map, loading, stats, reload: load };
}
