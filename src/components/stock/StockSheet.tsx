import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Briefcase, ExternalLink, GraduationCap, Loader2, Trophy } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { openChart } from "@/lib/chart";
import { CHART } from "@/components/lens/QuarterlyChart";
import { AutoTerms } from "@/components/lens/Term";
import { StockChart, type Range } from "@/components/chart/StockChart";
import { loadBars } from "@/components/chart/ChartHost";
import { bellText, nextEarnings, pastReports, technicals, type Bars, type Context, type EarnRow, type NewsItem, type Quote } from "@/lib/portfolio/engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Extra facts the calling screen already knows (e.g. RS Alpha's row), shown as a strip in the panel. */
export interface StockFact { label: string; value: string; tone?: number | null; title?: string }
export interface StockSheetRequest { symbol: string; source?: string; facts?: StockFact[] }

/** Open the full stock side panel from anywhere (rendered once by <StockSheetHost/> in App). */
export function openStockSheet(req: StockSheetRequest | string) {
  const r = typeof req === "string" ? { symbol: req } : req;
  const symbol = String(r.symbol ?? "").toUpperCase().trim();
  if (symbol) window.dispatchEvent(new CustomEvent<StockSheetRequest>("tp:open-stock", { detail: { ...r, symbol } }));
}

const pctS = (v: number | null | undefined, d = 1) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const px = (v: number | null | undefined) => v == null ? "—" : v >= 1000 ? v.toFixed(0) : v.toFixed(2);
const tone = (v: number | null | undefined) => v == null || v === 0 ? undefined : v > 0 ? CHART.positive : CHART.negative;
const cap = (v: number | null | undefined) => v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const ago = (unix: number | null) => {
  if (!unix) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - unix) / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const toBars = (r: { d: string[]; o: unknown[]; h: unknown[]; l: unknown[]; c: unknown[]; v: unknown[] } | undefined): Bars | null =>
  r ? { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) } : null;

function Stat({ k, v, c, sub }: { k: string; v: ReactNode; c?: string; sub?: ReactNode }) {
  return <div><p className="text-[11px] text-muted-foreground"><AutoTerms text={k} /></p><p className="font-mono text-base" style={{ color: c }}>{v}</p>{sub && <p className="text-[10.5px] text-muted-foreground">{sub}</p>}</div>;
}

