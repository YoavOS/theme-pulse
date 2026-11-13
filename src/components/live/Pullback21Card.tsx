import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ZONE, analyzePullback, type Bar, type PullbackResult } from "@/lib/pullback21";

/**
 * 21 EMA pullback check — enter a ticker, get a light:
 *   green  = first green candle at the 21 EMA → buy-stop above its high
 *   yellow = in / near the zone, wait
 *   grey   = not a pullback yet (or already extended past the entry)
 *   red    = too deep, or the trend isn't intact
 * Distances are in ADRs (the stock's own daily range), so "close to the EMA" means the same
 * thing for a fast and a slow stock. Logic: lib/pullback21.ts.
 */

const LIGHT = {
  green: { dot: "bg-[hsl(222,82%,66%)] shadow-[0_0_14px_hsl(222,82%,66%)]", text: "text-[hsl(222,82%,71%)]", ring: "border-[hsl(222,82%,66%)]/40 bg-[hsl(222,82%,66%)]/[0.07]" },
  yellow: { dot: "bg-[hsl(40,95%,55%)] shadow-[0_0_14px_hsl(40,95%,55%)]", text: "text-[hsl(40,95%,62%)]", ring: "border-[hsl(40,95%,55%)]/40 bg-[hsl(40,95%,55%)]/[0.07]" },
  red: { dot: "bg-[hsl(330,72%,57%)] shadow-[0_0_14px_hsl(330,72%,57%)]", text: "text-[hsl(330,72%,61%)]", ring: "border-[hsl(330,72%,57%)]/40 bg-[hsl(330,72%,57%)]/[0.07]" },
  grey: { dot: "bg-muted-foreground/60", text: "text-muted-foreground", ring: "border-border bg-muted/20" },
} as const;

/** Horizontal gauge from −1.5 to +2 ADR with the zones, and a marker at the latest low. */
function ZoneGauge({ dist }: { dist: number }) {
  const MIN = -1.5, MAX = 2;
  const x = (v: number) => ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * 100;
  const seg = (a: number, b: number, cls: string, label: string) => (
    <div className={`absolute inset-y-0 ${cls}`} style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%` }} title={label} />
  );
  return (
    <div className="space-y-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-muted/40">
        {seg(MIN, ZONE.deep, "bg-[hsl(330,72%,57%)]/35", "Too deep")}
        {seg(ZONE.deep, ZONE.near, "bg-[hsl(222,82%,66%)]/45", "Zone")}
        {seg(ZONE.near, ZONE.far, "bg-[hsl(40,95%,55%)]/35", "Approaching")}
        <div className="absolute inset-y-0 w-px bg-foreground/70" style={{ left: `${x(0)}%` }} title="21 EMA" />
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow" style={{ left: `${x(dist)}%` }} />
      </div>
      <div className="relative h-3 font-mono text-[10px] text-muted-foreground">
        {[[-1, "−1"], [ZONE.deep, "−½"], [0, "EMA"], [ZONE.near, "+½"], [ZONE.far, "+1"]].map(([v, l]) => (
          <span key={String(l)} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(v as number)}%` }}>{l}</span>
        ))}
        <span className="absolute right-0 whitespace-nowrap">+2 ADR</span>
      </div>
    </div>
  );
}

