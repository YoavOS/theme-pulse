import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ThemeData, Ticker } from "@/data/themeData";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { marketClock, useLiveSession, type SessionQuote } from "@/hooks/useLiveSession";

/**
 * Combined view — each group's move today split into the overnight gap (yesterday's close → open)
 * and the move during trading hours (open → now), sorted into the four possible outcomes:
 *
 *                     gapped down          gapped up
 *   rising now        Bought               Kept going
 *   falling now       Sold more            Faded
 */

type Outcome = "bought" | "go" | "sold" | "fade";
const FLAT = 0.15; // % — a gap this small is shown as "flat"

const OUTCOME: Record<Outcome, { title: string; meaning: string; color: string }> = {
  bought: { title: "Gapped down, bought", meaning: "Opened lower, buyers stepped in", color: "hsl(200, 85%, 64%)" },
  go: { title: "Gapped up, kept going", meaning: "Opened higher and kept rising", color: "hsl(166, 100%, 42%)" },
  sold: { title: "Gapped down, sold more", meaning: "Opened lower and kept falling", color: "hsl(344, 100%, 65%)" },
  fade: { title: "Gapped up, faded", meaning: "Opened higher, sellers took over", color: "hsl(35, 95%, 60%)" },
};
const outcomeOf = (gap: number, open: number): Outcome => (gap < 0 ? (open >= 0 ? "bought" : "sold") : open >= 0 ? "go" : "fade");

interface Row { name: string; gap: number; open: number; today: number; n: number; up: number; sector: string | null; theme: ThemeData }
const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const tone = (x: number) => (x > 0.05 ? "text-[hsl(166,100%,42%)]" : x < -0.05 ? "text-[hsl(344,100%,65%)]" : "text-muted-foreground");
const PREVIEW = 6;