/** The stock side panel — the same layout as a Portfolio position, for any ticker. Mounted once in App. */
export function StockSheetHost() {
  const [req, setReq] = useState<StockSheetRequest | null>(null);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [bars, setBars] = useState<Bars | null>(null);
  const [spy, setSpy] = useState<Bars | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [earn, setEarn] = useState<EarnRow[]>([]);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [state, setState] = useState<"loading" | "downloading" | "ready" | "none">("loading");
  const [range, setRange] = useState<Range>(() => { try { return (localStorage.getItem("chart-range") as Range) || "6M"; } catch { return "6M"; } });
  useEffect(() => { try { localStorage.setItem("chart-range", range); } catch { /* ignore */ } }, [range]);

  const load = useCallback(async (s: string) => {
    setCtx(null); setBars(null); setSpy(null); setQuote(null); setEarn([]); setNews(null); setState("loading");
    const [c, quick] = await Promise.all([db.rpc("portfolio_context", { syms: [s] }), db.rpc("portfolio_bars", { syms: [s, "SPY"], n: 800 })]);
    setCtx(((c.data ?? [])[0] as Context) ?? null);
    const rows = (quick.data ?? []) as { symbol: string }[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const find = (x: string) => toBars(rows.find((r) => String(r.symbol).toUpperCase() === x) as any);
    setSpy(find("SPY"));
    let b = find(s);
    if (!b || b.c.length < 30) { setState("downloading"); b = await loadBars(s); }
    setBars(b); setState(b ? "ready" : "none");
    supabase.functions.invoke("portfolio-live", { body: { symbols: [s] } }).then(({ data }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      setQuote(d?.quotes?.[s] ?? null); setEarn(d?.earnings?.[s]?.rows ?? []); setNews(d?.news?.[s] ?? []);
    }).catch(() => setNews([]));
  }, []);

  useEffect(() => {
    const on = (e: Event) => { const r = (e as CustomEvent<StockSheetRequest>).detail; setReq(r); void load(r.symbol); };
    window.addEventListener("tp:open-stock", on);
    return () => window.removeEventListener("tp:open-stock", on);
  }, [load]);

  const symbol = req?.symbol ?? null;
  const last = bars?.c[bars.c.length - 1] ?? null, prev = bars && bars.c.length > 1 ? bars.c[bars.c.length - 2] : null;
  const price = quote?.price ?? last, base = quote?.price != null ? quote.prevClose : prev;
  const chg = price != null && base ? (price / base - 1) * 100 : null;
  const t = technicals(bars, spy, price);
  const plan = nextEarnings(earn);
  const reports = pastReports(earn, bars);
  const today = new Date().toISOString().slice(0, 10);
  const markers = earn.filter((e) => e.date <= today && e.epsActual != null).map((e) => ({ date: e.date, kind: "earnings" as const, title: `Earnings ${e.date}` }));
  const levels = quote?.price != null && bars && bars.d[bars.d.length - 1] < today ? [{ price: quote.price, label: `now ${quote.price.toFixed(2)}`, color: "hsl(var(--foreground))", dash: "2 3" }] : [];
  const link = "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary";

  return (
    <Sheet open={!!symbol} onOpenChange={(o) => !o && setReq(null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[860px]">
        {symbol && (
          <div className="space-y-5">
            <SheetHeader className="space-y-1 text-start">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">{[req?.source, ctx?.industry ?? ctx?.sector, ctx?.themes?.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "Stock"}</p>
              <SheetTitle className="flex flex-wrap items-baseline gap-x-3 text-2xl">
                <span className="font-mono">{symbol}</span>
                <span className="text-base font-normal text-muted-foreground">{ctx?.company ?? quote?.name ?? ""}</span>
              </SheetTitle>
              <SheetDescription>
                {price != null ? <>Last <span className="font-mono text-foreground">{px(price)}</span> <span style={{ color: tone(chg) }}>({pctS(chg, 2)} today)</span></> : "Loading price…"}
                {ctx?.market_cap != null && <> · market cap {cap(ctx.market_cap)}</>}
                {ctx?.sector && ctx?.industry && <> · {ctx.sector}</>}
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-2 text-xs">
                <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer" className={link}><ExternalLink size={12} />TradingView</a>
                <Link to={`/lens?symbol=${symbol}`} onClick={() => setReq(null)} className={link}><GraduationCap size={12} />Fundamentals</Link>
                <Link to={`/minervini?symbol=${symbol}`} onClick={() => setReq(null)} className={link}><Trophy size={12} />Minervini</Link>
                <button onClick={() => openChart(symbol)} className={link}><BarChart3 size={12} />Full chart</button>
                <Link to={`/portfolio?add=${symbol}`} onClick={() => setReq(null)} className={`${link} ms-auto border-primary/40 bg-primary/10 text-primary hover:bg-primary/20`}><Briefcase size={12} />Add to portfolio</Link>
              </div>
            </SheetHeader>

            {req?.facts?.length ? (
              <div className="flex flex-wrap gap-2">
                {req.facts.map((f) => <span key={f.label} title={f.title} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-[12px]"><span className="text-muted-foreground"><AutoTerms text={f.label} /></span> <b className="font-mono" style={{ color: tone(f.tone) }}>{f.value}</b></span>)}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-4">
              <Stat k="RS rating" v={ctx?.rs_rating ?? "—"} sub={t?.rs ? (t.rs.newHigh ? "RS line at a new high" : `RS line ${pctS(t.rs.fromHigh)} from its high`) : undefined} />
              <Stat k="Stage" v={ctx?.stage ? `${ctx.stage}${ctx.substage && ctx.substage !== String(ctx.stage) ? ctx.substage.replace(/^\d/, "") : ""}` : "—"} sub={ctx?.weeks_in_stage != null ? `${ctx.weeks_in_stage} weeks` : undefined} />
              <Stat k="vs 21-day EMA" v={pctS(t?.vsEma21)} c={tone(t?.vsEma21)} sub={t?.ema21 != null ? px(t.ema21) : undefined} />
              <Stat k="vs 50-day average" v={pctS(t?.vsSma50)} c={tone(t?.vsSma50)} sub={t?.atrAbove50 != null ? `${Math.abs(t.atrAbove50).toFixed(1)} ATR ${t.atrAbove50 >= 0 ? "above" : "below"}` : undefined} />
              <Stat k="vs 200-day average" v={pctS(t?.vsSma200)} c={tone(t?.vsSma200)} sub={t?.sma200 != null ? px(t.sma200) : "needs 200 days"} />
              <Stat k="From 52-week high" v={pctS(t?.fromHigh)} sub={t?.high52 != null ? `high ${px(t.high52)}` : undefined} />
              <Stat k="ATR" v={t?.atrPct != null ? `${t.atrPct.toFixed(1)}%` : "—"} sub={ctx?.adr_percent != null ? `ADR ${Number(ctx.adr_percent).toFixed(1)}%` : undefined} />
              <Stat k="Returns" v={pctS(ctx?.return_1m)} c={tone(ctx?.return_1m)} sub={`1W ${pctS(ctx?.return_1w)} · 3M ${pctS(ctx?.return_3m)}`} />
            </div>

            {state === "ready" && bars
              ? <StockChart bars={bars} height={380} markers={markers} levels={levels} range={range} onRange={setRange}
                  note={plan ? `Next report ${dayLabel(plan.date)}, ${bellText(plan.bell)}.` : bars.c.length < 200 ? `Only ${bars.c.length} days of history — the 200 SMA needs 200.` : null} />
              : state === "none" ? <p className="py-16 text-center text-sm text-muted-foreground">No daily prices found for {symbol}.</p>
              : <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />{state === "downloading" ? "Downloading 5 years of daily prices (first time only)…" : "Loading…"}</p>}

            <section>
              <h3 className="mb-2 text-sm font-semibold">Earnings</h3>
              {plan ? (
                <p className="mb-2 text-sm">Next report <b>{dayLabel(plan.date)}</b>, {bellText(plan.bell)}. The last full session before it is <b>{dayLabel(plan.lastSession)}</b> — {plan.sessionsLeft <= 0 ? "it is already in the price." : `${plan.sessionsLeft} session${plan.sessionsLeft === 1 ? "" : "s"} from now.`}{plan.bell === "unknown" && " The time isn't announced yet, so this counts it as before the open."}</p>
              ) : <p className="mb-2 text-sm text-muted-foreground">{news === null ? "Loading…" : "No upcoming report date published yet."}</p>}
              {reports.length > 0 && (
                <table className="w-full text-[12.5px]">
                  <thead className="text-[11px] text-muted-foreground"><tr className="text-end"><th className="text-start font-medium">Report</th><th className="font-medium">EPS vs est.</th><th className="font-medium">Revenue vs est.</th><th className="font-medium">Gap</th><th className="font-medium">Day</th></tr></thead>
                  <tbody>{reports.map((r) => (
                    <tr key={r.date} className="border-t border-border/60 text-end">
                      <td className="py-1 text-start font-mono">{r.date} <span className="text-[10px] text-muted-foreground">{r.hour?.toUpperCase() ?? ""}</span></td>
                      <td className="font-mono">{r.epsActual?.toFixed(2)} <span style={{ color: tone(r.epsSurprisePct) }}>({pctS(r.epsSurprisePct, 0)})</span></td>
                      <td className="font-mono" style={{ color: tone(r.revSurprisePct) }}>{pctS(r.revSurprisePct, 1)}</td>
                      <td className="font-mono" style={{ color: tone(r.gapPct) }}>{pctS(r.gapPct)}</td>
                      <td className="font-mono" style={{ color: tone(r.dayPct) }}>{pctS(r.dayPct)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">News</h3>
              {news === null ? <p className="text-sm text-muted-foreground">Loading…</p>
                : news.length === 0 ? <p className="text-sm text-muted-foreground">No news in the last 10 days.</p>
                : <ul className="divide-y divide-border/60">
                  {news.slice(0, 8).map((n, i) => (
                    <li key={i} className="py-1.5"><a href={n.url} target="_blank" rel="noreferrer" className="text-[13px] hover:text-primary">{n.headline}</a><p className="text-[11px] text-muted-foreground">{n.source} · {ago(n.time)} ago</p></li>
                  ))}
                </ul>}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
