import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, BarChart3, CheckCircle2, ExternalLink, GraduationCap, MoreHorizontal, Pencil, Trash2, Trophy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openChart } from "@/lib/chart";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CHART } from "@/components/lens/QuarterlyChart";
import { AutoTerms } from "@/components/lens/Term";
import { Panel, Watch } from "@/components/lens/LensUI";
import { bellText, type Alert, type ClosedTrade, type Context, type EarningsPlan, type Holding, type NewsItem, type PastReport, type PositionRow, type Summary, type Technicals } from "@/lib/portfolio/engine";
import type { PortfolioData } from "@/hooks/usePortfolio";
import { StockChart, type Level, type Marker } from "@/components/chart/StockChart";

// ── formatting ────────────────────────────────────────────────────────────────
export const usd = (v: number | null | undefined, d = 0) => v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const usdSigned = (v: number | null | undefined) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const pctS = (v: number | null | undefined, d = 1) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
export const px = (v: number | null | undefined) => v == null ? "—" : v >= 1000 ? v.toFixed(0) : v.toFixed(2);
export const tone = (v: number | null | undefined) => v == null || v === 0 ? undefined : v > 0 ? CHART.positive : CHART.negative;
export const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const ago = (unix: number | null) => {
  if (!unix) return "";
  const m = Math.max(0, Math.round((Date.now() / 1000 - unix) / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const tv = (s: string) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s)}`;
const LEVEL_STYLE: Record<Alert["level"], string> = {
  high: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  low: "border-border bg-muted/30 text-muted-foreground",
  good: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
};
const bellShort = (b: EarningsPlan["bell"]) => b === "before" ? "BMO" : b === "after" ? "AMC" : b === "during" ? "DMH" : "time?";

export function SymbolCell({ symbol, ctx }: { symbol: string; ctx: Context | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-sm font-semibold">{symbol}</p>
      <p className="max-w-[150px] truncate text-[11px] text-muted-foreground" title={ctx?.company ?? undefined}>{ctx?.company ?? ""}</p>
    </div>
  );
}

function StageTag({ c }: { c: Context | null | undefined }) {
  if (!c?.stage) return <span className="text-muted-foreground">—</span>;
  const col = c.stage === 2 ? CHART.positive : c.stage === 4 ? CHART.negative : c.stage === 3 ? CHART.growth : CHART.neutral;
  return <span className="rounded px-1.5 py-0.5 font-mono text-[11px]" style={{ color: col, background: `color-mix(in srgb, ${col} 14%, transparent)` }} title={c.weeks_in_stage != null ? `${c.weeks_in_stage} weeks in stage` : undefined}>S{c.stage}{c.substage && c.substage !== String(c.stage) ? c.substage.replace(/^\d/, "") : ""}</span>;
}

export function EarningsBadge({ plan, warn }: { plan: EarningsPlan | null | undefined; warn: number }) {
  if (!plan) return <span className="text-[11px] text-muted-foreground">no date yet</span>;
  const urgent = plan.sessionsLeft <= 2, soon = plan.sessionsLeft <= warn;
  return (
    <div className="leading-tight" title={`Reports ${dayLabel(plan.date)}, ${bellText(plan.bell)}. Last full session before the report: ${dayLabel(plan.lastSession)}.`}>
      <p className={`font-mono text-[13px] ${urgent ? "text-rose-300" : soon ? "text-amber-200" : ""}`}>{plan.date.slice(5)} <span className="text-[10px] text-muted-foreground">{bellShort(plan.bell)}</span></p>
      <p className={`whitespace-nowrap text-[10px] ${urgent ? "text-rose-300" : soon ? "text-amber-200" : "text-muted-foreground"}`}>{plan.sessionsLeft <= 0 ? "in the price" : `${plan.sessionsLeft} session${plan.sessionsLeft === 1 ? "" : "s"} left`}</p>
    </div>
  );
}

// ── Needs attention ───────────────────────────────────────────────────────────
export function AttentionPanel({ alerts, onOpen }: { alerts: Alert[]; onOpen: (s: string) => void }) {
  const important = alerts.filter((a) => a.level !== "low" || a.kind === "news");
  const quiet = alerts.filter((a) => !important.includes(a));
  const [all, setAll] = useState(false);
  const shown = all ? [...important, ...quiet] : important;
  return (
    <Panel id="pf-attention" eyebrow="Today" title="Needs attention">
      {!alerts.length ? <p className="text-sm text-muted-foreground">Nothing flagged: no report inside your warning window, no stop touched, nothing below its 50-day.</p> : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {shown.map((a, i) => (
              <button key={i} onClick={() => onOpen(a.symbol)} className={`flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-start text-[12.5px] transition-colors hover:brightness-125 ${LEVEL_STYLE[a.level]}`}>
                <span className="font-mono font-semibold">{a.symbol}</span><span className="min-w-0"><AutoTerms text={a.text} /></span>
              </button>
            ))}
          </div>
          {quiet.length > 0 && <button onClick={() => setAll(!all)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">{all ? "Show fewer" : `+ ${quiet.length} minor note${quiet.length > 1 ? "s" : ""}`}</button>}
        </div>
      )}
    </Panel>
  );
}

// ── Holdings table ────────────────────────────────────────────────────────────
type SortKey = "symbol" | "weight" | "openPct" | "dayPct" | "r" | "rs" | "earn" | "vs21" | "vs50";
export function HoldingsTable({ p, onOpen, onClose, onDelete }: { p: PortfolioData; onOpen: (s: string) => void; onClose: (s: string) => void; onDelete: (s: string) => void }) {
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: "weight", asc: false });
  const rows = useMemo(() => {
    const val = (h: Holding): number | string => {
      const t = p.tech[h.symbol], c = p.ctx[h.symbol], e = p.plans[h.symbol];
      switch (sort.k) {
        case "symbol": return h.symbol;
        case "weight": return h.weight ?? -1;
        case "openPct": return h.openPct ?? -999;
        case "dayPct": return h.dayPct ?? -999;
        case "r": return h.rMultiple ?? -999;
        case "rs": return c?.rs_rating ?? -1;
        case "earn": return e ? e.sessionsLeft : 9999;
        case "vs21": return t?.vsEma21 ?? -999;
        case "vs50": return t?.vsSma50 ?? -999;
      }
    };
    return [...p.holdings].sort((a, b) => { const x = val(a), y = val(b); const r = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number); return sort.asc ? r : -r; });
  }, [p.holdings, p.tech, p.ctx, p.plans, sort]);
  const H = ({ k, children, className = "" }: { k?: SortKey; children?: ReactNode; className?: string }) => (
    <th className={`whitespace-nowrap px-2 py-2.5 font-medium ${className}`}>
      {k ? <button onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : k === "earn" || k === "symbol" }))} className="inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-foreground">
        {children}{sort.k === k && (sort.asc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}</button> : children}
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card/40">
      <table className="w-full min-w-[960px] text-[13.5px]">
        <thead className="border-b border-border bg-muted/20 text-[11.5px] uppercase tracking-wide text-muted-foreground">
          <tr className="text-end">
            <H k="symbol" className="text-start">Symbol</H>
            <H>Invested</H><H>Last</H><H k="dayPct">Today</H><H k="weight">Weight</H>
            <H k="openPct">Open P&amp;L</H><H k="r">R</H><H>Stop</H>
            <H k="rs" className="text-center">RS</H><H className="text-center">Stage</H><H k="vs21">21 EMA</H><H k="vs50">50-day</H>
            <H k="earn" className="text-start">Earnings</H><H />
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const t = p.tech[h.symbol], c = p.ctx[h.symbol];
            const group = c?.themes?.[0] ?? c?.industry ?? c?.sector ?? "";
            return (
              <tr key={h.symbol} onClick={() => onOpen(h.symbol)} className="cursor-pointer whitespace-nowrap border-b border-border/60 text-end transition-colors last:border-0 hover:bg-muted/30">
                <td className="px-2 py-3 text-start">
                  <div className="flex items-center gap-1"><span className="font-mono text-base font-semibold">{h.symbol}</span>{h.lots.length > 1 && <span className="text-[11px] text-muted-foreground">×{h.lots.length}</span>}</div>
                  <p className="max-w-[190px] truncate text-[11.5px] text-muted-foreground" title={[c?.company, c?.themes?.join(", "), c?.industry].filter(Boolean).join(" · ")}>{group || c?.company || ""}</p>
                </td>
                <td className="px-2 py-3 font-mono">{usd(h.cost)}<p className="text-[11px] text-muted-foreground">@ {px(h.avgCost)}</p></td>
                <td className="px-2 py-3 font-mono">{px(h.price)}{!h.priceIsLive && <span className="ms-0.5 text-[9px] text-muted-foreground" title="Last daily close (no live quote)">c</span>}</td>
                <td className="px-2 py-3 font-mono" style={{ color: tone(h.dayPct) }}>{pctS(h.dayPct, 2)}<p className="text-[11px]">{usdSigned(h.dayPnl)}</p></td>
                <td className="px-2 py-3"><div className="flex items-center justify-end gap-1.5"><div className="h-2 w-12 overflow-hidden rounded bg-muted"><div className="h-full bg-primary/70" style={{ width: `${Math.min(100, h.weight ?? 0)}%` }} /></div><span className="w-10 font-mono">{h.weight != null ? `${h.weight.toFixed(1)}%` : "—"}</span></div></td>
                <td className="px-2 py-3 font-mono" style={{ color: tone(h.openPnl) }}>{usdSigned(h.openPnl)}<p className="text-[11px]">{pctS(h.openPct)}</p></td>
                <td className="px-2 py-3 font-mono" style={{ color: tone(h.rMultiple) }}>{h.rMultiple != null ? `${h.rMultiple >= 0 ? "+" : "−"}${Math.abs(h.rMultiple).toFixed(1)}R` : "—"}</td>
                <td className="px-2 py-3 font-mono">{h.stop != null ? <>{px(h.stop)}<p className="text-[11px] text-muted-foreground">{pctS(h.stopDistPct)}</p></> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-2 py-3 text-center font-mono" style={{ color: c?.rs_rating == null ? undefined : c.rs_rating >= 80 ? CHART.positive : c.rs_rating < 40 ? CHART.negative : undefined }}>
                  {c?.rs_rating ?? "—"}{t?.rs?.newHigh && <span className="ms-0.5" title="RS line at a new 52-week high" style={{ color: "hsl(222,82%,66%)" }}>●</span>}</td>
                <td className="px-2 py-3 text-center"><StageTag c={c} /></td>
                <td className="px-2 py-3 font-mono" style={{ color: tone(t?.vsEma21) }}>{pctS(t?.vsEma21)}</td>
                <td className="px-2 py-3 font-mono" style={{ color: tone(t?.vsSma50) }}>{pctS(t?.vsSma50)}{t?.atrAbove50 != null && <p className="text-[11px] text-muted-foreground">{t.atrAbove50.toFixed(1)} ATR</p>}</td>
                <td className="px-2 py-3 text-start"><EarningsBadge plan={p.plans[h.symbol]} warn={p.settings.warnSessions} /></td>
                <td className="px-1 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${h.symbol} actions`}><MoreHorizontal size={14} /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 text-[12.5px]">
                      <DropdownMenuItem onSelect={() => openChart(h.symbol)} className="gap-2"><BarChart3 size={13} />Chart</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onOpen(h.symbol)} className="gap-2"><Pencil size={13} />Details and edit</DropdownMenuItem>
                      <DropdownMenuItem asChild className="gap-2"><Link to={`/lens?symbol=${h.symbol}`}><GraduationCap size={13} />Fundamentals</Link></DropdownMenuItem>
                      <DropdownMenuItem asChild className="gap-2"><Link to={`/minervini?symbol=${h.symbol}`}><Trophy size={13} />Minervini</Link></DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onClose(h.symbol)} className="gap-2"><CheckCircle2 size={13} />Close position…</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onDelete(h.symbol)} className="gap-2 text-rose-300 focus:text-rose-200"><Trash2 size={13} />Delete (not recorded)…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Earnings ──────────────────────────────────────────────────────────────────
