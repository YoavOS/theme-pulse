import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ThemeData, Ticker } from "@/data/themeData";
import TrendView from "@/components/dashboard/TrackerTrendView";
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

export type TrackerTf = "open" | "1D" | "1W" | "1M" | "3M" | "YTD" | "trend";
const TFS: { key: TrackerTf; label: string; tip: string }[] = [
  { key: "open", label: "Since Open", tip: "Change from today's opening price (live) — where money flows during the session, separate from the overnight gap." },
  { key: "1D", label: "Today", tip: "Change from yesterday's close, as of the last Full Scan." },
  { key: "1W", label: "1W", tip: "1-week change, as of the last Full Scan." },
  { key: "1M", label: "1M", tip: "1-month change, as of the last Full Scan." },
  { key: "3M", label: "3M", tip: "3-month change, as of the last Full Scan." },
  { key: "YTD", label: "YTD", tip: "Change since the last close of the previous year (weekly closes from the Stage scan)." },
  { key: "trend", label: "1W · 1M · 3M", tip: "All three timeframes side by side — who has led consistently, who is newly leading, who is losing steam." },
];
const TF_KEY = "theme_tracker_tf_v1";
const SHOW_KEY = "theme_tracker_show_v1";
const REFRESH_MS = 5 * 60 * 1000;

interface Member { symbol: string; name?: string | null }
interface LiveOpen { map: Map<string, number>; fetchedAt: number }

/** US regular session status in New York time. */
function marketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = !["Sat", "Sun"].includes(wd);
  const open = weekday && mins >= 9 * 60 + 30 && mins < 16 * 60;
  return { open, sinceOpen: open ? mins - (9 * 60 + 30) : null, time: `${get("hour")}:${get("minute")}` };
}

/** Round the scale up to a readable number so bars are comparable at a glance. */
function niceMax(x: number) {
  if (!(x > 0)) return 1;
  const steps = [0.5, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000];
  return steps.find((s) => s >= x) ?? Math.ceil(x / 100) * 100;
}

