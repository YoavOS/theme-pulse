import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Crown, Download, LayoutGrid, List, Loader2, TrendingDown, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/Explainer";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { EXPORT_FORMAT_LABEL, tvSectionsText, type ExportFormat } from "@/lib/tvSections";

/**
 * RS Alpha — new 52-week highs and lows in one panel with one timeframe (Industry Leaders styling).
 * The same timeframe drives the "only new highs" filter on the RS table. Lays itself out by its own
 * width, so it works docked beside the table (like the Brief), in a slide-over, or full width.
 */

export type HlWindow = "today" | "1w" | "1m" | "3m";
const SPAN: Record<HlWindow, number> = { today: 0, "1w": 6, "1m": 30, "3m": 91 };
const LABEL: Record<HlWindow, string> = { today: "Today", "1w": "1W", "1m": "1M", "3m": "3M" };
const LONG: Record<HlWindow, string> = { today: "the last session", "1w": "the last week", "1m": "the last month", "3m": "the last 3 months" };

/**
 * Days-ago cutoff for a window. The 52-week function counts whole days since the bar's open
 * (9:30 ET), so "today" is the age of the last session's bar — 0 during the session, 1–3 after
 * a night or a weekend (holidays are not known here and can shift it by a day).
 */
export function hlWindowDays(w: HlWindow, now = new Date()) {
  // New York wall clock, then UTC arithmetic (no local-timezone/DST surprises).
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  let open = Date.UTC(+p.year, +p.month - 1, +p.day, 9, 30);
  if (wall < open) open -= 86400000;
  while ([0, 6].includes(new Date(open).getUTCDay())) open -= 86400000;
  const age = Math.max(0, Math.floor((wall - open) / 86400000));
  return age + SPAN[w];
}

export interface HlStock { symbol: string; name?: string | null; industry: string | null; theme: string | null; rating: number | null; hi: number | null; lo: number | null }

interface GroupRow { name: string; n: number; highs: HlStock[]; lows: HlStock[]; avgRs: number | null }
type SortKey = "highs" | "net" | "lows";
const SORTS: { value: SortKey; label: string; title: string }[] = [
  { value: "highs", label: "Most highs", title: "Number of stocks at a new 52-week high" },
  { value: "net", label: "Net share", title: "Share of the group at new highs minus the share at new lows — fair to small groups" },
  { value: "lows", label: "Most lows", title: "Number of stocks at a new 52-week low" },
];
const PREVIEW = 12;

