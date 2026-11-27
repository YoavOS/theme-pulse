import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Briefcase, ExternalLink, GraduationCap, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { nextEarnings, type Bars, type Context, type EarnRow, type Quote } from "@/lib/portfolio/engine";
import { openChart } from "@/lib/chart";
import { CHART } from "@/components/lens/QuarterlyChart";
import { StockChart, type Range } from "./StockChart";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Bars for one symbol from the PC's daily prices; downloads them first when the PC doesn't have them. */
export async function loadBars(symbol: string, n = 800): Promise<Bars | null> {
  const get = async () => {
    const { data } = await db.rpc("portfolio_bars", { syms: [symbol], n });
    const r = (data ?? [])[0];
    return r ? { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) } as Bars : null;
  };
  const first = await get();
  if (first && first.c.length >= 30) return first;
  await supabase.functions.invoke("daily-bars", { body: { symbols: [symbol] } }).catch(() => null);
  return (await get()) ?? first;
}

/** The chart pop-up. Mounted once in App; any screen opens it with openChart(symbol). */
export function ChartHost() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [bars, setBars] = useState<Bars | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [earn, setEarn] = useState<EarnRow[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "downloading" | "ready" | "none">("idle");
  const [range, setRange] = useState<Range>(() => { try { return (localStorage.getItem("chart-range") as Range) || "6M"; } catch { return "6M"; } });
  useEffect(() => { try { localStorage.setItem("chart-range", range); } catch { /* ignore */ } }, [range]);

  const load = useCallback(async (s: string) => {
    setBars(null); setCtx(null); setQuote(null); setEarn([]); setState("loading");
    const [c, quick] = await Promise.all([
      db.rpc("portfolio_context", { syms: [s] }),
      db.rpc("portfolio_bars", { syms: [s], n: 800 }),
    ]);
    setCtx(((c.data ?? [])[0] as Context) ?? null);
    const r = (quick.data ?? [])[0];
    let b: Bars | null = r ? { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) } : null;
    if (!b || b.c.length < 30) { setState("downloading"); b = await loadBars(s); }
    setBars(b); setState(b ? "ready" : "none");
    supabase.functions.invoke("portfolio-live", { body: { symbols: [s], parts: ["quotes", "earnings"] } }).then(({ data }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setQuote(d?.quotes?.[s] ?? null); setEarn(d?.earnings?.[s]?.rows ?? []);
    }).catch(() => null);
  }, []);

  useEffect(() => {
    const on = (e: Event) => { const s = (e as CustomEvent<string>).detail; setSymbol(s); void load(s); };
    window.addEventListener("tp:open-chart", on);
    return () => window.removeEventListener("tp:open-chart", on);
  }, [load]);

  const last = bars?.c[bars.c.length - 1] ?? null, prev = bars && bars.c.length > 1 ? bars.c[bars.c.length - 2] : null;
  const price = quote?.price ?? last, base = quote?.price != null ? quote.prevClose : prev;
  const chg = price != null && base ? (price / base - 1) * 100 : null;
  const plan = nextEarnings(earn);
  const today = new Date().toISOString().slice(0, 10);
  const markers = earn.filter((e) => e.date <= today && e.epsActual != null).map((e) => ({ date: e.date, kind: "earnings" as const, title: `Earnings ${e.date}` }));
  const levels = quote?.price != null && bars && bars.d[bars.d.length - 1] < today ? [{ price: quote.price, label: `now ${quote.price.toFixed(2)}`, color: "hsl(var(--foreground))", dash: "2 3" }] : [];

  return (
    <Dialog open={!!symbol} onOpenChange={(o) => !o && setSymbol(null)}>
      <DialogContent className="max-h-[94vh] w-[96vw] max-w-[1180px] overflow-y-auto p-5">
        {symbol && (
          <>
            <DialogHeader className="space-y-1 text-start">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">{[ctx?.industry ?? ctx?.sector, ctx?.themes?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "Daily chart"}</p>
              <DialogTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl">
                <span className="font-mono">{symbol}</span>
                <span className="text-base font-normal text-muted-foreground">{ctx?.company ?? quote?.name ?? ""}</span>
                {price != null && <span className="font-mono text-xl">{price.toFixed(2)}{chg != null && <span className="ms-2 text-base" style={{ color: chg >= 0 ? CHART.positive : CHART.negative }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}</span>}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {ctx?.rs_rating != null && <span className="rounded-md bg-muted px-2 py-0.5">RS <b className="font-mono">{ctx.rs_rating}</b></span>}
                  {ctx?.stage != null && <span className="rounded-md bg-muted px-2 py-0.5">Stage <b className="font-mono">{ctx.substage ?? ctx.stage}</b>{ctx.weeks_in_stage != null ? ` · ${ctx.weeks_in_stage}w` : ""}</span>}
                  {plan && <span className={`rounded-md px-2 py-0.5 ${plan.sessionsLeft <= 5 ? "bg-amber-400/15 text-amber-200" : "bg-muted"}`}>Earnings {plan.date} {plan.bell === "before" ? "before the open" : plan.bell === "after" ? "after the close" : ""} · {plan.sessionsLeft} session{plan.sessionsLeft === 1 ? "" : "s"} left</span>}
                  <span className="ms-auto flex gap-2">
                    <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><ExternalLink size={12} />TradingView</a>
                    <Link to={`/lens?symbol=${symbol}`} onClick={() => setSymbol(null)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><GraduationCap size={12} />Fundamentals</Link>
                    <Link to={`/portfolio?add=${symbol}`} onClick={() => setSymbol(null)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><Briefcase size={12} />Add to portfolio</Link>
                  </span>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3">
              {state === "ready" && bars ? <StockChart bars={bars} markers={markers} levels={levels} range={range} onRange={setRange} height={420}
                note={bars.c.length < 200 ? `Only ${bars.c.length} days of history — the 200 SMA needs 200.` : null} />
                : state === "none" ? <p className="py-16 text-center text-sm text-muted-foreground">No daily prices found for {symbol}.</p>
                : <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />{state === "downloading" ? "Downloading 5 years of daily prices (first time only)…" : "Loading…"}</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Small chart icon for lists whose ticker has no link. */
export function ChartButton({ symbol, className = "" }: { symbol: string; className?: string }) {
  return (
    <button type="button" title={`Chart ${symbol}`} aria-label={`Chart ${symbol}`}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); openChart(symbol); }}
      className={`inline-flex items-center justify-center rounded p-0.5 text-muted-foreground opacity-70 transition hover:bg-muted hover:text-primary hover:opacity-100 ${className}`}>
      <BarChart3 size={12} />
    </button>
  );
}
