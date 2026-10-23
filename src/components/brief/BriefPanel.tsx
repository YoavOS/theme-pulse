import { useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronRight, Loader2, Minus, RefreshCw, Sparkles, Sun, TrendingDown, TrendingUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ThemeData } from "@/data/themeData";
import {
  etDay, sessionState, useAiBrief, useExplain, useNow,
  type BriefData, type DigestGroup, type EarningsRow, type EconEvent,
} from "@/hooks/useBrief";
import type { Breadth } from "@/components/dashboard/IndexBreadthStrip";

/* ───────────── helpers ───────────── */

const ET = "America/New_York";
const fmtEtTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit", hour12: false });
};
const fmtEtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
};
const fmtIn = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const pctTxt = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const pctCls = (v: number | null | undefined) => (typeof v !== "number" ? "text-muted-foreground" : v > 0 ? "text-gain-medium" : v < 0 ? "text-loss-medium" : "text-muted-foreground");
const upShare = (b: Breadth | null | undefined) => (b && b.up + b.down > 0 ? b.up / (b.up + b.down) : null);

const IMPACT_DOT: Record<string, string> = {
  High: "bg-[hsl(350,85%,62%)]",
  Medium: "bg-[hsl(40,90%,55%)]",
  Low: "bg-muted-foreground/50",
  None: "bg-muted-foreground/30",
};

/** One plain-words read of today's tape from index breadth. */
function regimeLine(spy: Breadth | null | undefined, qqq: Breadth | null | undefined): { head: string; tail: string } | null {
  const s = upShare(spy);
  if (!spy || s === null) return null;
  const p = spy.indexPct ?? 0;
  const head =
    p > 0.15 && s >= 0.6 ? "Broad advance."
      : p > 0.15 && s < 0.55 ? "Narrow tape."
        : p < -0.15 && s <= 0.4 ? "Broad selling."
          : p < -0.15 && s > 0.45 ? "Index down, stocks holding up."
            : "Mixed, little direction.";
  const q = upShare(qqq);
  const tail = `S&P ${pctTxt(spy.indexPct, 2)} with ${Math.round(s * 100)}% of members up` +
    (qqq && q !== null ? `; Nasdaq 100 ${pctTxt(qqq.indexPct, 2)} with ${Math.round(q * 100)}% up.` : ".");
  return { head, tail };
}

const tickersIn = (text: string) => [...text.matchAll(/\*\*([A-Z][A-Z0-9.-]{0,6})\*\*/g)].map((m) => m[1]);

function Bold({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="font-mono font-semibold text-foreground">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>)}
    </>
  );
}

function H({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold">{children}</h3>
      {sub && <span className="truncate text-[10.5px] text-muted-foreground">{sub}</span>}
      {right && <span className="ml-auto shrink-0">{right}</span>}
    </div>
  );
}

function GroupChip({ t, onOpen }: { t: ThemeData; onOpen: (t: ThemeData) => void }) {
  const p = t.performance_pct;
  const tone = p > 0 ? "bg-[hsl(150,70%,34%)]/45 hover:bg-[hsl(150,70%,34%)]/65" : p < 0 ? "bg-[hsl(350,70%,45%)]/45 hover:bg-[hsl(350,70%,45%)]/65" : "bg-muted hover:bg-muted/80";
  return (
    <button onClick={() => onOpen(t)} className={`max-w-full truncate rounded px-2 py-0.5 text-[11px] text-foreground transition-colors ${tone}`} title={`Open ${t.theme_name}`}>
      {t.theme_name} <span className="font-mono">{pctTxt(p)}</span>
    </button>
  );
}

/* ───────────── panel ───────────── */

interface Props {
  data: BriefData;
  /** The groups currently on the dashboard (current timeframe + group-by). */
  themes: ThemeData[];
  timeframe: string;
  groupLabel: string;
  onOpenGroup: (t: ThemeData) => void;
  onClose: () => void;
  closeIcon?: "chevron" | "x";
}

