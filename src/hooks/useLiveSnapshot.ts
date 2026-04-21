import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface LiveQuote {
  symbol: string;
  price: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  shortName: string | null;
}

export interface LiveOptions {
  available: boolean;
  expiration: string | null;
  total_call_volume: number;
  total_put_volume: number;
  total_call_oi: number;
  total_put_oi: number;
  put_call_ratio: number | null;
  avg_iv: number | null;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  sentiment_explanation: string;
  unusual_activity: string[];
  high_iv_alert: boolean;
  iv_explanation: string;
}

export interface LiveSnapshot {
  symbol: string;
  quote: LiveQuote;
  options: LiveOptions;
  fetchedAt: string;
}

export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSymbolRef = useRef<string | null>(null);

  const fetchSnapshot = useCallback(async (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    lastSymbolRef.current = sym;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("live-execution-snapshot", {
        body: { symbol: sym },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      // Discard stale results if user typed another ticker meanwhile
      if (lastSymbolRef.current === sym) {
        setSnapshot(data as LiveSnapshot);
      }
    } catch (e) {
      if (lastSymbolRef.current === sym) {
        setError(e instanceof Error ? e.message : String(e));
        setSnapshot(null);
      }
    } finally {
      if (lastSymbolRef.current === sym) setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setSnapshot(null);
    setError(null);
    lastSymbolRef.current = null;
  }, []);

  return { snapshot, isLoading, error, fetchSnapshot, clear };
}

// ── Live watchlist persisted in localStorage ──
const LIVE_WATCH_KEY = "live-execution-watchlist-v1";

export function useLiveWatchlist() {
  const [tickers, setTickers] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LIVE_WATCH_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(LIVE_WATCH_KEY, JSON.stringify(tickers));
  }, [tickers]);

  const add = useCallback((sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setTickers((prev) => (prev.includes(s) ? prev : [...prev, s].slice(0, 20)));
  }, []);

  const remove = useCallback((sym: string) => {
    setTickers((prev) => prev.filter((t) => t !== sym));
  }, []);

  const has = useCallback((sym: string) => tickers.includes(sym.toUpperCase()), [tickers]);

  return { tickers, add, remove, has };
}