export default function SessionView({ groupMode, baseThemes, industryBySymbol, onOpen, sectorOf }: {
  groupMode: GroupMode;
  baseThemes: ThemeData[];
  industryBySymbol: Map<string, string | null>;
  onOpen: (t: ThemeData) => void;
  /** Sector + Industry mode: industry name → its sector (shown as a tag). */
  sectorOf?: (industry: string) => string;
}) {
  const { live, loading, error, refresh } = useLiveSession(true);
  const [expanded, setExpanded] = useState<Set<Outcome>>(new Set());

  const rows = useMemo(() => {
    if (!live) return [] as Row[];
    const groups = new Map<string, { symbol: string; name?: string | null }[]>();
    const add = (k: string, m: { symbol: string; name?: string | null }) => {
      const a = groups.get(k) ?? [];
      if (!a.some((x) => x.symbol === m.symbol)) a.push(m);
      groups.set(k, a);
    };
    const seen = new Set<string>();
    for (const t of baseThemes) for (const tk of t.tickers) {
      const s = tk.symbol.toUpperCase();
      if (groupMode === "theme") add(t.theme_name, { symbol: s, name: tk.name });
      else if (!seen.has(s)) { seen.add(s); add(groupKeyForIndustry(industryBySymbol.get(s) ?? null, groupMode), { symbol: s, name: tk.name }); }
    }
    const out: Row[] = [];
    groups.forEach((members, name) => {
      const q = members.map((m) => ({ m, q: live.map.get(m.symbol) })).filter((x): x is { m: typeof x.m; q: SessionQuote } => !!x.q);
      if (!q.length) return;
      const avg = (k: keyof SessionQuote) => q.reduce((s, x) => s + x.q[k], 0) / q.length;
      const gap = avg("gap"), open = avg("open"), today = avg("today");
      const tickers: Ticker[] = q.map((x) => ({ symbol: x.m.symbol, name: x.m.name ?? undefined, pct: x.q.open })).sort((a, b) => b.pct - a.pct);
      out.push({
        name, gap, open, today, n: q.length, up: q.filter((x) => x.q.open > 0).length, sector: sectorOf ? sectorOf(name) : null,
        theme: { theme_name: `${name} — since the open`, performance_pct: Math.round(open * 100) / 100, up_count: tickers.filter((t) => t.pct > 0).length, down_count: tickers.filter((t) => t.pct <= 0).length, na_count: members.length - q.length, valid_count: q.length, tickers, dataSource: "real" },
      });
    });
    return out;
  }, [live, baseThemes, groupMode, industryBySymbol, sectorOf]);

  const byOutcome = useMemo(() => {
    const m: Record<Outcome, Row[]> = { bought: [], go: [], sold: [], fade: [] };
    for (const r of rows) m[outcomeOf(r.gap, r.open)].push(r);
    for (const k of Object.keys(m) as Outcome[]) m[k].sort((a, b) => Math.abs(b.open) - Math.abs(a.open));
    return m;
  }, [rows]);
  const rising = byOutcome.bought.length + byOutcome.go.length;

  const clock = marketClock();
  const status = live
    ? `${new Date(live.fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET · ${clock.open ? `${clock.sinceOpen} min since the open · refreshes every 5 min` : "market closed — last session"}`
    : loading ? "fetching live quotes…" : "";
  const title = sectorOf ? "Sector + Industry" : GROUP_MODE_LABEL[groupMode];

  const cell = (k: Outcome) => {
    const list = byOutcome[k], open = expanded.has(k), shown = open ? list : list.slice(0, PREVIEW);
    return (
      <section key={k} className="flex min-w-0 flex-col rounded-lg border border-border bg-background/40 p-3">
        <header className="mb-1.5 flex items-baseline gap-2">
          <span className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ background: OUTCOME[k].color }} />
          <h3 className="text-[13px] font-semibold" style={{ color: OUTCOME[k].color }}>{OUTCOME[k].title}</h3>
          <span className="ml-auto font-mono text-lg font-semibold tabular-nums">{list.length}</span>
        </header>
        <p className="mb-1.5 text-[11px] text-muted-foreground">{OUTCOME[k].meaning}</p>
        {!list.length ? <p className="py-3 text-center text-[11.5px] text-muted-foreground">None right now</p> : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_64px_70px] gap-x-2 border-b border-border/50 pb-1 text-[10px] text-muted-foreground">
              <span>Group</span><span className="text-right">Gap</span><span className="text-right">Since open</span>
            </div>
            {shown.map((r) => (
              <button key={r.name} onClick={() => onOpen(r.theme)} title={`${r.name}: gap ${fmt(r.gap)}, since the open ${fmt(r.open)}, today ${fmt(r.today)} · ${r.n} stocks with live quotes, ${r.up} up since the open — click for the stocks`}
                className="grid grid-cols-[minmax(0,1fr)_64px_70px] items-center gap-x-2 border-b border-border/30 py-1.5 text-left hover:bg-accent/40">
                <span className="min-w-0 truncate text-[12.5px]">
                  {r.name}
                  {r.sector && <span className="ml-1.5 text-[10.5px] text-muted-foreground">{r.sector}</span>}
                </span>
                <span className={`text-right font-mono text-[11.5px] tabular-nums ${Math.abs(r.gap) < FLAT ? "text-muted-foreground" : tone(r.gap)}`}>{Math.abs(r.gap) < FLAT ? "flat" : fmt(r.gap)}</span>
                <span className={`text-right font-mono text-[13px] font-semibold tabular-nums ${tone(r.open)}`}>{fmt(r.open)}</span>
              </button>
            ))}
            {list.length > PREVIEW && (
              <button onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="mt-1 self-start text-[11.5px] text-primary hover:underline">
                {open ? "Show fewer" : `Show all ${list.length}`}
              </button>
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
            {title} — gap vs session
            <button onClick={refresh} disabled={loading} title="Refresh live quotes" aria-label="Refresh live quotes" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">How each group opened (the gap) and what it did once trading started. <span className="font-mono">{status}</span></p>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className="text-muted-foreground">Since the open</span>
            <span className="flex h-2 w-28 overflow-hidden rounded-full bg-muted">
              <span style={{ width: `${(rising / rows.length) * 100}%`, background: "hsl(166, 100%, 42%)" }} />
              <span className="flex-1" style={{ background: "hsl(344, 100%, 65%)" }} />
            </span>
            <span className="font-mono">{rising} rising · {rows.length - rising} falling</span>
          </div>
        )}
      </div>

      {!rows.length ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {loading ? "Fetching live quotes…" : error === "no_open" ? "No opening prices came back yet — try again in a minute." : error ? `Couldn't fetch live quotes: ${error}` : "No live data yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <span className="hidden md:block" />
          <span className="hidden text-center text-[11px] font-medium text-muted-foreground md:block">Gapped down</span>
          <span className="hidden text-center text-[11px] font-medium text-muted-foreground md:block">Gapped up</span>
          <span className="hidden self-center text-[11px] font-medium text-muted-foreground md:block [writing-mode:vertical-rl] rotate-180">Rising now</span>
          {cell("bought")}
          {cell("go")}
          <span className="hidden self-center text-[11px] font-medium text-muted-foreground md:block [writing-mode:vertical-rl] rotate-180">Falling now</span>
          {cell("sold")}
          {cell("fade")}
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        <b className="text-foreground/90">Gap</b> = yesterday's close to today's open (news and pre-market). <b className="text-foreground/90">Since open</b> = what buyers and sellers did during trading hours.
        Gaps that kept going show follow-through; a gap that faded, or a gap down that got bought, is where the session changed the story. Click a group for its stocks.
        {groupMode !== "theme" && " Live quotes exist for your theme tickers only, so these groups contain those stocks."}
      </p>
    </div>
  );
}
