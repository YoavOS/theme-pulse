import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ThemeData, Ticker } from "@/data/themeData";
import { HeatLegend, HeatTiles } from "@/components/dashboard/TrackerDisplays";
import SectorIndustryHeatmap from "@/components/dashboard/SectorIndustryHeatmap";
import { GroupBars, GroupCards } from "@/components/dashboard/GroupDisplays";
import { niceMax } from "@/lib/groupDisplay";
import { Segmented } from "@/components/Explainer";
import { marketClock, useLiveSession } from "@/hooks/useLiveSession";
import type { PerfCache } from "@/hooks/useFullScan";
import { useStockStages } from "@/hooks/useStockStages";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";

/**
 * Theme Tracker — every group as one diverging bar, strongest first.
 *  • Since Open: live (fetch-themes "Today" → each ticker's change from today's open).
 *    Covers the theme tickers; in Industry/Sector views only those stocks are grouped.
 *  • Today / 1W / 1M / 3M: the Dashboard's last Full Scan (whole stock list).
 *  • YTD: weekly closes from the Stage scan (true year-to-date, not the scan's 6-month field).
 */

export type TrackerTf = "open" | "1D" | "1W" | "1M" | "3M" | "YTD";
const TFS: { key: TrackerTf; label: string; tip: string }[] = [
  { key: "open", label: "Since Open", tip: "Change from today's opening price (live) — where money flows during the session, separate from the overnight gap." },
  { key: "1D", label: "Today", tip: "Change from yesterday's close, as of the last Full Scan." },
  { key: "1W", label: "1W", tip: "1-week change, as of the last Full Scan." },
  { key: "1M", label: "1M", tip: "1-month change, as of the last Full Scan." },
  { key: "3M", label: "3M", tip: "3-month change, as of the last Full Scan." },
  { key: "YTD", label: "YTD", tip: "Change since the last close of the previous year (weekly closes from the Stage scan)." },
];
const TF_KEY = "theme_tracker_tf_v1";
const SHOW_KEY = "theme_tracker_show_v1";
const DISPLAY_KEY = "theme_tracker_display_v1";
export type TrackerDisplay = "bars" | "cards" | "heat";
const DISPLAYS: { value: TrackerDisplay; label: string; title: string }[] = [
  { value: "bars", label: "Bars", title: "Every group as one bar, strongest first" },
  { value: "cards", label: "Cards", title: "Every group as a card with its move, strongest first" },
  { value: "heat", label: "Heatmap", title: "Colored tiles, strongest first" },
];

interface Member { symbol: string; name?: string | null }