export default function ThemeTracker({
  groupMode, baseThemes, universeList, industryBySymbol, loadPerfMap, scanCompletedAt, onOpen,
}: {
  groupMode: GroupMode;
  baseThemes: ThemeData[];
  universeList: { symbol: string; sector: string | null; name?: string | null }[];
  industryBySymbol: Map<string, string | null>;
  loadPerfMap: () => Promise<PerfCache | null>;
  scanCompletedAt: Date | null;
  onOpen: (t: ThemeData) => void;
}) {
  const [tf, setTf] = useState<TrackerTf>(() => {
    try { const v = localStorage.getItem(TF_KEY) as TrackerTf | null; return v && TFS.some((t) => t.key === v) ? v : "open"; } catch { return "open"; }
  });
  const [showAll, setShowAll] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_KEY) !== "top"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(TF_KEY, tf); } catch { /* ignore */ } }, [tf]);
  useEffect(() => { try { localStorage.setItem(SHOW_KEY, showAll ? "all" : "top"); } catch { /* ignore */ } }, [showAll]);

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
  const [live, setLive] = useState<LiveOpen | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [, setTick] = useState(0); // re-render the clock line
  const inflight = useRef(false);

  const fetchOpen = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setLiveLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("Config missing");
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-themes?timeframe=Today`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json() as { error?: string; themes?: { tickers?: { symbol: string; pct_open?: number | null; skipped?: boolean }[] }[] };
      if (j.error) throw new Error(j.error);
      const map = new Map<string, number>();
      for (const t of j.themes ?? []) for (const tk of t.tickers ?? []) {
        if (!tk.skipped && typeof tk.pct_open === "number" && Number.isFinite(tk.pct_open)) map.set(tk.symbol.toUpperCase(), tk.pct_open);
      }
      setLive({ map, fetchedAt: Date.now() });
      setLiveError(map.size ? null : "no_open");
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tf !== "open") return;
    if (!live || Date.now() - live.fetchedAt > REFRESH_MS) fetchOpen();
    // Auto-refresh every 5 minutes during the session while the page is visible.
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      if (document.visibilityState === "visible" && marketClock().open) fetchOpen();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf, fetchOpen]);

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
    if (tf === "open") v = live?.map.get(sym);
    else if (tf === "YTD") v = stageBy.get(sym)?.features?.ytdPct;
    else {
      const p = perf?.tickers[sym];
      v = !p ? null : tf === "1D" ? p.perf_1d : tf === "1W" ? p.perf_1w : tf === "1M" ? p.perf_1m : p.perf_3m;
    }
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }, [tf, live, stageBy, perf]);

  const rows = useMemo(() => {
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

  const shown = useMemo(() => {
    if (showAll || rows.length <= 30) return rows;
    return [...rows.slice(0, 15), ...rows.slice(-15)];
  }, [rows, showAll]);
  const scale = niceMax(Math.max(0, ...shown.map((r) => Math.abs(r.performance_pct))));
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

  const emptyMsg =
    tf === "open"
      ? liveLoading ? "Fetching live quotes…"
        : liveError === "no_open" ? "No since-open prices came back yet (this needs the updated fetch-themes function — or try again in a minute)."
        : liveError ? `Couldn't fetch live quotes: ${liveError}` : "No live data yet."
      : tf === "YTD"
        ? stagesLoading ? "Loading…" : "No YTD data yet — run a Full Scan (it updates stages too) or Scan Stages."
        : perf ? "No stocks in these groups were in the last Full Scan." : "No Full Scan data yet — press Full Scan.";

  const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;

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

  if (tf === "trend") {
    return (
      <TrendView
        groups={groups} perf={perf} title={`${GROUP_MODE_LABEL[groupMode]} Tracker`} status={status}
        switcher={tfSwitch} onOpen={onOpen} universe={groupMode !== "theme"}
      />
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[15px] font-semibold" style={{ fontFamily: "Syne, sans-serif" }}>{GROUP_MODE_LABEL[groupMode]} Tracker</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
        {tf === "open" && (
          <button onClick={fetchOpen} disabled={liveLoading} title="Refresh live quotes" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            {liveLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {rows.length > 30 && (
            <button onClick={() => setShowAll(!showAll)} className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              {showAll ? `Top & bottom 15` : `Show all ${rows.length}`}
            </button>
          )}
          {tfSwitch}
        </div>
      </div>

      {!shown.length ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyMsg}</div>
      ) : (
        <>
          <div className="mb-0.5 grid grid-cols-[120px_1fr_60px] gap-2.5 px-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-[190px_1fr_64px_70px]">
            <span />
            <span className="flex justify-between"><span>−{scale}%</span><span>0</span><span>+{scale}%</span></span>
            <span />
            <span className="hidden sm:block" />
          </div>
          {shown.map((r, i) => {
            const v = r.performance_pct;
            const w = Math.min(50, (Math.abs(v) / scale) * 50);
            const valid = r.valid_count ?? r.up_count + r.down_count;
            return (
              <Fragment2 key={r.theme_name} gap={!showAll && rows.length > 30 && i === 15}>
                <button
                  onClick={() => onOpen(r)}
                  className="grid w-full grid-cols-[120px_1fr_60px] items-center gap-2.5 rounded-md px-1 py-[3px] text-left hover:bg-accent/40 sm:grid-cols-[190px_1fr_64px_70px]"
                  title={`${r.theme_name}: ${fmt(v)} average of ${valid} stock${valid === 1 ? "" : "s"}${r.na_count ? ` (${r.na_count} without data)` : ""} — click to open`}
                >
                  <span className="truncate text-xs font-medium">{r.theme_name}</span>
                  <span className="relative h-3 rounded-[3px] bg-muted/40">
                    <span className="absolute -bottom-[3px] -top-[3px] left-1/2 w-px bg-border" />
                    <span
                      className="absolute bottom-0 top-0 rounded-[3px]"
                      style={v >= 0
                        ? { left: "50%", width: `${w}%`, background: "hsl(166, 100%, 42%)" }
                        : { right: "50%", width: `${w}%`, background: "hsl(344, 100%, 65%)" }}
                    />
                  </span>
                  <span className={`text-right font-mono text-xs ${v > 0 ? "text-[hsl(166,100%,42%)]" : v < 0 ? "text-[hsl(344,100%,65%)]" : "text-muted-foreground"}`}>{fmt(v)}</span>
                  <span className="hidden text-right font-mono text-[10.5px] text-muted-foreground sm:block" title="Breadth: stocks up / stocks with data">{r.up_count}/{valid} ↑</span>
                </button>
              </Fragment2>
            );
          })}
        </>
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
        {" "}The right column is breadth: stocks up / stocks with data. Click a row to open its stocks.
      </div>
    </div>
  );
}

/** Row wrapper that draws a divider where the top and bottom halves meet. */
function Fragment2({ gap, children }: { gap: boolean; children: ReactNode }) {
  return (
    <>
      {gap && <div className="my-1 border-t border-dashed border-border text-center text-[10px] text-muted-foreground">⋯</div>}
      {children}
    </>
  );
}