export default function Pullback21Card({ symbol }: { symbol: string | null }) {
  const [input, setInput] = useState(symbol ?? "");
  const [sym, setSym] = useState<string | null>(symbol);
  const [res, setRes] = useState<PullbackResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const typed = useRef(false);

  // Follow the stock checked above, unless the user typed another ticker here.
  useEffect(() => { if (symbol && !typed.current) { setInput(symbol); setSym(symbol); } }, [symbol]);

  const run = useCallback(async (s: string) => {
    setLoading(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("daily-candles", { body: { history: s } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const r = analyzePullback((data?.bars ?? []) as Bar[], !!data?.barInProgress);
      if ("error" in r) { setRes(null); setErr(r.error); } else setRes(r);
    } catch (e) {
      setRes(null); setErr(e instanceof Error ? e.message : "Couldn't load the chart");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (sym) void run(sym); }, [sym, run]);

  const submit = () => { const s = input.trim().toUpperCase(); if (!s) return; typed.current = s !== symbol; setSym(s); if (s === sym) void run(s); };
  const L = res ? LIGHT[res.light] : null;

  return (
    <section className="rounded-xl border border-border/60 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-['Syne',sans-serif] text-lg font-bold uppercase tracking-wider text-foreground">21 EMA Pullback</h2>
        <Tooltip>
          <TooltipTrigger asChild><span className="inline-flex cursor-help"><Info size={14} className="text-muted-foreground" /></span></TooltipTrigger>
          <TooltipContent className="max-w-sm text-sm">
            Distance from the day's low to the 21 EMA, measured in the stock's average daily range (ADR) so "close" means the same for fast and slow stocks.
            Zone = within ½ ADR of the EMA (a deeper wick that closes back above counts). Green light = the first green candle in the zone: buy-stop above its high.
            Also checks the trend (21 EMA rising, above the 50), volume on the pullback and its depth.
          </TooltipContent>
        </Tooltip>
        <form className="ml-auto flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <span className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Ticker" aria-label="Ticker"
              className="h-8 w-28 rounded-md border border-border bg-background/60 pl-7 pr-2 font-mono text-sm uppercase" />
          </span>
          <button type="submit" disabled={loading || !input.trim()} className="h-8 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-40">
            {loading ? <Loader2 size={14} className="animate-spin" /> : "Check"}
          </button>
        </form>
      </div>

      {!sym && !loading && <p className="text-sm text-muted-foreground">Enter a ticker to check its pullback to the 21 EMA.</p>}
      {err && <p className="text-sm text-loss-medium">{sym}: {err}</p>}

      {res && L && (
        <div className={`space-y-3 rounded-lg border p-3 ${L.ring} ${loading ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-4 w-4 shrink-0 rounded-full ${L.dot}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-base font-bold">{sym}</span>
                <span className={`text-base font-bold ${L.text}`}>{res.headline}</span>
                {res.barInProgress && <span className="text-[11px] text-muted-foreground">· today's candle still forming</span>}
              </div>
              <p className="mt-0.5 text-sm leading-snug text-foreground/90">{res.advice}</p>
            </div>
          </div>

          {(res.trigger !== null || res.stop !== null) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {res.trigger !== null && <span className="rounded-md bg-background/60 px-2.5 py-1">Buy-stop <b className="font-mono">{res.trigger.toFixed(2)}</b></span>}
              {res.stop !== null && <span className="rounded-md bg-background/60 px-2.5 py-1">Stop <b className="font-mono">{res.stop.toFixed(2)}</b>
                {res.trigger !== null && <span className="ml-1 text-muted-foreground">({(((res.trigger - res.stop) / res.trigger) * 100).toFixed(1)}% risk)</span>}</span>}
            </div>
          )}

          <ZoneGauge dist={res.distAdr} />

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <span><span className="text-muted-foreground">Price </span><b className="font-mono">{res.price.toFixed(2)}</b></span>
            <span><span className="text-muted-foreground">21 EMA </span><b className="font-mono">{res.ema21.toFixed(2)}</b></span>
            <span><span className="text-muted-foreground">ADR </span><b className="font-mono">{res.adrPct.toFixed(1)}%</b></span>
            <span><span className="text-muted-foreground">Low vs EMA </span><b className="font-mono">{res.distAdr > 0 ? "+" : ""}{res.distAdr.toFixed(2)} ADR</b></span>
          </div>

          <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            {res.checks.map((c) => (
              <li key={c.label} className="flex items-center gap-1.5" title={c.detail}>
                {c.ok ? <Check size={13} className="text-[hsl(222,82%,68%)]" /> : <X size={13} className="text-loss-medium" />}
                <span className={`shrink-0 whitespace-nowrap ${c.ok ? "" : "text-loss-medium"}`}>{c.label}</span>
                <span className="truncate text-muted-foreground">· {c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
