import { ordinal } from "@/lib/utils";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Layers, Loader2, RefreshCw, Info, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useStockStages } from "@/hooks/useStockStages";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry, GROUP_MODE_LABEL, type GroupMode } from "@/lib/groupColors";
import RegimePanel from "@/components/stages/RegimePanel";
import { BottomLine, HowItWorks, SectionHead, SectionNav, Segmented } from "@/components/Explainer";
import { leadershipForGroups } from "@/lib/leadership";
import TrackRecord from "@/components/stages/TrackRecord";
import LeadershipPanel from "@/components/stages/LeadershipPanel";
import RotationPanel from "@/components/stages/RotationPanel";
import NewHighsLowsPanel from "@/components/stages/NewHighsLowsPanel";
import StageStockTable, { StageBadge } from "@/components/stages/StageStockTable";
import {
  REGIME_TEXT, STAGE_COLORS, applyLive, loadMarketStages, loadStages, onStagesUpdated, type MarketMember, STAGE_NAMES, STAGE_TIPS, groupHealth, isStageScanRunning, regimeSeries, runStageScan, stageWeeksAgo,
  type StageNum, type StockStage,
} from "@/lib/stageAnalysis";

const MODES: GroupMode[] = ["sector", "industry", "subIndustry", "theme"];
const MODE_KEY = "stage_group_mode_v1";
const STAGES: StageNum[] = [1, 2, 3, 4];

type SortCol = "name" | "count" | 1 | 2 | 3 | 4 | "a2" | "d2";

interface GroupRow {
  name: string;
  count: number;
  n: Record<StageNum, number>;
  pct: Record<1 | 2 | 3 | 4, number>;
  s2Change4w: number | null; // change in Stage 2 share (pts) vs 4 weeks ago
  fresh2A: number;
  members: StockStage[];
}

/** Market-wide stage share for each of the last ≤104 weeks, from each stock's history string. */
function breadthSeries(rows: StockStage[]) {
  const len = Math.max(0, ...rows.map((r) => r.history?.length ?? 0));
  const out: Record<StageNum, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (let ago = len - 1; ago >= 0; ago--) {
    const n: Record<StageNum, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    let tot = 0;
    for (const r of rows) {
      const s = stageWeeksAgo(r, ago);
      if (s === null || s === 0) continue;
      n[s]++; tot++;
    }
    for (const k of STAGES) out[k].push(tot ? (n[k] / tot) * 100 : 0);
  }
  return out;
}

