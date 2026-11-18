import { useCallback, useEffect, useRef, useState } from "react";
import { isAwake, onWake } from "@/lib/appSleep";

/**
 * Live session quotes for the theme tickers (fetch-themes "Today"), shared by the Tracker's
 * "Since Open" view and the Gap vs Session view.
 *   today = change from yesterday's close, open = change from today's open,
 *   gap = the overnight move (yesterday's close → today's open), derived from the two.
 * Refreshes every 5 minutes while the market is open and the page is visible.
 */
export interface SessionQuote { today: number; open: number; gap: number }
export interface LiveSession { map: Map<string, SessionQuote>; fetchedAt: number }

const REFRESH_MS = 5 * 60 * 1000;
let shared: LiveSession | null = null; // survives switching views

/** US regular session status in New York time. */
export function marketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = !["Sat", "Sun"].includes(get("weekday"));
  const open = weekday && mins >= 9 * 60 + 30 && mins < 16 * 60;
  return { open, sinceOpen: open ? mins - (9 * 60 + 30) : null, time: `${get("hour")}:${get("minute")}` };
}

/** Quotes for symbols outside your themes (industry / sector groups) — Yahoo daily candles: last session's
 *  open and close and the session before's close. Outside market hours this is the last full session. */
async function candleQuotes(symbols: string[], url: string, key: string, into: Map<string, SessionQuote>) {
  const todo = symbols.filter((s) => !into.has(s));
  for (let i = 0; i < todo.length; i += 500) {
    const res = await fetch(`${url}/functions/v1/daily-candles`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: todo.slice(i, i + 500) }),
    });
    if (!res.ok) continue;
    const j = await res.json() as { results?: Record<string, { open: number; close: number; prevClose: number | null } | null> };
    for (const [s, q] of Object.entries(j.results ?? {})) {
      if (!q || !q.prevClose || !q.open) continue;
      const today = (q.close / q.prevClose - 1) * 100, open = (q.close / q.open - 1) * 100, gap = (q.open / q.prevClose - 1) * 100;
      into.set(s, { today: Math.round(today * 100) / 100, open: Math.round(open * 100) / 100, gap: Math.round(gap * 100) / 100 });
    }
  }
}

export function useLiveSession(active: boolean, symbols?: string[]) {
  const symbolsRef = useRef<string[]>([]);
  symbolsRef.current = symbols ?? [];
  const [live, setLive] = useState<LiveSession | null>(shared);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("Config missing");
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-themes?timeframe=Today`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      }).catch(() => null);
      // theme quotes are optional when other symbols are asked for (e.g. no themes on a fresh local copy)
      if ((!res || !res.ok) && !symbolsRef.current.length) throw new Error(res ? `HTTP ${res.status}` : "network");
      const j = (res && res.ok ? await res.json() : {}) as { error?: string; themes?: { tickers?: { symbol: string; pct?: number | null; pct_open?: number | null; skipped?: boolean }[] }[] };
      if (j.error) throw new Error(j.error);
      const map = new Map<string, SessionQuote>();
      for (const t of j.themes ?? []) for (const tk of t.tickers ?? []) {
        const today = tk.pct, open = tk.pct_open;
        if (tk.skipped || typeof today !== "number" || typeof open !== "number" || !Number.isFinite(today) || !Number.isFinite(open) || open <= -100) continue;
        const gap = ((1 + today / 100) / (1 + open / 100) - 1) * 100;
        map.set(tk.symbol.toUpperCase(), { today, open, gap: Math.round(gap * 100) / 100 });
      }
      if (symbolsRef.current.length) await candleQuotes(symbolsRef.current, supabaseUrl, anonKey, map);
      shared = { map, fetchedAt: Date.now() };
      setLive(shared);
      setError(map.size ? null : "no_open");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  // groups shown that the last fetch didn't cover → fetch again (once the list is known)
  const missing = (symbols ?? []).length > 0 && (!shared || (symbols ?? []).filter((x) => !shared!.map.has(x)).length > (symbols ?? []).length * 0.5);
  useEffect(() => { if (active && missing && !inflight.current) refresh(); }, [active, missing, refresh]);

  useEffect(() => {
    if (!active) return;
    if (!shared || Date.now() - shared.fetchedAt > REFRESH_MS) refresh();
    else setLive(shared);
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      if (isAwake() && marketClock().open) refresh();
    }, REFRESH_MS);
    const off = onWake(() => { if (marketClock().open && (!shared || Date.now() - shared.fetchedAt > REFRESH_MS)) refresh(); });
    return () => { window.clearInterval(id); off(); };
  }, [active, refresh]);

  return { live, loading, error, refresh };
}
