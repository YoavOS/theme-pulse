import { useCallback, useEffect, useState } from "react";

// Personal watchlist: symbols starred anywhere in the app (Stages, Bases, Minervini, Model Book).
// Kept in this browser only — a light per-viewer convenience, like a remembered filter.
const KEY = "watchlist_v1";
const EVENT = "watchlist-changed";

export interface WatchItem { symbol: string; added: string; note?: string }

function read(): WatchItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as WatchItem[]) : [];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.symbol === "string") : [];
  } catch { return []; }
}
function write(items: WatchItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota / private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useWatchlist() {
  const [items, setItems] = useState<WatchItem[]>(read);
  useEffect(() => {
    const on = () => setItems(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  const has = useCallback((sym: string) => items.some((x) => x.symbol === sym.toUpperCase()), [items]);
  const toggle = useCallback((sym: string) => {
    const s = sym.toUpperCase();
    const cur = read();
    write(cur.some((x) => x.symbol === s) ? cur.filter((x) => x.symbol !== s) : [{ symbol: s, added: new Date().toISOString().slice(0, 10) }, ...cur]);
  }, []);
  const setNote = useCallback((sym: string, note: string) => {
    write(read().map((x) => (x.symbol === sym.toUpperCase() ? { ...x, note } : x)));
  }, []);
  const clear = useCallback(() => write([]), []);
  return { items, has, toggle, setNote, clear };
}
