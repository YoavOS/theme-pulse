import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Extended per-symbol price/volume metrics used by the Theme Setup Analyzer.
 * All fields come from the SAME cached 1y OHLC row the 52-week-high function
 * already reads — no extra API calls, plus a 24h localStorage layer per symbol.
 */
export interface SetupMetrics {
  high52w: number | null;
  low52w: number | null;
  latestClose: number | null;
  pctBelowHigh: number | null;
  pctAboveLow: number | null;
  lastHighDaysAgo: number | null;
  lastLowDaysAgo: number | null;
  rangePos: number | null;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  avgVol10: number | null;
  avgVol30: number | null;
  dollarVol10: number | null;
  volSurgePct: number | null;
  coilWeekly: number | null;
  coilMonthly: number | null;
}

/** User-adjustable coil (range-contraction) windows. */
export interface CoilConfig {
  weeklyRecent: number;
  weeklyBase: number;
  monthlyRecent: number;
  monthlyBase: number;
}

export const DEFAULT_COIL_CONFIG: CoilConfig = {
  weeklyRecent: 7,
  weeklyBase: 30,
  monthlyRecent: 3,
  monthlyBase: 9,
};

export const COIL_CONFIG_KEY = "rs-coil-windows-v1";

export function loadCoilConfig(): CoilConfig {
  if (typeof window === "undefined") return DEFAULT_COIL_CONFIG;
  try {
    const raw = localStorage.getItem(COIL_CONFIG_KEY);
    if (!raw) return DEFAULT_COIL_CONFIG;
    return { ...DEFAULT_COIL_CONFIG, ...(JSON.parse(raw) as Partial<CoilConfig>) };
  } catch {
    return DEFAULT_COIL_CONFIG;
  }
}

export function coilConfigKey(c: CoilConfig): string {
  return `${c.weeklyRecent}-${c.weeklyBase}-${c.monthlyRecent}-${c.monthlyBase}`;
}

// v3: cache is namespaced by the coil window config so changing the windows
// never surfaces stale ratios computed with the old settings.
const LS_PREFIX = "rs-setup-metrics-v3:";
const LS_TTL_MS = 24 * 60 * 60 * 1000;

type Stored = SetupMetrics & { at: number };
type Store = Record<string, Stored>;

function storeKey(cfg: CoilConfig) {
  return LS_PREFIX + coilConfigKey(cfg);
}

function readStore(cfg: CoilConfig): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storeKey(cfg));
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}
function writeStore(cfg: CoilConfig, s: Store) {
  try {
    localStorage.setItem(storeKey(cfg), JSON.stringify(s));
  } catch {
    /* quota — ignore */
  }
}

/** Drops legacy caches and any namespace that isn't the active config. */
export function purgeStaleSetupMetricCaches(active: CoilConfig) {
  if (typeof window === "undefined") return;
  try {
    const keep = storeKey(active);
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === "rs-setup-metrics-v2" || k === "rs-setup-metrics" || (k.startsWith(LS_PREFIX) && k !== keep)) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

function pick(r: Record<string, unknown>): SetupMetrics {
  const n = (k: string) => {
    const v = r[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    high52w: n("high52w"),
    low52w: n("low52w"),
    latestClose: n("latestClose"),
    pctBelowHigh: n("pctBelowHigh"),
    pctAboveLow: n("pctAboveLow"),
    lastHighDaysAgo: n("lastHighDaysAgo"),
    lastLowDaysAgo: n("lastLowDaysAgo"),
    rangePos: n("rangePos"),
    sma50: n("sma50"),
    sma150: n("sma150"),
    sma200: n("sma200"),
    avgVol10: n("avgVol10"),
    avgVol30: n("avgVol30"),
    dollarVol10: n("dollarVol10"),
    volSurgePct: n("volSurgePct"),
    coilWeekly: n("coilWeekly"),
    coilMonthly: n("coilMonthly"),
  };
}

export function useSetupMetrics() {
  const [map, setMap] = useState<Map<string, SetupMetrics>>(new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const inflight = useRef(false);

  /** Loads metrics for symbols, using the 24h localStorage cache first. */
  const load = useCallback(async (symbols: string[]) => {
    if (inflight.current || symbols.length === 0) return;
    inflight.current = true;
    setLoading(true);
    try {
      const store = readStore();
      const now = Date.now();
      const next = new Map<string, SetupMetrics>();
      const need: string[] = [];
      for (const s of symbols) {
        const hit = store[s];
        if (hit && now - hit.at < LS_TTL_MS) {
          const { at: _at, ...rest } = hit;
          next.set(s, rest);
        } else {
          need.push(s);
        }
      }
      setMap(new Map(next));
      setProgress({ done: symbols.length - need.length, total: symbols.length });
      if (need.length === 0) return;

      const CHUNK = 300;
      for (let i = 0; i < need.length; i += CHUNK) {
        const slice = need.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("fifty-two-week-highs", {
          body: { symbols: slice },
        });
        if (error) throw new Error(error.message);
        const rows = (data as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
        const store2 = readStore();
        const stamp = Date.now();
        for (const r of rows) {
          const sym = String(r.symbol ?? "").toUpperCase();
          if (!sym) continue;
          const m = pick(r);
          next.set(sym, m);
          store2[sym] = { ...m, at: stamp };
        }
        writeStore(store2);
        setMap(new Map(next));
        setProgress({ done: Math.min(symbols.length, symbols.length - need.length + i + slice.length), total: symbols.length });
      }
    } catch {
      /* fail soft — partial metrics still usable */
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  return { metrics: map, loading, progress, load };
}
