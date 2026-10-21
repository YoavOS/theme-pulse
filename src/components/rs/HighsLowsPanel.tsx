import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/Explainer";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { EXPORT_FORMAT_LABEL, tvSectionsText, type ExportFormat } from "@/lib/tvSections";

/**
 * RS Alpha — new 52-week highs and lows in one panel with one timeframe.
 * The same timeframe drives the "only new highs" filter on the RS table.
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
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const open = new Date(ny);
  open.setHours(9, 30, 0, 0);
  if (ny < open) open.setDate(open.getDate() - 1);
  while (open.getDay() === 0 || open.getDay() === 6) open.setDate(open.getDate() - 1);
  const age = Math.max(0, Math.floor((ny.getTime() - open.getTime()) / 86400000));
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

export default function HighsLowsPanel({ stocks, loading, range, onRange, mode, onMode, filterOn, onFilter, tableMatches, onHide }: {
  stocks: HlStock[];
  loading: boolean;
  range: HlWindow;
  onRange: (w: HlWindow) => void;
  mode: GroupMode;
  onMode: (m: GroupMode) => void;
  filterOn: boolean;
  onFilter: (on: boolean) => void;
  tableMatches: number;
  onHide?: () => void;
}) {
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

  const maxBar = Math.max(1, ...groups.map((g) => Math.max(g.highs.length, g.lows.length)));
  const shown = showAll ? groups : groups.slice(0, PREVIEW);
  const net = highs.length - lows.length;

  const [fmt, setFmt] = useState<ExportFormat>(() => { try { return (localStorage.getItem("rs-hl-format") as ExportFormat) || "lines"; } catch { return "lines"; } });
  const pickFmt = (f: ExportFormat) => { setFmt(f); try { localStorage.setItem("rs-hl-format", f); } catch { /* ignore */ } };
  const groupOf = (s: HlStock) => (mode === "theme" ? (s.theme?.trim() || "No theme") : groupKeyForIndustry(s.industry, mode));
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

  const kpi = (label: string, value: string, cls = "", sub?: string) => (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-xl font-semibold tabular-nums ${cls}`}>{value}</span>
        {sub && <span className="truncate text-[10.5px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3.5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
            New 52-week highs &amp; lows {loading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Stocks that reached a new 52-week high or low in {LONG[range]}, and the groups they come from.</p>
        </div>
        <Segmented<HlWindow> value={range} onChange={onRange} options={(Object.keys(LABEL) as HlWindow[]).map((w) => ({ value: w, label: LABEL[w] }))} />
        <select value={mode} onChange={(e) => onMode(e.target.value as GroupMode)} className="h-7 rounded border border-border bg-background px-2 text-[11.5px]" aria-label="Group by">
          {(["industry", "subIndustry", "sector", "theme"] as GroupMode[]).map((m) => <option key={m} value={m}>{GROUP_MODE_LABEL[m]}</option>)}
        </select>
        {onHide && <button onClick={onHide} className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">Hide</button>}
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpi("New highs", String(highs.length), "text-[hsl(166,100%,42%)]")}
        {kpi("New lows", String(lows.length), "text-[hsl(344,100%,65%)]")}
        {kpi("Net", `${net > 0 ? "+" : ""}${net}`, net > 0 ? "text-[hsl(166,100%,42%)]" : net < 0 ? "text-[hsl(344,100%,65%)]" : "")}
        {kpi("At a new high", known.length ? `${((highs.length / known.length) * 100).toFixed(1)}%` : "—", "", known.length ? `of ${known.length} checked` : undefined)}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
        {([["groups", "Groups"], ["stocks", `Stocks (${highs.length + lows.length})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`-mb-px border-b-2 px-0.5 py-1.5 text-[12.5px] ${tab === k ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {l}
          </button>
        ))}
        <span className="ml-auto pb-1.5">
          {tab === "groups"
            ? <Segmented<SortKey> size="xs" value={sort} onChange={setSort} options={SORTS} />
            : <Segmented<"highs" | "lows"> size="xs" value={side} onChange={setSide} options={[{ value: "highs", label: `Highs ${highs.length}` }, { value: "lows", label: `Lows ${lows.length}` }]} />}
        </span>
      </div>

      {!known.length ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{loading ? "Loading 52-week data…" : "No 52-week data yet."}</p>
      ) : tab === "groups" ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,220px)_52px_52px] gap-x-3 px-1 pb-1 text-[10.5px] text-muted-foreground">
            <span>{GROUP_MODE_LABEL[mode]}</span>
            <span className="flex justify-between"><span>◀ lows</span><span>highs ▶</span></span>
            <span className="text-right" title="Share of the group at a new high">At high</span>
            <span className="text-right" title="Average RS rating of its new-high stocks">Avg RS</span>
          </div>
          {!groups.length && <p className="py-4 text-center text-xs text-muted-foreground">No new highs or lows in {LONG[range]}.</p>}
          {shown.map((g) => {
            const isOpen = open === g.name;
            return (
              <Fragment key={g.name}>
                <button onClick={() => setOpen(isOpen ? null : g.name)} aria-expanded={isOpen}
                  className="grid w-full grid-cols-[minmax(0,1fr)_minmax(120px,220px)_52px_52px] items-center gap-x-3 border-b border-border/30 px-1 py-1.5 text-left hover:bg-accent/30">
                  <span className="flex min-w-0 items-center gap-1 text-[12.5px]">
                    {isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0 text-muted-foreground" />}
                    <span className="truncate">{g.name}</span> <span className="text-muted-foreground">{g.n}</span>
                  </span>
                  <span className="grid grid-cols-2 items-center">
                    <span className="flex items-center justify-end gap-1 border-r border-border pr-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground">{g.lows.length || ""}</span>
                      <span className="h-2.5 rounded-sm bg-[hsl(344,85%,58%)]" style={{ width: `${(g.lows.length / maxBar) * 80}%` }} />
                    </span>
                    <span className="flex items-center gap-1 pl-0.5">
                      <span className="h-2.5 rounded-sm bg-[hsl(166,85%,40%)]" style={{ width: `${(g.highs.length / maxBar) * 80}%` }} />
                      <span className="font-mono text-[10px] text-muted-foreground">{g.highs.length || ""}</span>
                    </span>
                  </span>
                  <span className="text-right font-mono text-[11.5px] tabular-nums">{Math.round((g.highs.length / g.n) * 100)}%</span>
                  <span className="text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">{g.avgRs !== null ? g.avgRs.toFixed(0) : "—"}</span>
                </button>
                {isOpen && (
                  <div className="space-y-1.5 border-b border-border/30 bg-background/40 px-6 py-2 text-[11px]">
                    {([["highs", g.highs, "text-[hsl(166,100%,42%)]"], ["lows", g.lows, "text-[hsl(344,100%,65%)]"]] as const).map(([w, list, cls]) => list.length > 0 && (
                      <div key={w} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className={`font-medium ${cls}`}>{list.length} new {w}</span>
                        <span className="font-mono text-muted-foreground">{list.map((s) => s.symbol).join(", ")}</span>
                        <button onClick={() => copyList(list, `${g.name} ${w}`)} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"><Copy size={10} /> Copy</button>
                      </div>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
          {groups.length > PREVIEW && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-[11.5px] text-primary hover:underline">{showAll ? "Show fewer" : `Show all ${groups.length} groups`}</button>
          )}
        </>
      ) : (
        <StockList list={side === "highs" ? highs : lows} side={side} mode={mode} />
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-[11.5px]">
          <input type="checkbox" checked={filterOn} onChange={(e) => onFilter(e.target.checked)} />
          Show only new-high stocks in the RS table
          {filterOn && <span className="text-muted-foreground">· {tableMatches.toLocaleString()} in the table</span>}
        </label>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Segmented<ExportFormat> size="xs" value={fmt} onChange={pickFmt}
            options={(["lines", "sections"] as ExportFormat[]).map((f) => ({ value: f, label: EXPORT_FORMAT_LABEL[f], title: f === "sections" ? `Each ${GROUP_MODE_LABEL[mode].toLowerCase()} under its own heading, best groups (highest average RS) first` : "A plain list, highest RS first" }))} />
          <ExportButton n={highs.length} what="highs" onDownload={() => exportList(highs, "highs")} onCopy={() => copyList(highs, "new highs")} />
          <ExportButton n={lows.length} what="lows" onDownload={() => exportList(lows, "lows")} onCopy={() => copyList(lows, "new lows")} />
        </span>
      </footer>
    </section>
  );
}

function ExportButton({ n, what, onDownload, onCopy }: { n: number; what: "highs" | "lows"; onDownload: () => void; onCopy: () => void }) {
  const tone = what === "highs" ? "border-[hsl(166,85%,40%)]/50 text-[hsl(166,100%,45%)] hover:bg-[hsl(166,85%,40%)]/10" : "border-[hsl(344,85%,58%)]/50 text-[hsl(344,100%,70%)] hover:bg-[hsl(344,85%,58%)]/10";
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

function StockList({ list, side, mode }: { list: HlStock[]; side: "highs" | "lows"; mode: GroupMode }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 40);
  if (!list.length) return <p className="py-4 text-center text-xs text-muted-foreground">None in this window.</p>;
  const when = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d ago`);
  return (
    <div>
      <div className="grid grid-cols-[64px_minmax(0,1fr)_40px_60px] sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_44px_64px] gap-x-3 px-1 pb-1 text-[10.5px] text-muted-foreground">
        <span>Stock</span><span className="hidden sm:inline">Company</span><span>{GROUP_MODE_LABEL[mode]}</span><span className="text-right">RS</span><span className="text-right">{side === "highs" ? "New high" : "New low"}</span>
      </div>
      {shown.map((s) => (
        <div key={s.symbol} className="grid grid-cols-[64px_minmax(0,1fr)_40px_60px] sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_44px_64px] items-center gap-x-3 border-b border-border/30 px-1 py-1 text-[12px]">
          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s.symbol)}`} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold hover:text-primary hover:underline">{s.symbol}</a>
          <span className="hidden truncate text-muted-foreground sm:inline">{s.name ?? ""}</span>
          <span className="truncate text-muted-foreground">{mode === "theme" ? s.theme ?? "—" : groupKeyForIndustry(s.industry, mode)}</span>
          <span className={`text-right font-mono tabular-nums ${(s.rating ?? 0) >= 90 ? "text-[hsl(166,100%,42%)]" : ""}`}>{s.rating ?? "—"}</span>
          <span className="text-right font-mono text-[11px] text-muted-foreground">{when(side === "highs" ? s.hi : s.lo)}</span>
        </div>
      ))}
      {list.length > 40 && <button onClick={() => setAll((v) => !v)} className="mt-1.5 text-[11.5px] text-primary hover:underline">{all ? "Show fewer" : `Show all ${list.length}`}</button>}
    </div>
  );
}