function MiniChart({ series }: { series: Record<StageNum, number[]> }) {
  const [hover, setHover] = useState<number | null>(null);
  const len = series[2].length;
  if (len < 2) return <div className="py-6 text-center text-xs text-muted-foreground">History appears after the first scan.</div>;
  const all = STAGES.flatMap((k) => series[k]);
  const max = Math.min(100, Math.ceil((Math.max(...all) + 5) / 10) * 10);
  const W = 1000, H = 120;
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${((i / (len - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 8) - 4).toFixed(1)}`).join(" ");
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[120px] w-full"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - rect.left) / rect.width) * (len - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="hsl(var(--border))" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.4} />)}
        {/* shade the gap between Stage 2 and Stage 4: blue while advancing stocks outnumber declining ones, pink otherwise */}
        {series[2].slice(1).map((_, k) => {
          const x0 = (k / (len - 1)) * W, x1 = ((k + 1) / (len - 1)) * W;
          const y = (v: number) => H - (v / max) * (H - 8) - 4;
          const net = series[2][k] + series[2][k + 1] - series[4][k] - series[4][k + 1];
          return <polygon key={k} points={`${x0},${y(series[2][k])} ${x1},${y(series[2][k + 1])} ${x1},${y(series[4][k + 1])} ${x0},${y(series[4][k])}`} fill={net >= 0 ? STAGE_COLORS[2] : STAGE_COLORS[4]} opacity={0.13} />;
        })}
        {([1, 3, 4, 2] as StageNum[]).map((k) => (
          <path key={k} d={path(series[k])} fill="none" stroke={STAGE_COLORS[k]} strokeWidth={k === 2 || k === 4 ? 2 : 1.2}
            opacity={k === 2 || k === 4 ? 1 : 0.6} vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && <line x1={(hover / (len - 1)) * W} x2={(hover / (len - 1)) * W} y1={0} y2={H} stroke="hsl(var(--muted-foreground))" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded border border-border bg-background/95 px-2 py-1 font-mono text-[10px]" style={{ left: `min(${(hover / (len - 1)) * 100}%, calc(100% - 150px))` }}>
          <div className="text-muted-foreground">{len - 1 - hover === 0 ? "last week" : `${len - 1 - hover}w ago`}</div>
          {STAGES.map((k) => <div key={k} style={{ color: STAGE_COLORS[k] }}>S{k} {series[k][hover].toFixed(0)}%</div>)}
          <div className="text-foreground">S2 − S4 {(series[2][hover] - series[4][hover]) >= 0 ? "+" : ""}{(series[2][hover] - series[4][hover]).toFixed(0)}</div>
        </div>
      )}
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{len}w ago</span><span>max {max}%</span><span>last completed week</span></div>
    </div>
  );
}

const TRANSITION_GROUPS: { key: string; label: string; color: StageNum; match: (r: StockStage) => boolean }[] = [
  { key: "breakout", label: "Breakouts → Stage 2", color: 2, match: (r) => r.event_kind === "BREAKOUT" && r.stage === 2 },
  { key: "resume", label: "Resumptions 3 → 2", color: 2, match: (r) => r.event_kind === "RESUMPTION" && r.stage === 2 },
  { key: "base", label: "New bases → Stage 1", color: 1, match: (r) => r.stage === 1 && !!r.event },
  { key: "top", label: "Topping → Stage 3", color: 3, match: (r) => r.stage === 3 && !!r.event },
  { key: "down", label: "Breakdowns → Stage 4", color: 4, match: (r) => r.stage === 4 && !!r.event },
];

const GROUP_PREVIEW = 15;

export default function StageAnalysis() {
  const { rows: listAll, loading, error, reload } = useStockStages(true);
  // Which stocks: your list, or the whole US market (~2,700 stocks ≥ $300M) for a market-wide picture.
  const [scope, setScope] = useState<"list" | "market">(() => {
    try { return localStorage.getItem("stages_scope_v1") === "market" ? "market" : "list"; } catch { return "list"; }
  });
  // Completed weeks (official) or this week so far (provisional, Mon–Fri only).
  const [weekView, setWeekView] = useState<"completed" | "live">("completed");
  useEffect(() => { try { localStorage.setItem("stages_scope_v1", scope); } catch { /* ignore */ } }, [scope]);
  const [marketData, setMarketData] = useState<{ rows: StockStage[]; members: MarketMember[] } | null>(null);
  const [marketErr, setMarketErr] = useState<string | null>(null);
  useEffect(() => {
    if (scope !== "market") return;
    const load = () => loadMarketStages().then((d) => { setMarketData(d); setMarketErr(null); }).catch((e) => setMarketErr(e instanceof Error ? e.message : String(e)));
    load();
    return onStagesUpdated(load);
  }, [scope]);
  const baseRows = useMemo(() => {
    if (scope === "list") return listAll;
    const spy = listAll.find((r) => r.symbol === "SPY");
    const m = (marketData?.rows ?? []).filter((r) => r.symbol !== "SPY");
    return spy ? [...m, spy] : m;
  }, [scope, listAll, marketData]);
  const hasLive = useMemo(() => baseRows.some((r) => r.features?.live), [baseRows]);
  const liveDay = useMemo(() => baseRows.reduce<string | null>((m, r) => { const d = r.features?.live?.day; return d && (!m || d > m) ? d : m; }, null), [baseRows]);
  const showLive = weekView === "live" && hasLive;
  const rows = useMemo(() => (showLive ? applyLive(baseRows) : baseRows), [showLive, baseRows]);
  const lastScan = useMemo(() => listAll.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null), [listAll]);
  const { rows: uni, extra, load: loadUni, loaded: uniLoaded } = useUniverseSectors();
  const [mode, setMode] = useState<GroupMode>(() => {
    try { return (localStorage.getItem(MODE_KEY) as GroupMode) || "industry"; } catch { return "industry"; }
  });
  const [themeMap, setThemeMap] = useState<Map<string, string[]>>(new Map());
  const [sortCol, setSortCol] = useState<SortCol>(2);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(isStageScanRunning() ? { done: 0, total: 0 } : null);
  const [list, setList] = useState<{ title: string; rows: StockStage[]; stage?: StageNum } | null>(null);
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [minConf, setMinConf] = useState(0);
  const [search, setSearch] = useState("");
  const [transWindow, setTransWindow] = useState(1); // weeks
  const [minGroupSize, setMinGroupSize] = useState(5); // tiny groups give misleading 0% / 100% readings

  useEffect(() => { loadUni(); }, [loadUni]);
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ } }, [mode]);

  // Themes: symbol → theme names (a stock can be in several themes)
  useEffect(() => {
    if (mode !== "theme" || themeMap.size) return;
    (async () => {
      const { data: themes } = await supabase.from("themes").select("id, name");
      const { data: tt } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");
      const names = new Map((themes ?? []).map((t) => [t.id, t.name]));
      const m = new Map<string, string[]>();
      for (const r of tt ?? []) {
        const sym = r.ticker_symbol.toUpperCase();
        const n = names.get(r.theme_id);
        if (!n) continue;
        m.set(sym, [...(m.get(sym) ?? []), n]);
      }
      setThemeMap(m);
    })();
  }, [mode, themeMap.size]);

  const labelBySymbol = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of extra) m.set(r.symbol.toUpperCase(), r.sector);
    for (const r of uni) m.set(r.symbol.toUpperCase(), r.sector);
    // Market stocks outside your list: their label from the market list (GICS sub-industry).
    for (const r of marketData?.members ?? []) if (!m.get(r.symbol)) m.set(r.symbol, r.gics_sub);
    return m;
  }, [uni, extra, marketData]);

  const stocks = useMemo(() => rows.filter((r) => r.symbol !== "SPY"), [rows]);
  const market = useMemo(() => rows.find((r) => r.symbol === "SPY") ?? null, [rows]);
  const asOf = useMemo(() => rows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null), [rows]);
  // Histories line up week-by-week only for stocks classified up to the latest week
  // (a halted / stale stock would shift the chart), so the chart and 4-week changes use these.
  const aligned = useMemo(() => stocks.filter((r) => r.as_of === asOf), [stocks, asOf]);

  // RS rank 1–99 from the stage scan's own relative performance vs SPY (Mansfield-style, 52w).
  const rsRank = useMemo(() => {
    const vals = stocks.map((r) => ({ s: r.symbol, v: r.features?.mrs52 ?? null })).filter((x) => x.v !== null) as { s: string; v: number }[];
    vals.sort((a, b) => a.v - b.v);
    const m = new Map<string, number>();
    vals.forEach((x, i) => m.set(x.s, Math.max(1, Math.min(99, Math.round(((i + 1) / vals.length) * 99)))));
    return m;
  }, [stocks]);
  const rsOf = (sym: string) => rsRank.get(sym) ?? null;
  const nameBySymbol = useMemo(() => {
    const m = new Map<string, string | null>((marketData?.members ?? []).map((r) => [r.symbol, r.name]));
    for (const r of uni) m.set(r.symbol.toUpperCase(), r.name ?? null);
    return m;
  }, [uni, marketData]);
  const nameOf = (sym: string) => nameBySymbol.get(sym) ?? null;

  const groupsOf = useCallback((sym: string): string[] => {
    if (mode === "theme") return themeMap.get(sym) ?? [];
    return [groupKeyForIndustry(labelBySymbol.get(sym) ?? null, mode)];
  }, [mode, themeMap, labelBySymbol]);
  const firstGroup = (sym: string) => groupsOf(sym)[0] ?? "—";

  const totals = useMemo(() => {
    const n: Record<StageNum, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of stocks) n[r.stage as StageNum]++;
    const classified = n[1] + n[2] + n[3] + n[4];
    return { n, classified };
  }, [stocks]);

  const series = useMemo(() => breadthSeries(aligned), [aligned]);
  const regimeRows = useMemo(() => (market ? [...aligned, market] : aligned), [aligned, market]);
  // This week's Stage 2 share vs its own history (percentile).
  const breadth = useMemo(() => {
    const s2 = series[2];
    if (s2.length < 12) return null;
    const now = s2[s2.length - 1];
    const below = s2.filter((v) => v < now).length;
    return { now, pct: Math.round((below / (s2.length - 1)) * 100), lo: Math.min(...s2), hi: Math.max(...s2), weeks: s2.length };
  }, [series]);

  const [showAllGroups, setShowAllGroups] = useState(false);

  const net = useMemo(() => {
    const a = series[2], b = series[4], L = a.length;
    if (L < 5) return null;
    return { now: a[L - 1] - b[L - 1], d4: (a[L - 1] - b[L - 1]) - (a[L - 5] - b[L - 5]) };
  }, [series]);

  const groups: GroupRow[] = useMemo(() => {
    if (mode !== "theme" && !uniLoaded) return []; // don't show everything as "Unknown" while labels load
    const m = new Map<string, StockStage[]>();
    for (const r of stocks) for (const g of groupsOf(r.symbol)) m.set(g, [...(m.get(g) ?? []), r]);
    const out: GroupRow[] = [];
    m.forEach((members, name) => {
      const n: Record<StageNum, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
      let prevS2 = 0, prevTot = 0;
      for (const r of members) {
        n[r.stage as StageNum]++;
        const p = r.as_of === asOf ? stageWeeksAgo(r, 4) : null;
        if (p !== null && p !== 0) { prevTot++; if (p === 2) prevS2++; }
      }
      const tot = n[1] + n[2] + n[3] + n[4];
      if (!tot || members.length < minGroupSize) return;
      const pct = { 1: (n[1] / tot) * 100, 2: (n[2] / tot) * 100, 3: (n[3] / tot) * 100, 4: (n[4] / tot) * 100 };
      out.push({
        name, count: members.length, n, pct,
        s2Change4w: prevTot >= 3 ? pct[2] - (prevS2 / prevTot) * 100 : null,
        fresh2A: members.filter((r) => r.substage === "2A").length,
        members,
      });
    });
    const last = (g: GroupRow) => (g.name === "Unknown" || g.name === "Other" ? 1 : 0);
    out.sort((a, b) => {
      const tie = last(a) - last(b);
      if (tie) return tie;
      switch (sortCol) {
        case "name": return a.name.localeCompare(b.name);
        case "count": return b.count - a.count;
        case "a2": return b.fresh2A - a.fresh2A;
        case "d2": return (b.s2Change4w ?? -999) - (a.s2Change4w ?? -999);
        default: return b.pct[sortCol] - a.pct[sortCol] || b.count - a.count;
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, mode, labelBySymbol, themeMap, sortCol, minGroupSize, asOf, uniLoaded]);

  // ★ Best candidates: early-stage strength (fresh 2A with acceptable quality, or late-base 1B)
  // with decent confidence, strong relative strength, in an industry where ≥35% of stocks are Stage 2
  // — the research's "stock + group + RS alignment".
  const bestCandidates = useMemo(() => {
    const ind = new Map<string, { s2: number; tot: number }>();
    for (const r of stocks) {
      if (r.stage === 0) continue;
      const g = groupKeyForIndustry(labelBySymbol.get(r.symbol) ?? null, "industry");
      const e = ind.get(g) ?? { s2: 0, tot: 0 };
      e.tot++; if (r.stage === 2) e.s2++;
      ind.set(g, e);
    }
    return stocks.filter((r) => {
      const early = (r.substage === "2A" && r.quality !== "LOW") || r.substage === "1B";
      if (!early || r.confidence < 70 || (rsRank.get(r.symbol) ?? 0) < 70) return false;
      const g = ind.get(groupKeyForIndustry(labelBySymbol.get(r.symbol) ?? null, "industry"));
      return !!g && g.tot >= 3 && g.s2 / g.tot >= 0.35;
    }).sort((a, b) => (rsRank.get(b.symbol) ?? 0) - (rsRank.get(a.symbol) ?? 0));
  }, [stocks, labelBySymbol, rsRank]);

  // Stage 1 bases within 5% of their range high — the breakout watchlist (research §8: 1→2).
  const nearBreakout = useMemo(
    () => stocks.filter((r) => r.stage === 1 && r.features?.pctToRangeHigh != null && r.features.pctToRangeHigh >= 0 && r.features.pctToRangeHigh <= 5)
      .sort((a, b) => (a.features!.pctToRangeHigh ?? 0) - (b.features!.pctToRangeHigh ?? 0)),
    [stocks],
  );

  const transitions = useMemo(
    () => TRANSITION_GROUPS.map((g) => ({
      ...g,
      rows: stocks.filter((r) => r.event_weeks_ago !== null && r.event_weeks_ago < transWindow && g.match(r))
        .sort((a, b) => b.confidence - a.confidence),
    })),
    [stocks, transWindow],
  );

  // ----- Bottom line: breadth regime, Stage 2 share, leading groups, watchlist -----
  const regimeNow = useMemo(() => { const s = regimeSeries(regimeRows); return s[s.length - 1] ?? null; }, [regimeRows]);
  const leaders = useMemo(
    () => leadershipForGroups(groups, market, asOf, Math.max(5, minGroupSize)).filter((g) => g.state === "emerging" || g.state === "confirmed" || g.state === "mature"),
    [groups, market, asOf, minGroupSize],
  );

  const startScan = async () => {
    setScan({ done: 0, total: 0 });
    try {
      const before = listAll.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
      const r = await runStageScan((done, total) => setScan({ done, total }));
      const fresh = await loadStages(true);
      await reload(false);
      const after = fresh.reduce<{ asOf: string | null; live: string | null }>((m, x) => ({
        asOf: !m.asOf || x.as_of > m.asOf ? x.as_of : m.asOf,
        live: x.features?.live?.day && (!m.live || x.features.live.day > m.live) ? x.features.live.day : m.live,
      }), { asOf: null, live: null });
      const fmt = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const what = after.asOf && after.asOf !== before
        ? `New week: ending ${fmt(after.asOf)}.`
        : after.live
          ? `The week isn't over, so the official stages stay on the week ending ${after.asOf ? fmt(after.asOf) : "—"}. "This week so far" now shows the market through ${fmt(after.live)}.`
          : `Week ending ${after.asOf ? fmt(after.asOf) : "—"} is complete and up to date — the next change comes after Friday's close.`;
      toast.success(`Stages scanned · ${r.processed.toLocaleString("en-US")} stocks${r.market ? ` + ${r.market.toLocaleString("en-US")} market` : ""}`, { description: `${what}${r.failed ? ` ${r.failed} unavailable.` : ""}`, duration: 9000 });
      if (after.live && after.asOf === before) setWeekView("live");
    } catch (e) {
      toast.error("Stage scan failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setScan(null);
    }
  };

  const openList = (title: string, rs: StockStage[]) => { setSubFilter(null); setMinConf(0); setSearch(""); setList({ title, rows: rs }); };

  const openStage = (s: StageNum) => {
    setSubFilter(null); setMinConf(0); setSearch("");
    setList({ title: STAGE_NAMES[s], rows: stocks.filter((r) => r.stage === s), stage: s });
  };

  const listRows = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toUpperCase();
    return list.rows.filter((r) =>
      (!subFilter || r.substage === subFilter) && r.confidence >= minConf &&
      (!q || r.symbol.includes(q) || firstGroup(r.symbol).toUpperCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, subFilter, minConf, search, mode, labelBySymbol, themeMap]);

  const subOptions = useMemo(() => {
    if (!list) return [];
    const c = new Map<string, number>();
    for (const r of list.rows) c.set(r.substage, (c.get(r.substage) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  const pctOf = (k: StageNum) => (totals.classified ? (totals.n[k] / totals.classified) * 100 : 0);
  const healthTone = { strong: "text-[hsl(222,82%,68%)]", healthy: "text-[hsl(222,70%,78%)]", neutral: "text-muted-foreground", weak: "text-[hsl(329,70%,64%)]" };
  const colHead = (col: SortCol, label: string, tip?: string) => (
    <th onClick={() => setSortCol(col)} className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-right text-[11px] font-medium ${sortCol === col ? "text-[hsl(222,82%,68%)]" : "text-muted-foreground"}`} title={tip}>
      {label}{sortCol === col ? " ▾" : ""}
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowLeft size={14} />
          </Link>
          <Layers size={16} className="text-[hsl(222,82%,64%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Stage Analysis</h1>
          <Tooltip>
            <TooltipTrigger asChild><Info size={13} className="text-muted-foreground" /></TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs leading-relaxed">
              Stan Weinstein's stages on completed weekly bars and the 30-week SMA. Stage 1 vs 3 is decided by the prior trend,
              a stage only changes after two weekly confirmations (or a clean range break), and volume / relative strength
              change confidence — not the stage. Breakdowns don't need volume; breakouts should have it.
            </TooltipContent>
          </Tooltip>
          <div className="ml-auto flex items-center gap-3">
            <Segmented<"list" | "market"> size="xs" value={scope} onChange={setScope} options={[
              { value: "list", label: "Your list", title: "Your RS list and theme stocks" },
              { value: "market", label: "Whole market", title: "Every US company listed on NYSE / Nasdaq with a market cap of $300M or more (~2,700 stocks), plus the S&P 1500 — for an honest picture of market breadth" },
            ]} />
            {hasLive && (
              <Segmented<"completed" | "live"> size="xs" value={weekView} onChange={setWeekView} options={[
                { value: "completed", label: "Completed week", title: "Official stages, decided on finished weeks only" },
                { value: "live", label: "This week so far", title: "Provisional: the unfinished week treated as if it closed at the last price. Can still change before Friday's close." },
              ]} />
            )}
            {asOf && (
              <span className="font-mono text-[11px] text-muted-foreground" title={lastScan ? `Last scan ${new Date(lastScan).toLocaleString()}` : undefined}>
                {showLive
                  ? <>this week through {new Date((liveDay ?? asOf) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} <span className="text-amber-400">· provisional</span></>
                  : <>week ending {new Date(asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>}
                {" · "}{stocks.length.toLocaleString("en-US")} stocks
                {lastScan && <> · scanned {new Date(lastScan).toLocaleDateString("en-US", { weekday: "short" })} {new Date(lastScan).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</>}
              </span>
            )}
            <button
              onClick={startScan}
              disabled={!!scan}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
              title="Also runs automatically at the end of every Full Scan"
            >
              {scan ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {scan ? (scan.total ? `Scanning ${scan.done}/${scan.total}` : "Scanning…") : "Scan Stages"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        {scope === "market" && (marketErr || (marketData && marketData.rows.length === 0)) && (
          <div className="rounded-lg border border-border bg-card p-4 text-center text-xs text-muted-foreground">
            {marketErr && /does not exist|schema cache/i.test(marketErr)
              ? "Market breadth isn't set up on the server yet."
              : <>No market stages yet — press <b>Scan Stages</b> once (the first market scan takes a few extra minutes).</>}
          </div>
        )}
        {showLive && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
            Provisional view: this week isn't finished, so each stock's stage is computed as if the week closed at its last price.
            It can change until Friday's close; the official stages (Completed week) never use an unfinished week.
          </div>
        )}
        {error && !rows.length && (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {error.includes("set up") || error.includes("does not exist") || error.includes("schema cache")
              ? "Stage Analysis isn't set up on the server yet."
              : `Couldn't load stages: ${error}`}
          </div>
        )}
        {!error && !loading && !rows.length && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm">No stage data yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Press <b>Scan Stages</b> (≈1–2 min for the whole list) — or run a Full Scan, which updates stages too.</p>
          </div>
        )}

        {stocks.length > 0 && (
          <>
            {regimeNow && (
              <BottomLine
                tone={regimeNow.color === "green" ? "good" : regimeNow.color === "red" ? "bad" : "warn"}
                title={<>Breadth is <span className={regimeNow.color === "green" ? "text-gain-medium" : regimeNow.color === "red" ? "text-loss-medium" : "text-[hsl(40,90%,60%)]"}>{REGIME_TEXT[regimeNow.color].label.toLowerCase()}</span> — {REGIME_TEXT[regimeNow.color].short.replace(/^.*? — /, "")}</>}
                lines={[
                  breadth ? <>{breadth.now.toFixed(0)}% of {scope === "market" ? "US stocks" : "your stocks"} are in Stage 2 ({ordinal(breadth.pct)} percentile of the last {breadth.weeks} weeks{breadth.pct <= 10 ? " — a washout; leaders often rebound hardest from here" : breadth.pct >= 90 ? " — crowded" : ""}).</> : null,
                  leaders.length
                    ? <>Leading {GROUP_MODE_LABEL[mode].toLowerCase()} groups: {leaders.slice(0, 4).map((g) => g.name).join(", ")}{leaders.length > 4 ? ` +${leaders.length - 4} more` : ""}. Look for setups here first.</>
                    : <>No {GROUP_MODE_LABEL[mode].toLowerCase()} group is clearly leading SPY right now.</>,
                  bestCandidates.length
                    ? <>{bestCandidates.length} best candidates (fresh Stage 2 breakouts or late bases with strong RS in a healthy group): {bestCandidates.slice(0, 5).map((r) => r.symbol).join(", ")}.</>
                    : <>No stock meets the best-candidate rules this week.</>,
                ]}
              />
            )}

            <SectionNav items={[
              { id: "sa-breadth", label: "Breadth" },
              { id: "sa-overview", label: "Stages" },
              { id: "sa-changes", label: "Stage changes" },
              { id: "sa-leadership", label: "Leadership" },
              { id: "sa-rotation", label: "Rotation & new highs" },
              { id: "sa-groups", label: "By group" },
            ]} />

            <div id="sa-breadth" className="scroll-mt-12"><RegimePanel rows={regimeRows} scopeLabel={scope === "market" ? "the whole market" : "your list"} /></div>

            {/* Market overview */}
            <section id="sa-overview" className="scroll-mt-12 rounded-lg border border-border bg-card p-4">
              <SectionHead
                title={scope === "market" ? "Stages across the whole market" : "Stages across your list"}
                sub="Where every stock sits in Weinstein's four stages this week. Click a stage to see its stocks."
                right={market && <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">SPY <StageBadge r={market} /></span>}
              />
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {STAGES.map((k) => <div key={k} style={{ width: `${pctOf(k)}%`, background: STAGE_COLORS[k] }} />)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {STAGES.map((k) => (
                  <Tooltip key={k}>
                    <TooltipTrigger asChild>
                      <button onClick={() => openStage(k)} className="rounded-md border border-transparent px-2 py-1.5 text-center transition hover:border-border hover:bg-accent/40">
                        <div className="flex items-center justify-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[k] }} />S{k}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{totals.n[k].toLocaleString("en-US")} · {pctOf(k).toFixed(0)}%</div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">{STAGE_TIPS[k]}</TooltipContent>
                  </Tooltip>
                ))}
                <button onClick={() => openStage(0)} className="rounded-md border border-transparent px-2 py-1.5 text-center transition hover:border-border hover:bg-accent/40" title={STAGE_TIPS[0]}>
                  <div className="text-xs text-muted-foreground">In transition</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{totals.n[0].toLocaleString("en-US")}</div>
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-[10px] text-muted-foreground">
                {breadth && (
                  <span className="mr-auto" title="Where this week's Stage 2 share sits within the chart's history. Very low readings (washouts) have tended to come before the strongest rebounds in leaders; very high readings mean a crowded, extended market — context, not a timing signal.">
                    Stage 2 share <b className="text-foreground">{breadth.now.toFixed(0)}%</b> · {ordinal(breadth.pct)} percentile of the last {breadth.weeks} weeks (range {breadth.lo.toFixed(0)}–{breadth.hi.toFixed(0)}%)
                    {breadth.pct <= 10 ? " · washout zone" : breadth.pct >= 90 ? " · crowded zone" : ""}
                  </span>
                )}
                {net && (
                  <span title="Share of stocks in Stage 2 minus the share in Stage 4 — positive while advancing stocks outnumber declining ones (the shaded gap on the chart)">
                    S2 − S4 <b className={net.now >= 0 ? "text-[hsl(222,82%,70%)]" : "text-[hsl(329,70%,66%)]"}>{net.now >= 0 ? "+" : ""}{net.now.toFixed(0)} pts</b>
                    {" "}<span className={net.d4 >= 0 ? "text-gain-medium" : "text-loss-medium"}>({net.d4 >= 0 ? "▲" : "▼"}{Math.abs(net.d4).toFixed(0)} in 4w)</span>
                  </span>
                )}
                {STAGES.map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLORS[k] }} />S{k}</span>)}
                <span>· % of classified stocks, weekly</span>
              </div>
              <MiniChart series={series} />
            </section>

            {/* Transitions */}
            <section id="sa-changes" className="scroll-mt-12 rounded-lg border border-border bg-card p-4">
              <SectionHead
                title="Stage changes"
                sub="Stocks that moved between stages recently. Fresh breakouts into Stage 2 are the best long candidates; click a chip for the list."
                right={<Segmented<number> size="xs" value={transWindow} onChange={setTransWindow} options={[1, 2, 4].map((w) => ({ value: w, label: w === 1 ? "last week" : `last ${w} weeks` }))} />}
              />
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      disabled={!bestCandidates.length}
                      onClick={() => { setSubFilter(null); setMinConf(0); setSearch(""); setList({ title: "★ Best candidates", rows: bestCandidates }); }}
                      className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-left text-[11px] text-primary hover:bg-primary/20 disabled:opacity-40"
                    >
                      ★ Best candidates <span className="font-mono font-semibold">{bestCandidates.length}</span>
                      {bestCandidates.slice(0, 3).map((r) => <span key={r.symbol} className="font-mono opacity-80">{r.symbol}</span>)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Fresh Stage 2A breakouts (not weak-volume) or late-base 1B, confidence ≥ 70, RS rank ≥ 70 vs SPY,
                    in an industry with ≥ 35% of its stocks in Stage 2. A watchlist — not a buy signal; always check the chart.
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      disabled={!nearBreakout.length}
                      onClick={() => { setSubFilter(null); setMinConf(0); setSearch(""); setList({ title: "Near breakout (Stage 1 within 5% of range high)", rows: nearBreakout }); }}
                      className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-[11px] hover:bg-accent/40 disabled:opacity-40"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[1] }} />
                      Near breakout <span className="font-mono font-semibold">{nearBreakout.length}</span>
                      {nearBreakout.slice(0, 3).map((r) => <span key={r.symbol} className="font-mono text-muted-foreground">{r.symbol}</span>)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Stage 1 bases trading within 5% of their range high — the level a 1→2 breakout must clear. Best with volume ≥ 2× on the breakout week.
                  </TooltipContent>
                </Tooltip>
                {transitions.map((t) => (
                  <button
                    key={t.key}
                    disabled={!t.rows.length}
                    onClick={() => { setSubFilter(null); setMinConf(0); setSearch(""); setList({ title: t.label, rows: t.rows }); }}
                    className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-[11px] hover:bg-accent/40 disabled:opacity-40"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[t.color] }} />
                    <span>{t.label}</span>
                    <span className="font-mono font-semibold">{t.rows.length}</span>
                    {t.rows.slice(0, 3).map((r) => (
                      <span key={r.symbol} className="font-mono text-muted-foreground">
                        {r.symbol}{r.quality === "LOW" ? "⚠" : ""}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            </section>

            <div id="sa-leadership" className="scroll-mt-12"><LeadershipPanel groups={groups} spy={market} asOf={asOf} modeLabel={GROUP_MODE_LABEL[mode]} minMembers={minGroupSize} /></div>

            <div id="sa-rotation" className="grid scroll-mt-12 gap-4 lg:grid-cols-2">
              <RotationPanel groups={groups} asOf={asOf} modeLabel={GROUP_MODE_LABEL[mode]} minMembers={minGroupSize} onOpen={(name, rs) => openList(`${name} — stocks by stage`, rs)} />
              <NewHighsLowsPanel stocks={aligned} groupsOf={groupsOf} modeLabel={GROUP_MODE_LABEL[mode]} onOpen={openList} />
            </div>

            {/* Groups */}
            <section id="sa-groups" className="scroll-mt-12 overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 pb-1 pt-4">
                <SectionHead
                  title="By group"
                  sub={mode !== "theme" && !uniLoaded ? "Loading industries…" : `${groups.length} groups ranked by their share of stocks in Stage 2. Click a row for its stocks.`}
                  right={<>
                    <Segmented value={mode} onChange={(m) => { setMode(m); setExpanded(null); setShowAllGroups(false); }} options={MODES.map((m) => ({ value: m, label: GROUP_MODE_LABEL[m] }))} />
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Groups with very few stocks swing between 0% and 100% — hide them for a fair ranking">
                      Min stocks
                      <select value={minGroupSize} onChange={(e) => setMinGroupSize(Number(e.target.value))} className="h-7 rounded border border-border bg-background px-1 text-[11px]">
                        {[1, 3, 5, 10, 20].map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </label>
                  </>}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="bg-muted/20">
                    <tr className="border-b border-border">
                      <th onClick={() => setSortCol("name")} className="cursor-pointer px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Group</th>
                      <th className="hidden px-2 py-2 text-left text-[11px] font-medium text-muted-foreground md:table-cell">Distribution</th>
                      {colHead(1, "S1")}{colHead(2, "S2")}{colHead(3, "S3")}{colHead(4, "S4")}
                      {colHead("a2", "2A", "Fresh Stage 2 breakouts (last 13 weeks) in the group")}
                      {colHead("d2", "Stage mix", "From the share of the group's stocks in each stage right now — Strong: S2 ≥ 50% · Healthy: S2 ≥ 35% · Weak: S4 ≥ 50%. Arrow = change in the S2 share vs 4 weeks ago. (Group leadership above measures returns vs SPY instead, so the two can differ.)")}
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllGroups ? groups : groups.slice(0, GROUP_PREVIEW)).map((g) => {
                      const h = groupHealth(g.pct[2], g.pct[4]);
                      const open = expanded === g.name;
                      return (
                        <Fragment key={g.name}>
                          <tr onClick={() => setExpanded(open ? null : g.name)} className="cursor-pointer border-b border-border/40 hover:bg-accent/30">
                            <td className="max-w-[260px] px-3 py-2 text-xs font-medium">
                              <span className="inline-flex items-center gap-1">
                                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} className="text-muted-foreground" />}
                                <span className="truncate">{g.name}</span>
                                <span className="font-normal text-muted-foreground">({g.count})</span>
                              </span>
                            </td>
                            <td className="hidden px-2 py-2 md:table-cell">
                              <div className="flex h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                                {STAGES.map((k) => <div key={k} style={{ width: `${g.pct[k as 1]}%`, background: STAGE_COLORS[k] }} />)}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{g.pct[1].toFixed(0)}%</td>
                            <td className="px-2 py-2 text-right font-mono text-xs" style={{ color: STAGE_COLORS[2] }}>{g.pct[2].toFixed(0)}%</td>
                            <td className="px-2 py-2 text-right font-mono text-xs" style={g.pct[3] >= 30 ? { color: STAGE_COLORS[3] } : undefined}>{g.pct[3].toFixed(0)}%</td>
                            <td className="px-2 py-2 text-right font-mono text-xs" style={g.pct[4] >= 40 ? { color: STAGE_COLORS[4] } : undefined}>{g.pct[4].toFixed(0)}%</td>
                            <td className="px-2 py-2 text-right font-mono text-xs">{g.fresh2A || <span className="text-muted-foreground">·</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right text-[11px]">
                              <span className={healthTone[h.tone]}>{h.label}</span>
                              {g.s2Change4w !== null && Math.abs(g.s2Change4w) >= 1 && (
                                <span className={`ml-1 font-mono text-[10px] ${g.s2Change4w > 0 ? "text-gain-medium" : "text-loss-strong"}`}>
                                  {g.s2Change4w > 0 ? "▲" : "▼"}{Math.abs(g.s2Change4w).toFixed(0)}
                                </span>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-b border-border/40 bg-background/40">
                              <td colSpan={8} className="px-4 py-3">
                                <StageStockTable rows={g.members} exportName={`Stages_${g.name}`} rsOf={rsOf} nameOf={nameOf} maxHeight={360} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {groups.length > GROUP_PREVIEW && (
                <button onClick={() => setShowAllGroups((v) => !v)} className="w-full border-t border-border px-4 py-2 text-left text-[11.5px] text-primary hover:bg-accent/30">
                  {showAllGroups ? `Show the top ${GROUP_PREVIEW} only` : `Show all ${groups.length} groups`}
                </button>
              )}
            </section>

            <HowItWorks title="How to read this page & how stages tested">
              <p>
                <b className="text-foreground/80">Stages</b> (Stan Weinstein): 1 = basing after a decline, 2 = advancing above a rising 30-week line, 3 = topping, 4 = declining.
                2A is a fresh Stage 2 breakout. A stage only changes after two weekly confirmations or a clean range break.
              </p>
              <p>
                <b className="text-foreground/80">Reading it:</b> leadership shows up as a rising share of a group's stocks in Stage 2 and new 2A breakouts together;
                a group whose Stage 2 share keeps shrinking while Stage 3 grows is rolling over. Best long candidates: fresh Stage 2A breakouts in a
                strong or improving group — and avoid buying Stage 4 (or a 4B− bounce) just because it looks cheap.
              </p>
              <p>
                <b className="text-foreground/80">Backtest (your list, May 2023 – Jul 2026, 13 weeks ahead vs SPY, median):</b> Stage 2 −0.7%,
                Stage 3 −1.5%, Stage 1 −2.5%, Stage 4 −3.4%; 2A was the best substage (+0.1%) and 4B− the worst (−5.3%). Stage 2 beat Stage 4
                in every year. Today's list only, so all numbers flatter the past (survivorship) — the ordering is what matters.
                An independent survivorship-free test (S&amp;P 500 members 1992–2026, SSRN 2026) agrees on the core: Stage 2 (rising 30-week MA)
                carried a small, significant edge, while telling Stage 1 bases from Stage 3 tops added none — and breadth matters most.
              </p>
            </HowItWorks>
            <TrackRecord mode="stages" />
          </>
        )}
      </main>

      {/* Stage / transition list */}
      <Dialog open={!!list} onOpenChange={(o) => !o && setList(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              {list?.stage !== undefined && <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLORS[list.stage] }} />}
              {list?.title}
            </DialogTitle>
          </DialogHeader>
          {list?.stage !== undefined && <p className="-mt-2 text-[11px] text-muted-foreground">{STAGE_TIPS[list.stage]}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {subOptions.length > 1 && (
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setSubFilter(null)} className={`rounded border px-2 py-0.5 text-[10px] ${!subFilter ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>All</button>
                {subOptions.map(([s, c]) => (
                  <button key={s} onClick={() => setSubFilter(subFilter === s ? null : s)} className={`rounded border px-2 py-0.5 font-mono text-[10px] ${subFilter === s ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                    {s.replace("-", "−")} <span className="opacity-70">{c}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Min confidence <span className="w-6 font-mono text-foreground">{minConf}</span>
              <Slider value={[minConf]} min={0} max={95} step={5} onValueChange={(v) => setMinConf(v[0])} className="w-28" />
            </div>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Ticker or ${GROUP_MODE_LABEL[mode].toLowerCase()}…`}
              className="h-7 w-44 rounded border border-border bg-background px-2 text-xs"
            />
          </div>
          <StageStockTable rows={listRows} exportName={(list?.title ?? "Stages").replace("★", "Best")} groupOf={firstGroup} rsOf={rsOf} nameOf={nameOf} maxHeight={480} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