export function EarningsPanel({ p, onOpen }: { p: PortfolioData; onOpen: (s: string) => void }) {
  const upcoming = p.holdings.map((h) => ({ h, plan: p.plans[h.symbol] })).filter((x) => x.plan).sort((a, b) => a.plan!.date.localeCompare(b.plan!.date));
  const missing = p.holdings.filter((h) => !p.plans[h.symbol]);
  return (
    <Panel id="pf-earnings" eyebrow="Earnings" title="When each holding reports">
      {p.finnhub === false && <Watch>Earnings dates need a Finnhub key in <code>local/keys.env</code> (FINNHUB_API_KEY).</Watch>}
      <div className="space-y-2">
        {upcoming.map(({ h, plan }) => {
          const last = p.reports[h.symbol]?.[0];
          const urgent = plan!.sessionsLeft <= 2, soon = plan!.sessionsLeft <= p.settings.warnSessions;
          return (
            <button key={h.symbol} onClick={() => onOpen(h.symbol)} className={`grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2 text-start transition-colors hover:bg-muted/30 ${urgent ? "border-rose-400/30 bg-rose-400/5" : soon ? "border-amber-400/25 bg-amber-400/5" : "border-border"}`}>
              <div className="text-center leading-tight">
                <p className="text-[10px] uppercase text-muted-foreground">{new Date(`${plan!.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</p>
                <p className="font-mono text-xl">{plan!.date.slice(8)}</p>
                <p className="text-[10px] text-muted-foreground">{bellShort(plan!.bell)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-sm"><span className="font-mono font-semibold">{h.symbol}</span> <span className="text-muted-foreground">reports {bellText(plan!.bell)}</span></p>
                <p className="text-xs text-muted-foreground">Last full session before it: <b className="text-foreground">{dayLabel(plan!.lastSession)}</b>{plan!.epsEstimate != null && <> · EPS estimate {plan!.epsEstimate.toFixed(2)}</>}</p>
                {last && <p className="text-xs text-muted-foreground">Last time ({last.date.slice(5)}): EPS <span style={{ color: tone(last.epsSurprisePct) }}>{pctS(last.epsSurprisePct, 0)}</span> vs estimate · stock <span style={{ color: tone(last.dayPct) }}>{pctS(last.dayPct)}</span> on the day</p>}
              </div>
              <div className="text-end">
                <p className={`font-mono text-lg ${urgent ? "text-rose-300" : soon ? "text-amber-200" : ""}`}>{Math.max(0, plan!.sessionsLeft)}</p>
                <p className="text-[10px] text-muted-foreground">session{plan!.sessionsLeft === 1 ? "" : "s"} left</p>
              </div>
            </button>
          );
        })}
        {!upcoming.length && <p className="text-sm text-muted-foreground">No report dates yet for what you hold.</p>}
        {missing.length > 0 && upcoming.length > 0 && <p className="text-xs text-muted-foreground">No date published yet: {missing.map((h) => h.symbol).join(", ")}.</p>}
      </div>
    </Panel>
  );
}

// ── Exposure ──────────────────────────────────────────────────────────────────
export function ExposurePanel({ s, groupBy, onGroupBy }: { s: Summary; groupBy: "industry" | "theme"; onGroupBy: (g: "industry" | "theme") => void }) {
  const palette = ["hsl(var(--primary))", "hsl(160,60%,50%)", "hsl(40,85%,58%)", "hsl(280,60%,65%)", "hsl(200,70%,55%)", "hsl(330,65%,62%)", CHART.neutral];
  return (
    <Panel id="pf-exposure" eyebrow="Exposure" title="Where the money sits">
      <div className="mb-3 flex overflow-hidden rounded-md border border-border text-[11px]" role="group">
        {(["industry", "theme"] as const).map((g) => <button key={g} onClick={() => onGroupBy(g)} aria-pressed={groupBy === g} className={`px-2 py-0.5 ${groupBy === g ? "bg-primary/20 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{g === "industry" ? "By industry" : "By theme"}</button>)}
      </div>
      <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
        {s.exposure.map((g, i) => <div key={g.name} style={{ width: `${g.weight}%`, background: palette[i % palette.length] }} title={`${g.name}: ${g.weight.toFixed(1)}%`} />)}
      </div>
      <ul className="space-y-1.5 text-[12.5px]">
        {s.exposure.map((g, i) => (
          <li key={g.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: palette[i % palette.length] }} />
            <span className="min-w-0 flex-1 truncate">{g.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{g.symbols.join(" ")}</span>
            <span className="w-12 text-end font-mono">{g.weight.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
      {s.largest && s.largest.weight >= 25 && s.positions > 1 && <div className="mt-3"><Watch>{s.largest.symbol} is {s.largest.weight.toFixed(0)}% of the portfolio — one report or gap moves the whole account.</Watch></div>}
    </Panel>
  );
}

// ── News ──────────────────────────────────────────────────────────────────────
export function NewsFeed({ p, onOpen }: { p: PortfolioData; onOpen: (s: string) => void }) {
  const [only, setOnly] = useState<string | null>(null);
  const items = useMemo(() => p.holdings.flatMap((h) => (p.news[h.symbol] ?? []).map((n) => ({ ...n, symbol: h.symbol })))
    .filter((n) => !only || n.symbol === only).sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 40), [p.holdings, p.news, only]);
  return (
    <Panel id="pf-news" eyebrow="News" title="What's being said about your stocks">
      <div className="mb-3 flex flex-wrap gap-1">
        <button onClick={() => setOnly(null)} className={`rounded-md border px-2 py-0.5 text-[11px] ${!only ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>All</button>
        {p.holdings.map((h) => <button key={h.symbol} onClick={() => setOnly(only === h.symbol ? null : h.symbol)} className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${only === h.symbol ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>{h.symbol}<span className="ms-1 opacity-60">{p.news[h.symbol]?.length ?? 0}</span></button>)}
      </div>
      {p.finnhub === false && <Watch>News needs a Finnhub key in <code>local/keys.env</code> (FINNHUB_API_KEY).</Watch>}
      <ul className="divide-y divide-border/60">
        {items.map((n, i) => (
          <li key={i} className="py-2">
            <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
              <button onClick={() => onOpen(n.symbol)} className="font-mono font-semibold text-foreground hover:text-primary">{n.symbol}</button>
              <span>{n.source}</span><span>· {ago(n.time)} ago</span>
            </div>
            <a href={n.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[13.5px] leading-snug hover:text-primary">{n.headline}</a>
            {n.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.summary}</p>}
          </li>
        ))}
        {!items.length && <li className="py-2 text-sm text-muted-foreground">No news in the last 10 days.</li>}
      </ul>
    </Panel>
  );
}

// ── Record (side panel) ───────────────────────────────────────────────────────
export function RecordPanel({ p, onEdit, onDelete }: { p: PortfolioData; onEdit: (r: PositionRow) => void; onDelete: (r: PositionRow) => void }) {
  const s = p.closedSummary;
  const [n, setN] = useState(12);
  return (
    <Panel id="pf-record" eyebrow="Record" title="Closed trades">
      {!p.closed.length ? <p className="text-sm text-muted-foreground">When you close a position it lands here with its result, R and days held. The AI tab's journal review reads it too.</p> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {[["Realized", usdSigned(s.realized), tone(s.realized)], ["Win rate", s.winRate != null ? `${s.winRate.toFixed(0)}% of ${s.count}` : "—", undefined],
              ["Avg win / loss", `${pctS(s.avgWinPct)} / ${pctS(s.avgLossPct)}`, undefined], ["Avg R", s.avgR != null ? `${s.avgR.toFixed(2)}R` : "—", tone(s.avgR)]].map(([k, v, c]) => (
              <div key={k as string} className="rounded-lg bg-muted/25 px-2.5 py-1.5"><p className="text-[10.5px] text-muted-foreground"><AutoTerms text={k as string} /></p><p className="font-mono text-[13px]" style={{ color: c as string | undefined }}>{v}</p></div>
            ))}
          </div>
          {s.avgDaysWin != null && s.avgDaysLoss != null && <p className="mb-2 text-[11px] text-muted-foreground">Winners held {s.avgDaysWin.toFixed(0)} days on average, losers {s.avgDaysLoss.toFixed(0)}.</p>}
          <ul className="divide-y divide-border/60">
            {p.closed.slice(0, n).map((t: ClosedTrade) => (
              <li key={t.row.id} className="group py-1.5 text-[12px]">
                <div className="flex items-baseline gap-2">
                  <button onClick={() => openChart(t.row.symbol)} className="font-mono font-semibold hover:text-primary">{t.row.symbol}</button>
                  <span className="text-[10.5px] text-muted-foreground">{t.row.entry_date.slice(5)} → {t.row.exit_date?.slice(5)} · {t.days}d</span>
                  <span className="ms-auto font-mono" style={{ color: tone(t.pnl) }}>{usdSigned(t.pnl)}</span>
                  <span className="w-14 text-end font-mono text-[11px]" style={{ color: tone(t.pct) }}>{pctS(t.pct)}</span>
                </div>
                <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                  <span className="font-mono">{usd(Number(t.row.shares) * Number(t.row.entry_price))} @ {px(t.row.entry_price)} → {px(t.row.exit_price)}</span>
                  {t.r != null && <span className="font-mono" style={{ color: tone(t.r) }}>{t.r.toFixed(1)}R</span>}
                  <span className="min-w-0 flex-1 truncate" title={t.row.exit_note ?? undefined}>{t.row.exit_note ?? ""}</span>
                  <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => onEdit(t.row)} className="p-0.5 hover:text-foreground" aria-label="Edit"><Pencil size={11} /></button>
                    <button onClick={() => onDelete(t.row)} className="p-0.5 hover:text-rose-300" aria-label="Delete"><Trash2 size={11} /></button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {p.closed.length > n && <button onClick={() => setN(n + 20)} className="mt-2 text-xs text-muted-foreground hover:underline">Show more</button>}
        </>
      )}
    </Panel>
  );
}

// ── Position detail ───────────────────────────────────────────────────────────
function Stat({ k, v, c, sub }: { k: string; v: ReactNode; c?: string; sub?: ReactNode }) {
  return <div><p className="text-[11px] text-muted-foreground"><AutoTerms text={k} /></p><p className="font-mono text-base" style={{ color: c }}>{v}</p>{sub && <p className="text-[10.5px] text-muted-foreground">{sub}</p>}</div>;
}

export function PositionSheet({ symbol, p, onClose, onEdit, onSell, onDelete, onAddMore, onCloseAll, onDeleteAll }: {
  symbol: string | null; p: PortfolioData; onClose: () => void;
  onEdit: (r: PositionRow) => void; onSell: (r: PositionRow) => void; onDelete: (r: PositionRow) => void; onAddMore: (s: string) => void;
  onCloseAll: (s: string) => void; onDeleteAll: (s: string) => void;
}) {
  const h = p.holdings.find((x) => x.symbol === symbol) ?? null;
  const t: Technicals | null = symbol ? p.tech[symbol] ?? null : null;
  const c = symbol ? p.ctx[symbol] : null;
  const plan = symbol ? p.plans[symbol] : null;
  const reports: PastReport[] = symbol ? p.reports[symbol] ?? [] : [];
  const news: NewsItem[] = symbol ? p.news[symbol] ?? [] : [];
  const alerts = p.alerts.filter((a) => a.symbol === symbol);
  const bars = symbol ? p.bars[symbol] : null;
  return (
    <Sheet open={!!symbol && !!h} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[860px]">
        {h && symbol && (
          <div className="space-y-5">
            <SheetHeader className="space-y-1 text-start">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Position · {[c?.industry ?? c?.sector, c?.themes?.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</p>
              <SheetTitle className="text-2xl"><span className="font-mono">{symbol}</span> <span className="text-base font-normal text-muted-foreground">{c?.company ?? ""}</span></SheetTitle>
              <SheetDescription>
                {h.shares.toLocaleString("en-US")} shares at {px(h.avgCost)} · now {px(h.price)} <span style={{ color: tone(h.dayPct) }}>({pctS(h.dayPct, 2)} today)</span> · held {h.daysHeld} days
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-2 text-xs">
                <a href={tv(symbol)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><ExternalLink size={12} />TradingView</a>
                <Link to={`/lens?symbol=${symbol}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><GraduationCap size={12} />Fundamentals</Link>
                <Link to={`/minervini?symbol=${symbol}`} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><Trophy size={12} />Minervini</Link>
                <button onClick={() => openChart(symbol)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-primary"><BarChart3 size={12} />Full chart</button>
                <button onClick={() => onAddMore(symbol)} className="rounded-md border border-border px-2 py-1 hover:text-primary">Buy more</button>
                <span className="ms-auto flex gap-2">
                  <button onClick={() => onCloseAll(symbol)} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"><CheckCircle2 size={12} />Close position</button>
                  <button onClick={() => onDeleteAll(symbol)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:border-rose-400/40 hover:text-rose-300"><Trash2 size={12} />Delete</button>
                </span>
              </div>
            </SheetHeader>

            {alerts.length > 0 && <div className="flex flex-wrap gap-2">{alerts.map((a, i) => <span key={i} className={`rounded-lg border px-2.5 py-1 text-[12px] ${LEVEL_STYLE[a.level]}`}><AutoTerms text={a.text} /></span>)}</div>}

            <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-4">
              <Stat k="Open P&L" v={usdSigned(h.openPnl)} c={tone(h.openPnl)} sub={pctS(h.openPct)} />
              <Stat k="R multiple" v={h.rMultiple != null ? `${h.rMultiple.toFixed(2)}R` : "—"} c={tone(h.rMultiple)} sub={h.initialRisk != null ? `first risk ${usd(h.initialRisk)}` : "set a first stop"} />
              <Stat k="Risk to stop" v={usd(h.riskToStop)} sub={h.stop != null ? `stop ${px(h.stop)} (${pctS(h.stopDistPct)})` : "no stop"} />
              <Stat k="Weight" v={h.weight != null ? `${h.weight.toFixed(1)}%` : "—"} sub={`${usd(h.cost)} in → ${usd(h.marketValue)}`} />
              <Stat k="RS rating" v={c?.rs_rating ?? "—"} sub={t?.rs ? (t.rs.newHigh ? "RS line at a new high" : `RS line ${pctS(t.rs.fromHigh)} from its high`) : undefined} />
              <Stat k="Stage" v={c?.stage ? `${c.stage}${c.substage && c.substage !== String(c.stage) ? c.substage.replace(/^\d/, "") : ""}` : "—"} sub={c?.weeks_in_stage != null ? `${c.weeks_in_stage} weeks` : undefined} />
              <Stat k="vs 21-day EMA" v={pctS(t?.vsEma21)} c={tone(t?.vsEma21)} sub={t?.ema21 != null ? px(t.ema21) : undefined} />
              <Stat k="vs 50-day average" v={pctS(t?.vsSma50)} c={tone(t?.vsSma50)} sub={t?.atrAbove50 != null ? `${t.atrAbove50.toFixed(1)} ATR · ATR ${t.atrPct?.toFixed(1)}%` : undefined} />
              <Stat k="From 52-week high" v={pctS(t?.fromHigh)} sub={t?.high52 != null ? px(t.high52) : undefined} />
              <Stat k="vs 200-day average" v={pctS(t?.vsSma200)} c={tone(t?.vsSma200)} sub={t?.sma200 != null ? px(t.sma200) : "needs 200 days"} />
              <Stat k="Held" v={`${h.daysHeld} days`} sub={`since ${h.firstEntry}`} />
              <Stat k="Return since buying" v={pctS(h.openPct)} c={tone(h.openPct)} sub={c?.return_1m != null ? `stock 1M ${pctS(c.return_1m)}` : undefined} />
            </div>

            {bars ? <StockChart bars={bars} height={380}
                levels={[
                  ...(h.stop != null ? [{ price: h.stop, label: `stop ${px(h.stop)}`, color: CHART.negative }] : []),
                  ...(h.target != null ? [{ price: h.target, label: `tgt ${px(h.target)}`, color: CHART.positive }] : []),
                  { price: h.avgCost, label: `avg ${px(h.avgCost)}`, color: "hsl(var(--foreground))", dash: "2 3" },
                ] as Level[]}
                markers={[...h.lots.map((l) => ({ date: l.entry_date, kind: "buy", title: `Bought ${usd(Number(l.shares) * Number(l.entry_price))} at ${px(l.entry_price)}` })), ...reports.map((r) => ({ date: r.date, kind: "earnings", title: `Earnings ${r.date}` }))] as Marker[]}
                note={plan ? `Next report ${dayLabel(plan.date)}, ${bellText(plan.bell)}.` : null} />
              : <Watch>No daily prices for {symbol} on the PC yet. They download in the background; press Refresh in a minute.</Watch>}

            <section>
              <h3 className="mb-2 text-sm font-semibold">Earnings</h3>
              {plan ? (
                <p className="mb-2 text-sm">Next report <b>{dayLabel(plan.date)}</b>, {bellText(plan.bell)}. The last full session before it is <b>{dayLabel(plan.lastSession)}</b> — {plan.sessionsLeft <= 0 ? "it is already in the price." : `${plan.sessionsLeft} session${plan.sessionsLeft === 1 ? "" : "s"} from now.`}{plan.bell === "unknown" && " The time isn't announced yet, so this counts it as before the open."}</p>
              ) : <p className="mb-2 text-sm text-muted-foreground">No upcoming report date published yet.</p>}
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
              <h3 className="mb-2 text-sm font-semibold">Your buys <span className="font-normal text-muted-foreground">— edit, sell part of one, or delete one entered by mistake</span></h3>
              <div className="space-y-2">
                {h.lots.map((l) => (
                  <div key={l.id} className="rounded-lg border border-border px-3 py-2 text-[12.5px]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono">{usd(Number(l.shares) * Number(l.entry_price))} @ {px(l.entry_price)}</span><span className="text-muted-foreground">{l.entry_date}</span>
                      {l.setup && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{l.setup}</span>}
                      {l.stop != null && <span className="text-muted-foreground">stop {px(l.stop)}</span>}{l.target != null && <span className="text-muted-foreground">target {px(l.target)}</span>}
                      <span className="ms-auto flex gap-1">
                        <button onClick={() => onSell(l)} className="rounded-md border border-border px-2 py-0.5 hover:text-primary">Sell part</button>
                        <button onClick={() => onEdit(l)} className="rounded-md border border-border px-2 py-0.5 hover:text-primary">Edit</button>
                        <button onClick={() => onDelete(l)} className="rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-rose-300" aria-label="Delete this buy"><Trash2 size={12} /></button>
                      </span>
                    </div>
                    {l.notes && <p className="mt-1 text-xs text-muted-foreground">{l.notes}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">News</h3>
              <ul className="divide-y divide-border/60">
                {news.slice(0, 8).map((n, i) => (
                  <li key={i} className="py-1.5"><a href={n.url} target="_blank" rel="noreferrer" className="text-[13px] hover:text-primary">{n.headline}</a><p className="text-[11px] text-muted-foreground">{n.source} · {ago(n.time)} ago</p></li>
                ))}
                {!news.length && <li className="text-sm text-muted-foreground">No news in the last 10 days.</li>}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
