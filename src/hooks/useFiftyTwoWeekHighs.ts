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

// localStorage cache, keyed per symbol so partial universes reuse hits.
// v3 keeps the bar timestamps, so "days ago" is recomputed whenever it is read
// (v2 froze it at fetch time: a high "today" still read "today" the next day).
const LS_KEY = "rs-52w-highs-v3";
const LS_TTL_MS = 4 * 60 * 60 * 1000;      // fresh rows
const LS_TTL_WEAK_MS = 20 * 60 * 1000;     // rows built from stale history, or with no data

interface StoredEntry extends FiftyTwoWeekHigh { at: number; highTs?: number | null; lowTs?: number | null; weak?: boolean }

const daysSince = (ts: number | null | undefined, fallback: number | null, at: number) =>
  typeof ts === "number" && ts > 0
    ? Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400))
    : fallback === null ? null : fallback + Math.floor((Date.now() - at) / 86400000);
const fromStore = (e: StoredEntry): FiftyTwoWeekHigh => ({
  high52w: e.high52w, latestClose: e.latestClose, pctBelowHigh: e.pctBelowHigh,
  lastHighDaysAgo: daysSince(e.highTs, e.lastHighDaysAgo, e.at),
  lastLowDaysAgo: daysSince(e.lowTs, e.lastLowDaysAgo ?? null, e.at),
});
type Store = Record<string, StoredEntry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    localStorage.removeItem("rs-52w-highs-v2"); // old format, can be large
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
 * - Reads localStorage first (4h per symbol; 20 min for rows built from stale history).
 * - Only fetches missing/expired symbols via the `fifty-two-week-highs` edge function,
 *   which refreshes any cached history older than the latest market close.
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
      if (hit && now - hit.at < (hit.weak ? LS_TTL_WEAK_MS : LS_TTL_MS)) {
        fresh.set(s, fromStore(hit));
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
        const rows = (data as { rows?: Array<{ symbol: string; lastHighTs?: number | null; lastLowTs?: number | null; stale?: boolean; error?: string } & FiftyTwoWeekHigh> })?.rows ?? [];
        const nowInner = Date.now();
        const store2 = readStore();
        for (const r of rows) {
          const entry: StoredEntry = {
            high52w: r.high52w, latestClose: r.latestClose, lastHighDaysAgo: r.lastHighDaysAgo, pctBelowHigh: r.pctBelowHigh, lastLowDaysAgo: r.lastLowDaysAgo ?? null,
            highTs: r.lastHighTs ?? null, lowTs: r.lastLowTs ?? null, at: nowInner,
            // Re-check soon when the server had to use an old history or had nothing.
            weak: !!r.stale || r.high52w === null,
          };
          fresh.set(r.symbol, fromStore(entry));
          store2[r.symbol] = entry;
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
