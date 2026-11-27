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

interface DbRow { symbol: string; high52w: number | null; low52w: number | null; latest_close: number | null; last_high_d: string | null; last_low_d: string | null; fresh: boolean | null }

/** Unix seconds of 9:30 New York on a session date — the same reference the backend uses for "days ago". */
function sessionTs(d: string | null | undefined): number | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  const nyNoon = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(Date.UTC(y, m - 1, day, 12))));
  const offset = 12 - nyNoon; // 4 in summer, 5 in winter
  return Date.UTC(y, m - 1, day, 9 + offset, 30) / 1000;
}

/** Regular US session in progress (holidays not known). */
function nyMarketOpen(now = new Date()): boolean {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const mins = +p.hour * 60 + +p.minute;
  return mins >= 570 && mins < 960;
}

/**
 * Fetches 52-week high info for a list of symbols with heavy caching.
 * - Reads localStorage first (4h per symbol; 20 min for rows built from stale history).
 * - Missing/expired symbols come from the PC's daily price table (`fifty_two_week_stats`); the
 *   `fifty-two-week-highs` backend function (Yahoo) is asked only for stocks not in that table or behind,
 *   and during the session for stocks near a high or low.
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
    const store2 = readStore();
    const put = (sym: string, e: StoredEntry) => { fresh.set(sym, fromStore(e)); store2[sym] = e; };
    try {
      // 1) Final daily bars from the PC's own price table — one quick database call per 500 symbols.
      const fromDb = new Map<string, { hi: number | null; lo: number | null; close: number | null; fresh: boolean }>();
      for (let i = 0; i < need.length; i += 500) {
        const { data, error } = await supabase.rpc("fifty_two_week_stats" as never, { syms: need.slice(i, i + 500) } as never);
        if (error) break; // older database without the function: everything goes to the fallback below
        const at = Date.now();
        for (const r of (data ?? []) as DbRow[]) {
          const sym = String(r.symbol).toUpperCase();
          const hi = r.high52w ?? null, close = r.latest_close ?? null;
          put(sym, {
            high52w: hi, latestClose: close, lastHighDaysAgo: null, lastLowDaysAgo: null,
            pctBelowHigh: hi && close ? Math.round((close / hi - 1) * 10000) / 100 : null,
            highTs: sessionTs(r.last_high_d), lowTs: sessionTs(r.last_low_d), at, weak: !r.fresh,
          });
          fromDb.set(sym, { hi, lo: r.low52w ?? null, close, fresh: !!r.fresh });
        }
      }
      setMap(new Map(fresh));

      // 2) Yahoo, through the backend function, only where it adds something: stocks missing or behind
      //    in the price table, and — while the market is open — stocks within 5% of a high or low, so
      //    "Today" catches highs made during the session. Small batches; a failed batch doesn't stop the rest.
      const open = nyMarketOpen();
      const viaYahoo = need.filter((s) => {
        const d = fromDb.get(s);
        if (!d || !d.fresh) return true;
        if (!open || !d.close) return false;
        return (d.hi != null && d.close >= d.hi * 0.95) || (d.lo != null && d.close <= d.lo * 1.05);
      });
      let failed = 0;
      for (let i = 0; i < viaYahoo.length; i += 100) {
        const slice = viaYahoo.slice(i, i + 100);
        const { data, error } = await supabase.functions.invoke("fifty-two-week-highs", { body: { symbols: slice } }).catch((e) => ({ data: null, error: e }));
        if (error) { failed += slice.length; continue; }
        const rows = (data as { rows?: Array<{ symbol: string; lastHighTs?: number | null; lastLowTs?: number | null; stale?: boolean; error?: string } & FiftyTwoWeekHigh> })?.rows ?? [];
        const at = Date.now();
        for (const r of rows) {
          if (r.high52w === null && fromDb.has(r.symbol)) continue; // keep the database row
          put(r.symbol, {
            high52w: r.high52w, latestClose: r.latestClose, lastHighDaysAgo: r.lastHighDaysAgo, pctBelowHigh: r.pctBelowHigh, lastLowDaysAgo: r.lastLowDaysAgo ?? null,
            highTs: r.lastHighTs ?? null, lowTs: r.lastLowTs ?? null, at,
            // Re-check soon when the server had to use an old history or had nothing.
            weak: !!r.stale || r.high52w === null,
          });
        }
        setMap(new Map(fresh));
      }
      if (failed) console.warn(`[52w] ${failed} symbols could not be refreshed from Yahoo; using the last daily close for them`);
      writeStore(store2);
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
