// Local cache for Live Execution fundamentals.
// Fundamentals (EPS / Revenue growth, Forward P/E, etc.) change at most a few
// times per quarter, so we cache them in localStorage and only re-fetch on a
// manual "Refresh Fundamentals" click. The 7s auto-refresh of prices/RS does
// not touch this cache.

import type { LiveFundamentals } from "@/hooks/useLiveSnapshot";

const KEY = "live-execution-fundamentals-v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h soft TTL

interface Entry {
  symbol: string;
  fundamentals: LiveFundamentals;
  sectorPeAvg: number | null;
  fetchedAt: number;
}

type Store = Record<string, Entry>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded — best effort */
  }
}

export function getCachedFundamentals(symbol: string): Entry | null {
  const sym = symbol.toUpperCase();
  const entry = readStore()[sym];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) return null;
  return entry;
}

export function setCachedFundamentals(
  symbol: string,
  fundamentals: LiveFundamentals,
  sectorPeAvg: number | null,
) {
  const sym = symbol.toUpperCase();
  const store = readStore();
  store[sym] = { symbol: sym, fundamentals, sectorPeAvg, fetchedAt: Date.now() };
  writeStore(store);
}

export function clearCachedFundamentals(symbol: string) {
  const sym = symbol.toUpperCase();
  const store = readStore();
  delete store[sym];
  writeStore(store);
}