// App colours: highs teal, lows rose (as elsewhere in RS Alpha)
const HI = "text-[hsl(222,82%,64%)]";
const LO = "text-[hsl(330,72%,61%)]";
const hiCell = (share: number) => (share >= 0.5 ? "bg-[hsl(222,82%,63%)]/20" : share >= 0.25 ? "bg-[hsl(222,82%,63%)]/10" : share > 0 ? "bg-[hsl(222,82%,63%)]/[0.04]" : "");
const loCell = (share: number) => (share >= 0.5 ? "bg-[hsl(330,72%,57%)]/20" : share >= 0.25 ? "bg-[hsl(330,72%,57%)]/10" : share > 0 ? "bg-[hsl(330,72%,57%)]/[0.04]" : "");
const rsCls = (r: number | null) => (r === null ? "text-muted-foreground" : r >= 80 ? `${HI} font-semibold` : r < 40 ? "text-loss-medium" : "");
const tv = (s: string) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s)}`;

/** Lays out by the panel's own width (docked ~420px vs full page). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function HighsLowsPanel({ stocks, loading, range, onRange, mode, onMode, filterOn, onFilter, tableMatches, onHide, docked = false }: {
  stocks: HlStock[];
  loading: boolean;
  range: HlWindow;
  onRange: (w: HlWindow) => void;
  mode: GroupMode;
  onMode: (m: GroupMode) => void;
  filterOn: boolean;
  onFilter: (on: boolean) => void;
  tableMatches: number;
  /** Close / collapse the panel. */
  onHide?: () => void;
  /** Rendered as a full-height side panel (scrolling body, pinned header and footer). */
  docked?: boolean;
}) {
  const [rootRef, width] = useWidth<HTMLElement>();
  const narrow = width < 600;
  const [tab, setTab] = useState<"groups" | "stocks">("groups");
  const [side, setSide] = useState<"highs" | "lows">("highs");
  const [sort, setSort] = useState<SortKey>("highs");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const days = hlWindowDays(range);
  const known = useMemo(() => stocks.filter((s) => s.hi !== null || s.lo !== null), [stocks]);
  const byRs = (a: HlStock, b: HlStock) => (b.rating ?? -1) - (a.rating ?? -1);
  const highs = useMemo(() => known.filter((s) => s.hi !== null && s.hi <= days).sort(byRs), [known, days]);
  const lows = useMemo(() => known.filter((s) => s.lo !== null && s.lo <= days).sort(byRs), [known, days]);
  const groupOf = (s: HlStock) => (mode === "theme" ? (s.theme?.trim() || "No theme") : groupKeyForIndustry(s.industry, mode));

  const groups = useMemo(() => {
    const m = new Map<string, HlStock[]>();
    for (const s of known) {
      const k = mode === "theme" ? (s.theme?.trim() || "No theme") : groupKeyForIndustry(s.industry, mode);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    const out: GroupRow[] = [];
    m.forEach((arr, name) => {
      const h = arr.filter((s) => s.hi !== null && s.hi <= days).sort(byRs), l = arr.filter((s) => s.lo !== null && s.lo <= days).sort(byRs);
      if (!h.length && !l.length) return;
      const rs = h.map((x) => x.rating).filter((v): v is number => typeof v === "number");
      out.push({ name, n: arr.length, highs: h, lows: l, avgRs: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null });
    });
    const key = (g: GroupRow) => (sort === "highs" ? g.highs.length * 1000 - g.lows.length : sort === "lows" ? g.lows.length * 1000 - g.highs.length : (g.highs.length - g.lows.length) / g.n);
    return out.sort((a, b) => key(b) - key(a));
  }, [known, mode, days, sort]);

  // spotlight: the group leading the highs (≥2 highs, best share), and the one leading the lows
  const leading = useMemo(() => [...groups].filter((g) => g.highs.length >= 2).sort((a, b) => b.highs.length / b.n - a.highs.length / a.n || b.highs.length - a.highs.length)[0] ?? null, [groups]);
  const weakest = useMemo(() => [...groups].filter((g) => g.lows.length >= 2).sort((a, b) => b.lows.length / b.n - a.lows.length / a.n || b.lows.length - a.lows.length)[0] ?? null, [groups]);

  const shown = showAll ? groups : groups.slice(0, PREVIEW);
  const net = highs.length - lows.length;
  const pctAtHigh = known.length ? (highs.length / known.length) * 100 : null;

  const [fmt, setFmt] = useState<ExportFormat>(() => { try { return (localStorage.getItem("rs-hl-format") as ExportFormat) || "lines"; } catch { return "lines"; } });
  const pickFmt = (f: ExportFormat) => { setFmt(f); try { localStorage.setItem("rs-hl-format", f); } catch { /* ignore */ } };
  const textFor = (list: HlStock[], sep: string) =>
    fmt === "sections" ? tvSectionsText(list.map((s) => ({ symbol: s.symbol, group: groupOf(s), score: s.rating }))) : list.map((s) => s.symbol).join(sep);
  const exportList = (list: HlStock[], what: "highs" | "lows") => {
    if (!list.length) return;
    const blob = new Blob([textFor(list, "\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `new-52w-${what}-${range}${fmt === "sections" ? `-by-${mode}` : ""}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${list.length} new 52-week ${what}`, {
      description: fmt === "sections" ? `Grouped by ${GROUP_MODE_LABEL[mode].toLowerCase()}, best groups first — ready for TradingView import.` : "One ticker per line — ready for TradingView import.",
    });
  };
  const copyList = (list: HlStock[], what: string) => {
    if (!list.length) return;
    navigator.clipboard.writeText(textFor(list, ",")).then(() => toast.success(`Copied ${list.length} ${what}`));
  };

  const groupCols = narrow ? "grid-cols-[22px_minmax(0,1fr)_48px_48px_52px]" : "grid-cols-[28px_minmax(0,1fr)_72px_72px_minmax(90px,140px)_70px_64px]";

  return (
    <section ref={rootRef} className={`flex flex-col bg-card ${docked ? "h-full" : "rounded-lg border border-border"}`} aria-label="New 52-week highs and lows">
      {/* ── header (Industry Leaders style) ── */}
      <header className="border-b border-border px-4 pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight">
              <TrendingUp size={17} className={HI} /> 52-week highs &amp; lows
              {loading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Stocks that reached a new 52-week high or low in {LONG[range]}, and the groups they come from.</p>
          </div>
          {onHide && (
            <button onClick={onHide} title={docked ? "Collapse panel" : "Hide"} aria-label="Close 52-week highs and lows"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X size={15} /></button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Window</span>
          <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Window">
            {(Object.keys(LABEL) as HlWindow[]).map((w) => (
              <button key={w} onClick={() => onRange(w)} aria-pressed={range === w}
                className={`rounded px-2 py-0.5 text-[11.5px] transition-colors ${range === w ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{LABEL[w]}</button>
            ))}
          </div>
          <select value={mode} onChange={(e) => onMode(e.target.value as GroupMode)} aria-label="Group by"
            className="ml-auto h-7 rounded-md border border-border bg-background px-2 text-[11.5px]">
            {(["industry", "subIndustry", "sector", "theme"] as GroupMode[]).map((m) => <option key={m} value={m}>by {GROUP_MODE_LABEL[m]}</option>)}
          </select>
        </div>
        <div className="mt-2 flex items-end gap-4">
          {([["groups", "Groups", LayoutGrid], ["stocks", "Stocks", List]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-0.5 pb-2 text-[12.5px] ${tab === k ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon size={13} /> {l}{k === "stocks" ? ` (${highs.length + lows.length})` : ""}
            </button>
          ))}
          <span className="ml-auto truncate pb-2 text-[10.5px] text-muted-foreground">
            {groups.length} groups · {known.length.toLocaleString()} stocks checked
          </span>
        </div>
      </header>

      {/* ── body ── */}
      <div className={`space-y-3 px-4 py-3 ${docked ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {/* summary strip */}
        <div className={`grid grid-cols-4 ${narrow ? "gap-1.5" : "gap-2"}`}>
          {[
            ["New highs", String(highs.length), HI, null],
            ["New lows", String(lows.length), LO, null],
            ["Net", `${net > 0 ? "+" : ""}${net}`, net > 0 ? HI : net < 0 ? LO : "", null],
            ["At a new high", pctAtHigh !== null ? `${pctAtHigh.toFixed(1)}%` : "—", "", known.length ? `of ${known.length.toLocaleString()}` : null],
          ].map(([l, v, cls, sub]) => (
            <div key={l as string} className={`rounded-lg border border-border bg-background/40 ${narrow ? "px-2 py-1.5" : "px-3 py-2"}`} title={sub ? `${l} ${v} ${sub}` : undefined}>
              <div className={`truncate uppercase tracking-wide text-muted-foreground ${narrow ? "text-[9px]" : "text-[10.5px]"}`}>{narrow && l === "At a new high" ? "At high" : l}</div>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-mono font-semibold tabular-nums ${cls} ${narrow ? "text-base" : "text-xl"}`}>{v}</span>
                {sub && !narrow && <span className="truncate text-[10.5px] text-muted-foreground">{sub}</span>}
              </div>
            </div>
          ))}
        </div>

        {!known.length ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{loading ? "Loading 52-week data…" : "No 52-week data yet."}</p>
        ) : tab === "groups" ? (
          <>
            {/* spotlight cards */}
            {(leading || weakest) && (
              <div className={`grid gap-2 ${narrow || !(leading && weakest) ? "grid-cols-1" : "grid-cols-2"}`}>
                {leading && <Spotlight g={leading} kind="highs" />}
                {weakest && <Spotlight g={weakest} kind="lows" />}
              </div>
            )}

            {/* groups table */}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-2 py-1.5">
                <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Sort</span>
                <Segmented<SortKey> size="xs" value={sort} onChange={setSort} options={SORTS} />
              </div>
              <div className={`grid ${groupCols} items-center gap-x-2 border-b border-border px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground`}>
                <span>#</span>
                <span>{GROUP_MODE_LABEL[mode]}</span>
                <span className="text-right">Highs</span>
                <span className="text-right">Lows</span>
                {narrow ? <span className="text-right" title="Share of the group at a new high">At hi</span> : (
                  <>
                    <span className="flex justify-between px-1 normal-case tracking-normal"><span>◀ lows</span><span>highs ▶</span></span>
                    <span className="text-right" title="Share of the group at a new high">At high</span>
                    <span className="text-right" title="Average RS rating of its new-high stocks">Avg RS</span>
                  </>
                )}
              </div>
              {!groups.length && <p className="py-4 text-center text-xs text-muted-foreground">No new highs or lows in {LONG[range]}.</p>}
              {shown.map((g, i) => {
                const isOpen = open === g.name;
                const hs = g.highs.length / g.n, ls = g.lows.length / g.n;
                const isLead = leading?.name === g.name;
                return (
                  <Fragment key={g.name}>
                    <button onClick={() => setOpen(isOpen ? null : g.name)} aria-expanded={isOpen}
                      className={`grid w-full ${groupCols} items-stretch gap-x-2 border-b border-border/40 px-2 text-left hover:bg-accent/30 ${isLead ? "bg-[hsl(40,90%,55%)]/[0.05]" : ""}`}>
                      <span className="flex items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{!narrow && i + 1}
                      </span>
                      <span className="min-w-0 py-1.5">
                        <span className="flex items-center gap-1 truncate text-[12.5px] font-medium">{isLead && <Crown size={11} className="shrink-0 text-[hsl(40,90%,60%)]" />}<span className="truncate">{g.name}</span></span>
                        <span className="block text-[10.5px] text-muted-foreground">{g.n} stocks</span>
                      </span>
                      <span className={`flex items-center justify-end px-1.5 font-mono text-[12.5px] tabular-nums ${hiCell(hs)} ${g.highs.length ? HI : "text-muted-foreground/60"}`}>{g.highs.length || "·"}</span>
                      <span className={`flex items-center justify-end px-1.5 font-mono text-[12.5px] tabular-nums ${loCell(ls)} ${g.lows.length ? LO : "text-muted-foreground/60"}`}>{g.lows.length || "·"}</span>
                      {narrow ? (
                        <span className="flex items-center justify-end font-mono text-[11.5px] tabular-nums">{Math.round(hs * 100)}%</span>
                      ) : (
                        <>
                          <span className="grid grid-cols-2 items-center" aria-hidden>
                            <span className="flex justify-end border-r border-border pr-0.5"><span className="h-2 rounded-sm bg-[hsl(330,72%,57%)]" style={{ width: `${Math.min(100, ls * 100)}%` }} /></span>
                            <span className="flex pl-0.5"><span className="h-2 rounded-sm bg-[hsl(222,82%,63%)]" style={{ width: `${Math.min(100, hs * 100)}%` }} /></span>
                          </span>
                          <span className="flex items-center justify-end font-mono text-[11.5px] tabular-nums">{Math.round(hs * 100)}%</span>
                          <span className={`flex items-center justify-end font-mono text-[11.5px] tabular-nums ${rsCls(g.avgRs)}`}>{g.avgRs !== null ? g.avgRs.toFixed(0) : "—"}</span>
                        </>
                      )}
                    </button>
                    {isOpen && (
                      <div className="space-y-2 border-b border-border/40 bg-background/50 px-3 py-2.5">
                        {([["highs", g.highs], ["lows", g.lows]] as const).map(([w, list]) => list.length > 0 && (
                          <div key={w} className="space-y-1">
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className={`font-semibold ${w === "highs" ? HI : LO}`}>{list.length} new {list.length === 1 ? w.slice(0, -1) : w}</span>
                              <button onClick={() => copyList(list, `${g.name} ${w}`)} className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"><Copy size={10} /> Copy</button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {list.map((s) => (
                                <a key={s.symbol} href={tv(s.symbol)} target="_blank" rel="noopener noreferrer" title={s.name ?? s.symbol}
                                  className="inline-flex items-baseline gap-1 rounded border border-border bg-card px-1.5 py-0.5 hover:border-primary/60">
                                  <span className="font-mono text-[11px] font-semibold">{s.symbol}</span>
                                  <span className={`font-mono text-[10px] ${rsCls(s.rating)}`}>{s.rating ?? "—"}</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {groups.length > PREVIEW && (
                <button onClick={() => setShowAll((v) => !v)} className="w-full py-2 text-center text-[11.5px] text-primary hover:bg-accent/20">{showAll ? "Show fewer" : `Show all ${groups.length} groups`}</button>
              )}
            </div>
          </>
        ) : (
          <StockTable list={side === "highs" ? highs : lows} side={side} onSide={setSide} counts={{ highs: highs.length, lows: lows.length }} groupLabel={GROUP_MODE_LABEL[mode]} groupOf={groupOf} narrow={narrow} />
        )}
        {known.length > 0 && <p className="text-[10px] leading-snug text-muted-foreground">
          Highs / Lows = stocks in the group that made a new 52-week high / low in {LONG[range]}; the shading deepens as a bigger share of the group does. At high = share of the group at a new high. Avg RS = average RS rating of its new-high stocks. <Crown size={9} className="inline text-[hsl(40,90%,60%)]" /> = the group with the biggest share at new highs.
        </p>}
      </div>

      {/* ── footer: table filter, legend and exports ── */}
      <footer className="space-y-2 border-t border-border px-4 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px]">
          <input type="checkbox" checked={filterOn} onChange={(e) => onFilter(e.target.checked)} />
          Show only new-high stocks in the RS table
          {filterOn && <span className="text-muted-foreground">· {tableMatches.toLocaleString()} in the table</span>}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented<ExportFormat> size="xs" value={fmt} onChange={pickFmt}
            options={(["lines", "sections"] as ExportFormat[]).map((f) => ({ value: f, label: EXPORT_FORMAT_LABEL[f], title: f === "sections" ? `Each ${GROUP_MODE_LABEL[mode].toLowerCase()} under its own heading, best groups (highest average RS) first` : "A plain list, highest RS first" }))} />
          <span className="ml-auto flex flex-wrap gap-1.5">
            <ExportButton n={highs.length} what="highs" onDownload={() => exportList(highs, "highs")} onCopy={() => copyList(highs, "new highs")} />
            <ExportButton n={lows.length} what="lows" onDownload={() => exportList(lows, "lows")} onCopy={() => copyList(lows, "new lows")} />
          </span>
        </div>
      </footer>
    </section>
  );
}

/** Highlighted group — the Industry Leaders "leader card" pattern. */
function Spotlight({ g, kind }: { g: GroupRow; kind: "highs" | "lows" }) {
  const list = kind === "highs" ? g.highs : g.lows;
  const share = Math.round((list.length / g.n) * 100);
  const hi = kind === "highs";
  return (
    <div className={`rounded-lg border p-3 ${hi ? "border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/[0.06]" : "border-[hsl(330,72%,57%)]/35 bg-[hsl(330,72%,57%)]/[0.05]"}`}>
      <div className="flex items-center gap-1.5">
        {hi ? <Crown size={14} className="text-[hsl(40,90%,60%)]" /> : <TrendingDown size={14} className={LO} />}
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{hi ? "Leading the highs" : "Leading the lows"}</span>
      </div>
      <div className="mt-1 truncate text-[14px] font-semibold">{g.name}</div>
      <div className="text-[11.5px] text-muted-foreground">
        <span className={`font-mono font-semibold ${hi ? HI : LO}`}>{list.length}</span> of {g.n} at new {kind} ({share}%){hi && g.avgRs !== null ? <> · avg RS <span className={`font-mono ${rsCls(g.avgRs)}`}>{g.avgRs.toFixed(0)}</span></> : null}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/50"><div className={`h-full rounded-full ${hi ? "bg-[hsl(222,82%,63%)]" : "bg-[hsl(330,72%,57%)]"}`} style={{ width: `${share}%` }} /></div>
      <div className="mt-2 flex flex-wrap gap-1">
        {list.slice(0, 6).map((s) => (
          <a key={s.symbol} href={tv(s.symbol)} target="_blank" rel="noopener noreferrer" title={s.name ?? s.symbol}
            className="inline-flex items-baseline gap-1 rounded border border-border bg-card px-1.5 py-0.5 hover:border-primary/60">
            <span className="font-mono text-[11px] font-semibold">{s.symbol}</span>
            <span className={`font-mono text-[10px] ${rsCls(s.rating)}`}>{s.rating ?? "—"}</span>
          </a>
        ))}
        {list.length > 6 && <span className="self-center text-[10.5px] text-muted-foreground">+{list.length - 6}</span>}
      </div>
    </div>
  );
}

function ExportButton({ n, what, onDownload, onCopy }: { n: number; what: "highs" | "lows"; onDownload: () => void; onCopy: () => void }) {
  const tone = what === "highs" ? "border-[hsl(222,82%,63%)]/50 text-[hsl(222,82%,66%)] hover:bg-[hsl(222,82%,63%)]/10" : "border-[hsl(330,72%,57%)]/50 text-[hsl(330,72%,64%)] hover:bg-[hsl(330,72%,57%)]/10";
  return (
    <span className={`inline-flex overflow-hidden rounded-md border text-[11.5px] ${tone}`}>
      <button onClick={onDownload} disabled={!n} className="inline-flex items-center gap-1 px-2.5 py-1 font-medium disabled:opacity-40" title={`Download all ${n} new 52-week ${what} as a TradingView .txt`}>
        <Download size={12} /> Export {n} {what}
      </button>
      <button onClick={onCopy} disabled={!n} className="border-l border-current/30 px-2 py-1 disabled:opacity-40" title={`Copy the ${n} tickers`} aria-label={`Copy new ${what}`}>
        <Copy size={12} />
      </button>
    </span>
  );
}

function StockTable({ list, side, onSide, counts, groupLabel, groupOf, narrow }: {
  list: HlStock[]; side: "highs" | "lows"; onSide: (s: "highs" | "lows") => void; counts: { highs: number; lows: number };
  groupLabel: string; groupOf: (s: HlStock) => string; narrow: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 40);
  const when = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d ago`);
  const cols = narrow ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px_54px]" : "grid-cols-[32px_minmax(140px,1.2fr)_minmax(0,1fr)_48px_72px]";
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-2 py-1.5">
        <Segmented<"highs" | "lows"> size="xs" value={side} onChange={onSide} options={[{ value: "highs", label: `New highs ${counts.highs}` }, { value: "lows", label: `New lows ${counts.lows}` }]} />
        <span className="ml-auto text-[10.5px] text-muted-foreground">highest RS first</span>
      </div>
      <div className={`grid ${cols} gap-x-2 border-b border-border px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        {!narrow && <span>#</span>}<span>Stock</span><span>{groupLabel}</span><span className="text-right">RS</span><span className="text-right" title={side === "highs" ? "When it made the new high" : "When it made the new low"}>When</span>
      </div>
      {!list.length && <p className="py-4 text-center text-xs text-muted-foreground">None in this window.</p>}
      {shown.map((s, i) => (
        <div key={s.symbol} className={`grid ${cols} items-center gap-x-2 border-b border-border/40 px-2 py-1.5`}>
          {!narrow && <span className="text-[11px] text-muted-foreground">{i + 1}</span>}
          <span className="min-w-0">
            <a href={tv(s.symbol)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12.5px] font-bold hover:text-primary hover:underline">{s.symbol}</a>
            {s.name && <span className="block truncate text-[10.5px] text-muted-foreground">{s.name}</span>}
          </span>
          <span className="truncate text-[11.5px] text-muted-foreground">{groupOf(s)}</span>
          <span className={`text-right font-mono text-[12px] tabular-nums ${rsCls(s.rating)}`}>{s.rating ?? "—"}</span>
          <span className={`text-right font-mono text-[11px] ${(side === "highs" ? s.hi : s.lo) === 0 ? (side === "highs" ? HI : LO) : "text-muted-foreground"}`}>{when(side === "highs" ? s.hi : s.lo)}</span>
        </div>
      ))}
      {list.length > 40 && <button onClick={() => setAll((v) => !v)} className="w-full py-2 text-center text-[11.5px] text-primary hover:bg-accent/20">{all ? "Show fewer" : `Show all ${list.length}`}</button>}
    </div>
  );
}

/** The panel collapsed into a thin rail (like the Brief): keeps highs vs lows in view. */
export function HighsLowsRail({ highs, lows, range, onOpen }: { highs: number; lows: number; range: HlWindow; onOpen: () => void }) {
  const net = highs - lows;
  return (
    <div className="flex h-full flex-col items-center gap-4 py-3">
      <button onClick={onOpen} aria-label="Open 52-week highs and lows" title="Open 52-week highs & lows"
        className="grid h-10 w-10 place-items-center rounded-lg border border-[hsl(222,82%,63%)]/60 bg-[hsl(222,82%,63%)]/10 text-[hsl(222,82%,66%)] hover:bg-[hsl(222,82%,63%)]/20">
        <TrendingUp size={16} />
      </button>
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{LABEL[range]}</span>
      <button onClick={onOpen} className="flex flex-col items-center" title={`New 52-week highs in ${LONG[range]}`}>
        <span className={`font-mono text-[13px] font-semibold ${HI}`}>{highs}</span>
        <span className="text-[9.5px] text-muted-foreground">highs</span>
      </button>
      <button onClick={onOpen} className="flex flex-col items-center" title={`New 52-week lows in ${LONG[range]}`}>
        <span className={`font-mono text-[13px] font-semibold ${LO}`}>{lows}</span>
        <span className="text-[9.5px] text-muted-foreground">lows</span>
      </button>
      <span className="h-px w-7 bg-border" aria-hidden />
      <div className="flex flex-col items-center" title="New highs minus new lows">
        <span className={`font-mono text-[11px] ${net > 0 ? HI : net < 0 ? LO : ""}`}>{net > 0 ? "+" : ""}{net}</span>
        <span className="text-[9.5px] text-muted-foreground">net</span>
      </div>
    </div>
  );
}

/** Counts for the rail and the header button (same rules as the panel). */
export function hlCounts(stocks: HlStock[], range: HlWindow) {
  const d = hlWindowDays(range);
  let highs = 0, lows = 0;
  for (const s of stocks) { if (s.hi !== null && s.hi <= d) highs++; if (s.lo !== null && s.lo <= d) lows++; }
  return { highs, lows };
}