export default function ThemeTracker({
  groupMode, baseThemes, universeList, industryBySymbol, loadPerfMap, scanCompletedAt, onOpen, sectorOf, minMove = 0,
}: {
  groupMode: GroupMode;
  baseThemes: ThemeData[];
  universeList: { symbol: string; sector: string | null; name?: string | null }[];
  industryBySymbol: Map<string, string | null>;
  loadPerfMap: () => Promise<PerfCache | null>;
  scanCompletedAt: Date | null;
  onOpen: (t: ThemeData) => void;
  /** Sector + Industry mode: industry name → its sector. */
  sectorOf?: (industry: string) => string;
  /** Movers only: hide groups whose move is inside ±minMove% (0 = show all). */
  minMove?: number;
}) {
  const [tf, setTf] = useState<TrackerTf>(() => {
    try { const v = localStorage.getItem(TF_KEY) as TrackerTf | null; return v && TFS.some((t) => t.key === v) ? v : "open"; } catch { return "open"; }
  });
  const [showAll, setShowAll] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_KEY) !== "top"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(TF_KEY, tf); } catch { /* ignore */ } }, [tf]);
  useEffect(() => { try { localStorage.setItem(SHOW_KEY, showAll ? "all" : "top"); } catch { /* ignore */ } }, [showAll]);
  const [display, setDisplay] = useState<TrackerDisplay>(() => {
    try { const v = localStorage.getItem(DISPLAY_KEY) as TrackerDisplay | null; return v && DISPLAYS.some((d) => d.value === v) ? v : "bars"; } catch { return "bars"; }
  });
  useEffect(() => { try { localStorage.setItem(DISPLAY_KEY, display); } catch { /* ignore */ } }, [display]);

  // ── Full Scan numbers ──
  const [perf, setPerf] = useState<PerfCache | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPerfMap().then((p) => { if (!cancelled) setPerf(p); });
    return () => { cancelled = true; };
  }, [loadPerfMap, scanCompletedAt]);

  // ── YTD from the stage scan ──
  const { bySymbol: stageBy, loading: stagesLoading } = useStockStages(tf === "YTD");

  // ── Live since-open ──
  const { live, loading: liveLoading, error: liveError, refresh: fetchOpen } = useLiveSession(tf === "open");

  // ── Groups ──
  const groups = useMemo(() => {
    const m = new Map<string, Member[]>();
    const add = (key: string, mem: Member) => {
      const arr = m.get(key) ?? [];
      if (!arr.some((x) => x.symbol === mem.symbol)) arr.push(mem);
      m.set(key, arr);
    };
    if (groupMode === "theme") {
      for (const t of baseThemes) for (const tk of t.tickers) add(t.theme_name, { symbol: tk.symbol.toUpperCase(), name: tk.name });
    } else if (tf === "open") {
      // Live quotes exist only for theme tickers — group those by their classification.
      const seen = new Set<string>();
      for (const t of baseThemes) for (const tk of t.tickers) {
        const s = tk.symbol.toUpperCase();
        if (seen.has(s)) continue;
        seen.add(s);
        add(groupKeyForIndustry(industryBySymbol.get(s) ?? null, groupMode), { symbol: s, name: tk.name });
      }
    } else {
      for (const r of universeList) add(groupKeyForIndustry(r.sector, groupMode), { symbol: r.symbol.toUpperCase(), name: r.name });
    }
    return m;
  }, [groupMode, baseThemes, universeList, industryBySymbol, tf]);

  const valueOf = useCallback((sym: string): number | null => {
    let v: number | null | undefined;
    if (tf === "open") v = live?.map.get(sym)?.open;
    else if (tf === "YTD") v = stageBy.get(sym)?.features?.ytdPct;
    else {
      const p = perf?.tickers[sym];
      v = !p ? null : tf === "1D" ? p.perf_1d : tf === "1W" ? p.perf_1w : tf === "1M" ? p.perf_1m : p.perf_3m;
    }
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }, [tf, live, stageBy, perf]);

  const allRows = useMemo(() => {
    const out: ThemeData[] = [];
    groups.forEach((members, name) => {
      const tickers: Ticker[] = members.map((mem) => {
        const v = valueOf(mem.symbol);
        return v === null
          ? { symbol: mem.symbol, name: mem.name ?? undefined, pct: 0, skipped: true, skipReason: "No data for this timeframe" }
          : { symbol: mem.symbol, name: mem.name ?? undefined, pct: Math.round(v * 100) / 100 };
      });
      const valid = tickers.filter((t) => !t.skipped);
      if (!valid.length) return;
      const avg = valid.reduce((s, t) => s + t.pct, 0) / valid.length;
      out.push({
        theme_name: name,
        performance_pct: Math.round(avg * 100) / 100,
        up_count: valid.filter((t) => t.pct > 0).length,
        down_count: valid.filter((t) => t.pct <= 0).length,
        na_count: tickers.length - valid.length,
        valid_count: valid.length,
        tickers: [...valid].sort((a, b) => b.pct - a.pct).concat(tickers.filter((t) => t.skipped)),
        dataSource: "real",
      });
    });
    out.sort((a, b) => b.performance_pct - a.performance_pct);
    return out;
  }, [groups, valueOf]);
  const rows = useMemo(() => (minMove > 0 ? allRows.filter((r) => Math.abs(r.performance_pct) >= minMove) : allRows), [allRows, minMove]);
  const hidden = allRows.length - rows.length;

  const shown = rows;
  const scale = niceMax(Math.max(0, ...rows.map((r) => Math.abs(r.performance_pct))));
  const clock = marketClock();

  let status: string;
  if (tf === "open") {
    status = live
      ? `live · ${new Date(live.fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET · ${clock.open ? `${clock.sinceOpen} min since open · refreshes every 5 min` : "market closed — last session"}`
      : liveLoading ? "fetching live quotes…" : "";
  } else if (tf === "YTD") {
    status = "weekly closes from the last Stage scan";
  } else {
    status = perf?.scannedAt
      ? `Full Scan ${new Date(perf.scannedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : perf ? "last Full Scan" : "";
  }

  const emptyMsg = hidden > 0 ? `No group moved more than ±${minMove}% — turn off Movers only to see all ${allRows.length}.` :
    tf === "open"
      ? liveLoading ? "Fetching live quotes…"
        : liveError === "no_open" ? "No since-open prices came back yet (this needs the updated fetch-themes function — or try again in a minute)."
        : liveError ? `Couldn't fetch live quotes: ${liveError}` : "No live data yet."
      : tf === "YTD"
        ? stagesLoading ? "Loading…" : "No YTD data yet — run a Full Scan (it updates stages too) or Scan Stages."
        : perf ? "No stocks in these groups were in the last Full Scan." : "No Full Scan data yet — press Full Scan.";


  const tfSwitch = (
    <div className="inline-flex rounded-md border border-border bg-muted/20 p-0.5">
      {TFS.map((t) => (
        <button
          key={t.key}
          title={t.tip}
          onClick={() => setTf(t.key)}
          className={`rounded px-2.5 py-1 text-[11px] font-medium ${tf === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{sectorOf ? "Sector + Industry" : GROUP_MODE_LABEL[groupMode]} Tracker</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
        {hidden > 0 && <span className="text-[11px] text-muted-foreground">· {hidden} quiet group{hidden === 1 ? "" : "s"} hidden (within ±{minMove}%)</span>}
        {tf === "open" && (
          <button onClick={fetchOpen} disabled={liveLoading} title="Refresh live quotes" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            {liveLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented<TrackerDisplay> size="xs" value={display} onChange={setDisplay} options={DISPLAYS} />
          {tfSwitch}
        </div>
      </div>

      {!shown.length ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyMsg}</div>
      ) : display === "heat" && sectorOf ? (
        <SectorIndustryHeatmap industries={rows} sectorOf={sectorOf} onOpen={onOpen} />
      ) : display === "heat" ? (
        <div className="space-y-2">
          <div className="flex justify-end"><HeatLegend scale={scale} /></div>
          <HeatTiles rows={shown} scale={scale} onOpen={onOpen} />
        </div>
      ) : display === "cards" ? (
        <GroupCards rows={rows} onOpen={onOpen} sectorOf={sectorOf} />
      ) : (
        <GroupBars rows={rows} onOpen={onOpen} sectorOf={sectorOf} showAll={showAll} onShowAll={setShowAll} />
      )}

      <div className="mt-3 rounded-r-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {tf === "open" ? (
          <>
            <b className="text-foreground/90">Since Open</b> = change from today's opening price — shows where money is flowing <i>during</i> the session,
            separate from overnight gaps (Today = change from yesterday's close).
            {groupMode !== "theme" && " In this view only your theme tickers have live quotes, so groups contain those stocks."}
          </>
        ) : tf === "YTD" ? (
          <><b className="text-foreground/90">YTD</b> = change since the last close of the previous year, from weekly closes.</>
        ) : (
          <><b className="text-foreground/90">{TFS.find((t) => t.key === tf)?.label}</b> numbers come from the Dashboard's last Full Scan{groupMode !== "theme" ? " and cover the whole stock list" : ""}.</>
        )}
        {" "}{display === "bars" ? "The right column is breadth: stocks up / stocks with data." : display === "cards" ? "Cards are ordered strongest first; hover one for its breadth." : sectorOf ? "Tile width is the number of stocks in the industry; click a sector name for all its stocks." : "Tiles are ordered strongest first."} Click a group to open its stocks.
      </div>
    </div>
  );
}
