import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * Slim market-context strip for the bottom of the dashboard: how many S&P 500
 * and Nasdaq 100 members rose vs fell over the dashboard's selected timeframe.
 * Data comes from the `index-drivers` edge function (full constituent lists).
 */

export type Tf = "today" | "1w" | "1m" | "3m";
const TF_OF: Record<string, Tf> = { Today: "today", "1W": "1w", "1M": "1m", "3M": "3m" };
const TF_LONG: Record<Tf, string> = { today: "today", "1w": "over the last week", "1m": "over the last month", "3m": "over the last 3 months" };
const INDEXES = [
  { key: "SPY", label: "S&P 500" },
  { key: "QQQ", label: "Nasdaq 100" },
] as const;

export interface Breadth { indexPct: number | null; up: number; down: number; known: number; at: number }

const CACHE_KEY = "index_breadth_v1";
const ttlFor = (tf: Tf) => (tf === "today" ? 5 * 60_000 : 60 * 60_000);

function readCache(): Record<string, Breadth> {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeCache(k: string, v: Breadth) {
  try { const all = readCache(); all[k] = v; sessionStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// One request per index+timeframe at a time: the strip and the Brief panel both ask for
// "today" on load, and each request makes the backend check ~600 stocks.
const inflight = new Map<string, Promise<Breadth | null>>();
function load(index: string, tf: Tf): Promise<Breadth | null> {
  const k = `${index}:${tf}`;
  const running = inflight.get(k);
  if (running) return running;
  const p = loadOnce(index, tf).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

async function loadOnce(index: string, tf: Tf): Promise<Breadth | null> {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-drivers`;
  const res = await fetch(`${base}?index=${index}&timeframe=${tf}`, {
    headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
  });
  if (!res.ok) return null;
  const j = await res.json();
  const b = j?.breadth;
  if (!b) return null;
  return {
    indexPct: typeof j.indexPct === "number" ? j.indexPct : null,
    up: Number(b.advancers) || 0,
    down: Number(b.decliners) || 0,
    known: Number(b.known ?? (Number(b.advancers) || 0) + (Number(b.decliners) || 0)),
    at: Date.now(),
  };
}

/** Shared loader (cached per index + timeframe) — also used by the dashboard Brief panel. */
export function useIndexBreadth(tf: Tf | undefined) {
  const [data, setData] = useState<Record<string, Breadth | null>>({});
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (force: boolean) => {
    if (!tf) return;
    const cache = readCache();
    const fresh: Record<string, Breadth | null> = {};
    const todo: string[] = [];
    for (const { key } of INDEXES) {
      const c = cache[`${key}:${tf}`];
      if (!force && c && Date.now() - c.at < ttlFor(tf)) fresh[key] = c;
      else todo.push(key);
    }
    setData(fresh);
    if (!todo.length) return;
    setLoading(true);
    try {
      const got = await Promise.all(todo.map((k) => load(k, tf).catch(() => null)));
      setData((prev) => {
        const next = { ...prev };
        todo.forEach((k, i) => { next[k] = got[i]; if (got[i]) writeCache(`${k}:${tf}`, got[i]!); });
        return next;
      });
    } finally { setLoading(false); }
  }, [tf]);

  useEffect(() => { void run(false); }, [run]);
  return { spy: data.SPY, qqq: data.QQQ, data, loading, refresh: () => run(true) };
}

export default function IndexBreadthStrip({ timeframe }: { timeframe: string }) {
  const tf = TF_OF[timeframe];
  const { data, loading, refresh } = useIndexBreadth(tf);

  if (!tf) return null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card px-4 py-3" aria-label="Index breadth">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="font-display text-[13px] font-semibold tracking-tight">Index breadth</h2>
        <span className="text-[11px] text-muted-foreground">Members that rose vs fell {TF_LONG[tf]}</span>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Refresh"
          aria-label="Refresh index breadth"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 [&>*]:min-w-0">
        {INDEXES.map(({ key, label }) => <IndexBar key={key} label={label} b={data[key]} loading={loading && data[key] === undefined} />)}
      </div>
    </section>
  );
}

function IndexBar({ label, b, loading }: { label: string; b: Breadth | null | undefined; loading: boolean }) {
  const total = b ? b.up + b.down : 0;
  const upShare = total ? b!.up / total : 0.5;
  const pct = b?.indexPct;
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 text-[12px]">
        <span className="font-semibold">{label}</span>
        {typeof pct === "number" && (
          <span className={`font-mono text-[11.5px] ${pct > 0 ? "text-gain-medium" : pct < 0 ? "text-loss-medium" : "text-muted-foreground"}`}>
            {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
          </span>
        )}
        {b && total > 0 && <span className="text-[11px] text-muted-foreground">{Math.round(upShare * 100)}% rising</span>}
      </div>
      {b && total > 0 ? (
        <>
          <div className="flex justify-between font-mono text-[11.5px] tabular-nums">
            <span className="text-gain-medium">Gainers {b.up}</span>
            <span className="text-loss-medium">Losers {b.down}</span>
          </div>
          <div className="mt-1 flex h-1.5 gap-1" role="img" aria-label={`${b.up} gainers, ${b.down} losers`}>
            <span className="rounded-full bg-gain-medium" style={{ width: `${upShare * 100}%` }} />
            <span className="flex-1 rounded-full bg-loss-medium" />
          </div>
        </>
      ) : (
        <div className="flex h-[26px] items-center text-[11px] text-muted-foreground">
          {loading || b === undefined ? "Loading…" : "Not available right now"}
        </div>
      )}
    </div>
  );
}
