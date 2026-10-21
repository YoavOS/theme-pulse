import { useCallback, useEffect, useRef, useState } from "react";

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

export function useLiveSession(active: boolean) {
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
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { error?: string; themes?: { tickers?: { symbol: string; pct?: number | null; pct_open?: number | null; skipped?: boolean }[] }[] };
      if (j.error) throw new Error(j.error);
      const map = new Map<string, SessionQuote>();
      for (const t of j.themes ?? []) for (const tk of t.tickers ?? []) {
        const today = tk.pct, open = tk.pct_open;
        if (tk.skipped || typeof today !== "number" || typeof open !== "number" || !Number.isFinite(today) || !Number.isFinite(open) || open <= -100) continue;
        const gap = ((1 + today / 100) / (1 + open / 100) - 1) * 100;
        map.set(tk.symbol.toUpperCase(), { today, open, gap: Math.round(gap * 100) / 100 });
      }
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

  useEffect(() => {
    if (!active) return;
    if (!shared || Date.now() - shared.fetchedAt > REFRESH_MS) refresh();
    else setLive(shared);
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      if (document.visibilityState === "visible" && marketClock().open) refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  return { live, loading, error, refresh };
}