export default function BriefPanel({ data, themes, timeframe, groupLabel, onOpenGroup, onClose, closeIcon = "chevron" }: Props) {
  const now = useNow(30_000);
  const session = sessionState(now);
  const ai = useAiBrief();
  const explain = useExplain();
  const refs = { now: useRef<HTMLElement>(null), events: useRef<HTMLElement>(null), earnings: useRef<HTMLElement>(null), news: useRef<HTMLElement>(null), ai: useRef<HTMLElement>(null) };
  const jump = (k: keyof typeof refs) => refs[k].current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const ranked = useMemo(
    () => themes.filter((t) => (t.valid_count ?? t.tickers.length) > 0 && Number.isFinite(t.performance_pct)).sort((a, b) => b.performance_pct - a.performance_pct),
    [themes],
  );
  const leaders = ranked.slice(0, 3).filter((t) => t.performance_pct > 0);
  const laggards = ranked.slice(-2).reverse().filter((t) => t.performance_pct < 0);
  const groupOfTicker = useMemo(() => {
    const m = new Map<string, ThemeData>();
    for (const t of themes) for (const tk of t.tickers) if (!m.has(tk.symbol.toUpperCase())) m.set(tk.symbol.toUpperCase(), t);
    return m;
  }, [themes]);
  const leadingSet = useMemo(() => new Set(ranked.slice(0, 5).filter((t) => t.performance_pct > 0).flatMap((t) => t.tickers.map((x) => x.symbol.toUpperCase()))), [ranked]);

  const nextEvent = useMemo(
    () => data.events
      .filter((e) => (e.impact === "High" || e.impact === "Medium") && new Date(e.date).getTime() > now.getTime())
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [data.events, now],
  );
  const regime = regimeLine(data.spy, data.qqq);

  const writeBrief = () => {
    const brief = (b: Breadth | null | undefined) => (b ? { pct: b.indexPct, up: b.up, down: b.down } : null);
    void ai.generate({
      date: etDay(),
      session: session.label,
      dashboard: { timeframe, groupBy: groupLabel },
      indexes: { spy: brief(data.spy), qqq: brief(data.qqq) },
      leaders: ranked.slice(0, 6).map((t) => ({
        name: t.theme_name, pct: t.performance_pct, up: t.up_count, down: t.down_count,
        top: [...t.tickers].filter((x) => !x.skipped).sort((a, b) => b.pct - a.pct).slice(0, 3).map((x) => ({ sym: x.symbol, pct: x.pct })),
      })),
      laggards: ranked.slice(-4).reverse().map((t) => ({ name: t.theme_name, pct: t.performance_pct, up: t.up_count, down: t.down_count })),
      eventsToday: data.events.slice(0, 12).map((e) => ({ time: fmtEtTime(e.date), event: e.event, impact: e.impact, actual: e.actual, estimate: e.estimate, previous: e.previous })),
      earningsToday: data.earnings.slice(0, 20).map((e) => ({ symbol: e.symbol, when: e.reportTime, gapPct: e.gapPct, inLeadingGroup: leadingSet.has(e.symbol) })),
      news: data.digest.flatMap((g) => g.bullets.slice(0, 3).map((b) => `${g.theme}: ${b.text}`)).slice(0, 14),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <header className="shrink-0 border-b border-border px-4 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <Sun size={15} className="shrink-0 text-[hsl(40,90%,58%)]" aria-hidden />
          <h2 className="font-display text-[15px] font-semibold">Brief</h2>
          <span className="truncate text-[11px] text-muted-foreground">{fmtEtDate(now.toISOString())}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${session.tone === "open" ? "bg-[hsl(150,70%,40%)]/15 text-gain-medium" : session.tone === "pre" ? "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,62%)]" : "bg-muted text-muted-foreground"}`}>
            {session.label}
          </span>
          <button onClick={data.refreshAll} className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Refresh brief" title="Refresh">
            {data.eventsLoading || data.earningsLoading || data.breadthLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
          <button onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close brief" title="Close">
            {closeIcon === "x" ? <X size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
        <nav className="mt-2 flex gap-1 overflow-x-auto text-[11px]" aria-label="Brief sections">
          {([
            ["now", "Now"], ["events", `Events ${data.events.length || ""}`], ["earnings", `Earnings ${data.earnings.length || ""}`], ["news", "News"], ["ai", "AI brief"],
          ] as [keyof typeof refs, string][]).map(([k, label]) => (
            <button key={k} onClick={() => jump(k)} className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-muted-foreground hover:border-primary/60 hover:text-foreground">
              {label.trim()}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3.5">
        {/* Right now */}
        <section ref={refs.now} className="scroll-mt-2">
          <H sub={`from your dashboard · ${timeframe}`}>Right now</H>
          <div className="space-y-2.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[12px] leading-relaxed">
            {regime ? (
              <p><b>{regime.head}</b> <span className="text-muted-foreground">{regime.tail}</span></p>
            ) : (
              <p className="text-muted-foreground">{data.breadthLoading ? "Reading the indexes…" : "Index breadth not available right now."}</p>
            )}
            {(leaders.length > 0 || laggards.length > 0) && (
              <div className="space-y-1.5">
                {leaders.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10.5px] text-muted-foreground">Leading {groupLabel.toLowerCase()} groups</div>
                    <div className="flex flex-wrap gap-1">{leaders.map((t) => <GroupChip key={t.theme_name} t={t} onOpen={onOpenGroup} />)}</div>
                  </div>
                )}
                {laggards.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10.5px] text-muted-foreground">Lagging</div>
                    <div className="flex flex-wrap gap-1">{laggards.map((t) => <GroupChip key={t.theme_name} t={t} onOpen={onOpenGroup} />)}</div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-border pt-2">
              {nextEvent ? (
                <>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${IMPACT_DOT[nextEvent.impact]}`} aria-hidden />
                  <span className="min-w-0 truncate">Next: <b>{nextEvent.event}</b></span>
                  <span className="ml-auto shrink-0 font-mono text-[hsl(40,90%,62%)]">in {fmtIn(new Date(nextEvent.date).getTime() - now.getTime())}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{data.eventsLoading ? "Loading events…" : "No more major US events today."}</span>
              )}
            </div>
          </div>
        </section>

        {/* Events */}
        <section ref={refs.events} className="scroll-mt-2">
          <H sub="US · ET">Events today</H>
          <EventsList events={data.events} loading={data.eventsLoading} onExplain={(e) => explain.open({ kind: "event", title: e.event + "|" + e.date.slice(0, 10), payload: e as unknown as Record<string, unknown> })} />
          <UpcomingEvents data={data} onExplain={(e) => explain.open({ kind: "event", title: e.event + "|" + e.date.slice(0, 10), payload: e as unknown as Record<string, unknown> })} />
        </section>

        {/* Earnings */}
        <section ref={refs.earnings} className="scroll-mt-2">
          <H sub={<><span className="text-gain-medium">●</span> in a leading group</>}>Earnings today</H>
          <EarningsBlock rows={data.earnings} loading={data.earningsLoading} leading={leadingSet} groupOf={groupOfTicker} />
        </section>

        {/* News */}
        <section ref={refs.news} className="scroll-mt-2">
          <H sub={data.digestAt ? `AI digest · ${fmtEtTime(data.digestAt)} ET` : "AI digest"}>News</H>
          {data.digest.length === 0 ? (
            <p className="py-2 text-[11.5px] text-muted-foreground">{data.digestLoading || !data.marketNews?.length ? "Loading market news…" : "No digest yet."}</p>
          ) : (
            <div className="space-y-2">
              {data.digest.map((g, i) => (
                <NewsGroup key={i} g={g} groupOf={groupOfTicker} onOpenGroup={onOpenGroup}
                  onExplain={(text) => explain.open({ kind: "news", title: g.theme + "|" + text, payload: { headline: text.replace(/\*\*/g, ""), summary: g.theme } })} />
              ))}
            </div>
          )}
        </section>

        {/* AI brief */}
        <section ref={refs.ai} className="scroll-mt-2 pb-2">
          <H
            sub={ai.at ? `written ${fmtEtTime(ai.at)} ET` : "written on request, kept for the day"}
            right={ai.brief && (
              <button onClick={writeBrief} disabled={ai.loading} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                {ai.loading ? "Writing…" : "Regenerate"}
              </button>
            )}
          >
            AI brief
          </H>
          {ai.brief ? (
            <article className="space-y-1 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[12px] leading-relaxed">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => <h4 className="mt-2 text-[11px] font-semibold text-primary first:mt-0">{children}</h4>,
                  h3: ({ children }) => <h4 className="mt-2 text-[11px] font-semibold text-primary first:mt-0">{children}</h4>,
                  ul: ({ children }) => <ul className="space-y-1">{children}</ul>,
                  li: ({ children }) => <li className="flex gap-1.5"><span className="text-primary">•</span><span className="min-w-0 flex-1">{children}</span></li>,
                  p: ({ children }) => <p className="text-foreground/90">{children}</p>,
                  strong: ({ children }) => <strong className="font-mono font-semibold text-foreground">{children}</strong>,
                }}
              >
                {ai.brief}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[11.5px] text-muted-foreground">
              <p className="mb-2">A short read of the market, rotation, setups and risks, written from the indexes, your dashboard groups, today's events, earnings and news.</p>
              <button onClick={writeBrief} disabled={ai.loading} className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11.5px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50">
                {ai.loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {ai.loading ? "Writing…" : "Write today's brief"}
              </button>
            </div>
          )}
          {ai.error && <p className="mt-1.5 text-[11px] text-loss-medium">{ai.error}</p>}
        </section>
      </div>

      <Dialog open={!!explain.target} onOpenChange={(o) => { if (!o) explain.close(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Sparkles size={15} className="text-primary" /> {explain.target?.kind === "event" ? "Event explained" : "News explained"}</DialogTitle>
            <DialogDescription className="truncate">{String(explain.target?.payload?.event ?? explain.target?.payload?.headline ?? "")}</DialogDescription>
          </DialogHeader>
          {explain.loading || !explain.result ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Asking AI…</p>
          ) : (
            <div className="space-y-3 text-sm leading-relaxed">
              <div><div className="mb-0.5 text-[11px] text-muted-foreground">What it is</div><p>{explain.result.what}</p></div>
              {explain.result.expected && explain.result.expected !== "N/A" && <div><div className="mb-0.5 text-[11px] text-muted-foreground">Expected</div><p>{explain.result.expected}</p></div>}
              <div><div className="mb-0.5 text-[11px] text-muted-foreground">US market impact · {explain.result.impact_level}</div><p>{explain.result.impact_text}</p></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────── sections ───────────── */

function EventRow({ e, showDate, onExplain }: { e: EconEvent; showDate?: boolean; onExplain: () => void }) {
  const v = (x: number | string | null) => (x === null || x === undefined || x === "" ? null : `${x}${e.unit ?? ""}`);
  const act = v(e.actual), est = v(e.estimate);
  return (
    <li className="group grid grid-cols-[42px_8px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/50 py-1.5 text-[12px]">
      <span className="font-mono text-[11px] text-muted-foreground">{showDate ? fmtEtDate(e.date).split(",")[0] : fmtEtTime(e.date)}</span>
      <span className={`h-2 w-2 rounded-full ${IMPACT_DOT[e.impact] ?? IMPACT_DOT.None}`} title={`${e.impact} impact`} aria-label={`${e.impact} impact`} />
      <button onClick={onExplain} className="min-w-0 truncate text-left hover:text-primary" title={`${e.event} — explain`}>{e.event}</button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {act ? <><span className="font-semibold text-foreground">{act}</span>{est && <> vs {est}</>}</> : est ? <>est {est}</> : ""}
      </span>
    </li>
  );
}

function EventsList({ events, loading, onExplain }: { events: EconEvent[]; loading: boolean; onExplain: (e: EconEvent) => void }) {
  if (!events.length) return <p className="py-2 text-[11.5px] text-muted-foreground">{loading ? "Loading events…" : "No major US events today."}</p>;
  return <ul>{events.map((e, i) => <EventRow key={i} e={e} onExplain={() => onExplain(e)} />)}</ul>;
}

function UpcomingEvents({ data, onExplain }: { data: BriefData; onExplain: (e: EconEvent) => void }) {
  const [open, setOpen] = useState(false);
  const today = etDay();
  const rest = data.upcoming.filter((e) => etDay(new Date(e.date)) > today);
  return (
    <div className="mt-1.5">
      <button onClick={() => { if (!open) void data.loadUpcoming(false); setOpen((v) => !v); }} className="text-[11.5px] font-medium text-primary hover:underline">
        {open ? "Hide the rest of the week" : `Rest of the week${rest.length ? ` (${rest.length})` : ""}`}
      </button>
      {open && (data.upcomingLoading && !rest.length
        ? <p className="py-2 text-[11.5px] text-muted-foreground">Loading…</p>
        : rest.length ? <ul className="mt-1">{rest.map((e, i) => <EventRow key={i} e={e} showDate onExplain={() => onExplain(e)} />)}</ul>
          : <p className="py-2 text-[11.5px] text-muted-foreground">Nothing major later this week.</p>)}
    </div>
  );
}

function EarningsBlock({ rows, loading, leading, groupOf }: { rows: EarningsRow[]; loading: boolean; leading: Set<string>; groupOf: Map<string, ThemeData> }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="py-2 text-[11.5px] text-muted-foreground">{loading ? "Loading earnings…" : "No large companies report today."}</p>;
  const buckets: [string, EarningsRow[]][] = [
    ["Before open", rows.filter((r) => r.reportTime === "BMO")],
    ["After close", rows.filter((r) => r.reportTime === "AMC")],
    ["Other", rows.filter((r) => r.reportTime !== "BMO" && r.reportTime !== "AMC")],
  ];
  const cap = all ? Infinity : 12;
  return (
    <div className="space-y-1.5">
      {buckets.filter(([, l]) => l.length).map(([label, list]) => (
        <div key={label} className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 text-[11.5px]">
          <span className="pt-0.5 text-muted-foreground">{label}</span>
          <span className="flex flex-wrap gap-1">
            {list.slice(0, cap).map((r) => {
              const lead = leading.has(r.symbol);
              const g = groupOf.get(r.symbol);
              return (
                <a key={r.symbol} href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer"
                  title={[r.company, g ? `Group: ${g.theme_name} ${pctTxt(g.performance_pct)}` : null, r.gapPct !== null ? `Gap ${pctTxt(r.gapPct)}` : null].filter(Boolean).join(" · ")}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent ${lead ? "border-[hsl(150,70%,40%)] text-gain-medium" : "border-border text-foreground/85"}`}>
                  {lead && "● "}{r.symbol}
                  {r.gapPct !== null && Math.abs(r.gapPct) >= 1 && <span className={`ml-1 ${pctCls(r.gapPct)}`}>{pctTxt(r.gapPct, 0)}</span>}
                </a>
              );
            })}
            {list.length > cap && <span className="px-1 py-0.5 text-[11px] text-muted-foreground">+{list.length - cap}</span>}
          </span>
        </div>
      ))}
      {rows.length > 12 && <button onClick={() => setAll((v) => !v)} className="text-[11.5px] font-medium text-primary hover:underline">{all ? "Show fewer" : "Show all"}</button>}
    </div>
  );
}

function NewsGroup({ g, groupOf, onOpenGroup, onExplain }: { g: DigestGroup; groupOf: Map<string, ThemeData>; onOpenGroup: (t: ThemeData) => void; onExplain: (text: string) => void }) {
  const [more, setMore] = useState(false);
  const linked = useMemo(() => {
    const seen = new Map<string, ThemeData>();
    for (const b of g.bullets) for (const sym of tickersIn(b.text)) { const t = groupOf.get(sym); if (t && !seen.has(t.theme_name)) seen.set(t.theme_name, t); }
    return [...seen.values()].slice(0, 3);
  }, [g, groupOf]);
  const shown = more ? g.bullets : g.bullets.slice(0, 3);
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="min-w-0 truncate text-[12px] font-semibold">{g.theme}</span>
        <span className={`shrink-0 rounded px-1.5 text-[10px] ${g.impact === "High" ? "bg-[hsl(350,85%,62%)]/15 text-[hsl(350,85%,70%)]" : g.impact === "Medium" ? "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,62%)]" : "bg-muted text-muted-foreground"}`}>{g.impact}</span>
      </div>
      {linked.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10.5px] text-muted-foreground">On your dashboard:</span>
          {linked.map((t) => <GroupChip key={t.theme_name} t={t} onOpen={onOpenGroup} />)}
        </div>
      )}
      <ul className="space-y-1">
        {shown.map((b, i) => (
          <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-foreground/85">
            <span className={`mt-0.5 shrink-0 ${b.impact === "Bullish" ? "text-gain-medium" : b.impact === "Bearish" ? "text-loss-medium" : "text-muted-foreground"}`} aria-label={b.impact}>
              {b.impact === "Bullish" ? <TrendingUp size={11} /> : b.impact === "Bearish" ? <TrendingDown size={11} /> : <Minus size={11} />}
            </span>
            <span className="min-w-0 flex-1"><Bold text={b.text} /></span>
            <button onClick={() => onExplain(b.text)} className="shrink-0 self-start text-muted-foreground hover:text-primary" aria-label="Explain this headline" title="Explain">
              <Sparkles size={11} />
            </button>
          </li>
        ))}
      </ul>
      {g.bullets.length > 3 && <button onClick={() => setMore((v) => !v)} className="mt-1 text-[11px] font-medium text-primary hover:underline">{more ? "Less" : `${g.bullets.length - 3} more`}</button>}
    </div>
  );
}
