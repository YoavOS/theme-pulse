import { ordinal } from "@/lib/utils";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Layers, Loader2, RefreshCw, Info, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStockStages } from "@/hooks/useStockStages";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry, GROUP_MODE_LABEL, type GroupMode } from "@/lib/groupColors";
import RegimePanel from "@/components/stages/RegimePanel";
import MomentumGauge from "@/components/stages/MomentumGauge";
import { VERDICT_TEXT, type Verdict } from "@/lib/momentumGauge";
import { BottomLine, HowItWorks, SectionHead, SectionNav, Segmented } from "@/components/Explainer";
import { LEAD_INFO, leadershipForGroups } from "@/lib/leadership";
import TrackRecord from "@/components/stages/TrackRecord";
import RotationPanel from "@/components/stages/RotationPanel";
import StageStockTable, { StageBadge } from "@/components/stages/StageStockTable";
import StageOverview from "@/components/stages/StageOverview";
import StageExportBar from "@/components/stages/StageExportBar";
import { tint } from "@/lib/colorTint";
import {
  REGIME_TEXT, STAGE_COLORS, applyLive, loadMarketStages, loadStages, onStagesUpdated, type MarketMember, STAGE_NAMES, STAGE_TIPS, SUBSTAGE_TIPS, groupHealth, isStageScanRunning, regimeSeries, runStageScan, stageWeeksAgo,
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
  // Momentum gauge verdict (market overall, and today after the live checks).
  const [gauge, setGauge] = useState<{ verdict: Verdict; today: Verdict } | null>(null);
  const onGauge = useCallback((verdict: Verdict, today: Verdict) => setGauge({ verdict, today }), []);
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
  const [stageFilter, setStageFilter] = useState<StageNum | null>(null);
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

  // Every card on the page counts the same rows: stocks on the latest week (stale rows from a failed
  // fetch would otherwise make one card show two different Stage 2 shares).
  const stale = stocks.length - aligned.length;
  const totals = useMemo(() => {
    const n: Record<StageNum, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of aligned) n[r.stage as StageNum]++;
    const classified = n[1] + n[2] + n[3] + n[4];
    return { n, classified };
  }, [aligned]);

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
    for (const r of aligned) for (const g of groupsOf(r.symbol)) m.set(g, [...(m.get(g) ?? []), r]);
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
  }, [aligned, mode, labelBySymbol, themeMap, sortCol, minGroupSize, asOf, uniLoaded]);

  // Candidates: fresh 2A breakouts (acceptable quality) with decent confidence and strong relative
  // strength, in an industry where ≥ 35% of the OTHER stocks are Stage 2 (the stock doesn't vote for
  // itself) and at least 5 stocks are classified. Not validated yet — the track record will show.
  // (Late-base 1B was dropped: the backtest found no edge in telling Stage 1 bases from Stage 3 tops.)
  const bestCandidates = useMemo(() => {
    const ind = new Map<string, { s2: number; tot: number }>();
    for (const r of aligned) {
      if (r.stage === 0) continue;
      const g = groupKeyForIndustry(labelBySymbol.get(r.symbol) ?? null, "industry");
      const e = ind.get(g) ?? { s2: 0, tot: 0 };
      e.tot++; if (r.stage === 2) e.s2++;
      ind.set(g, e);
    }
    return aligned.filter((r) => {
      const early = r.substage === "2A" && r.quality !== "LOW";
      if (!early || r.confidence < 70 || (rsRank.get(r.symbol) ?? 0) < 70) return false;
      const g = ind.get(groupKeyForIndustry(labelBySymbol.get(r.symbol) ?? null, "industry"));
      if (!g) return false;
      const others = g.tot - 1, otherS2 = g.s2 - (r.stage === 2 ? 1 : 0);
      return others >= 4 && otherS2 / others >= 0.35;
    }).sort((a, b) => (rsRank.get(b.symbol) ?? 0) - (rsRank.get(a.symbol) ?? 0));
  }, [aligned, labelBySymbol, rsRank]);

  // Stage 1 bases within 5% of their range high — the breakout watchlist (research §8: 1→2).
  const nearBreakout = useMemo(
    () => aligned.filter((r) => r.stage === 1 && r.features?.pctToRangeHigh != null && r.features.pctToRangeHigh >= 0 && r.features.pctToRangeHigh <= 5)
      .sort((a, b) => (a.features!.pctToRangeHigh ?? 0) - (b.features!.pctToRangeHigh ?? 0)),
    [aligned],
  );

  const transitions = useMemo(
    () => TRANSITION_GROUPS.map((g) => ({
      ...g,
      rows: aligned.filter((r) => r.event_weeks_ago !== null && r.event_weeks_ago < transWindow && g.match(r))
        .sort((a, b) => b.confidence - a.confidence),
    })),
    [aligned, transWindow],
  );

  // ----- Bottom line: breadth regime, Stage 2 share, leading groups, watchlist -----
  const regimeNow = useMemo(() => { const s = regimeSeries(regimeRows); return s[s.length - 1] ?? null; }, [regimeRows]);
  // Leadership needs each stock's weekly closes (features.wc); without them "no group leading" would be false.
  const leadershipData = useMemo(() => aligned.filter((r) => (r.features as { wc?: unknown } | null)?.wc).length >= 20 && !!market, [aligned, market]);
  // Group leadership vs SPY (returns, RS line, breadth) — shown as a tag on each row of the group table.
  const leadAll = useMemo(() => leadershipForGroups(groups, market, asOf, Math.max(5, minGroupSize)), [groups, market, asOf, minGroupSize]);
  const leadBy = useMemo(() => new Map(leadAll.map((g) => [g.name, g])), [leadAll]);
  const leaders = useMemo(() => leadAll.filter((g) => g.state === "emerging" || g.state === "confirmed" || g.state === "mature"), [leadAll]);

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

  const openList = (title: string, rs: StockStage[]) => { setSubFilter(null); setStageFilter(null); setMinConf(0); setSearch(""); setList({ title, rows: rs }); };

  const openStage = (s: StageNum) => {
    setSubFilter(null); setStageFilter(null); setMinConf(0); setSearch("");
    setList({ title: STAGE_NAMES[s], rows: stocks.filter((r) => r.stage === s), stage: s });
  };

  const listRows = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toUpperCase();
    return list.rows.filter((r) =>
      (stageFilter === null || r.stage === stageFilter) && (!subFilter || r.substage === subFilter) && r.confidence >= minConf &&
      (!q || r.symbol.includes(q) || firstGroup(r.symbol).toUpperCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, stageFilter, subFilter, minConf, search, mode, labelBySymbol, themeMap]);

  // Dialog filters: stage counts (tinted chips) and, for the chosen stage, its substages.
  const stageCounts = useMemo(() => {
    const n: Record<StageNum, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of list?.rows ?? []) n[r.stage as StageNum]++;
    return n;
  }, [list]);
  const subOptions = useMemo(() => {
    if (!list) return [];
    const c = new Map<string, number>();
    for (const r of list.rows) if (stageFilter === null || r.stage === stageFilter) c.set(r.substage, (c.get(r.substage) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list, stageFilter]);

  // Health pills (Deepvue colours: strong/healthy blue, neutral yellow, weak pink)
  const HEALTH_COLOR = { strong: "hsl(222, 82%, 66%)", healthy: "hsl(222, 82%, 66%)", neutral: "hsl(47, 75%, 52%)", weak: "hsl(329, 70%, 62%)" } as const;
  const colHead = (col: SortCol, label: string, tip?: string) => (
    <th onClick={() => setSortCol(col)} className={`cursor-pointer select-none whitespace-nowrap px-2 py-3 text-right text-[14px] font-semibold ${sortCol === col ? "text-[hsl(222,82%,68%)]" : "text-muted-foreground"}`} title={tip}>
      {label}{sortCol === col ? " ↓" : ""}
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
                {" · "}{aligned.length.toLocaleString("en-US")} stocks{stale > 0 ? ` (${stale} not updated this week, left out)` : ""}
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
            {/* Order: the market at a glance (stages) → where the strength is (groups) → is it a time to
                act (verdict) → which stocks just changed stage → supporting context → reference. */}
            <SectionNav items={[
              { id: "sa-overview", label: "Stages" },
              { id: "sa-groups", label: "By group" },
              { id: "sa-verdict", label: "Market verdict" },
              { id: "sa-changes", label: "Stage changes" },
              { id: "sa-breadth", label: "Breadth" },
              { id: "sa-rotation", label: "Rotation" },
            ]} />

            {/* Market overview — Deepvue layout */}
            <section id="sa-overview" className="scroll-mt-12 space-y-4 py-2">
              <SectionHead
                title={scope === "market" ? "Stages across the whole market" : "Stages across your list"}
                sub="Where every stock sits in Weinstein's four stages this week. Click a stage for its stocks; pick which lines the chart shows under it."
                right={market && <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">SPY <StageBadge r={market} /></span>}
              />
              <StageOverview
                n={totals.n} transition={totals.n[0]} series={series} onOpen={openStage} asOf={asOf}
                footer={<>
                  {breadth && (
                    <span title="Where this week's Stage 2 share sits within the chart's history. Very low readings (washouts) have tended to come before the strongest rebounds in leaders; very high readings mean a crowded, extended market — context, not a timing signal.">
                      Stage 2 share <b className="text-foreground">{breadth.now.toFixed(0)}%</b>{scope === "market" && <> · {ordinal(breadth.pct)} percentile of the last {breadth.weeks} weeks (range {breadth.lo.toFixed(0)}–{breadth.hi.toFixed(0)}%, rebuilt from today's members)</>}
                      {breadth.pct <= 10 ? " · washout zone" : breadth.pct >= 90 ? " · crowded zone" : ""}
                    </span>
                  )}
                  {net && (
                    <span title="Share of stocks in Stage 2 minus the share in Stage 4 — positive while advancing stocks outnumber declining ones">
                      S2 − S4 <b style={{ color: net.now >= 0 ? STAGE_COLORS[2] : STAGE_COLORS[4] }}>{net.now >= 0 ? "+" : ""}{net.now.toFixed(0)} pts</b>
                      {" "}<span className={net.d4 >= 0 ? "text-gain-medium" : "text-loss-medium"}>({net.d4 >= 0 ? "▲" : "▼"}{Math.abs(net.d4).toFixed(0)} in 4w)</span>
                    </span>
                  )}
                  <span>% of classified stocks, weekly</span>
                </>}
              />
              <StageExportBar rows={aligned} rsOf={rsOf} groupOf={firstGroup} groupLabel={GROUP_MODE_LABEL[mode]} scopeLabel={scope === "market" ? "the whole market" : "your list"} />
            </section>

            {/* Groups — Deepvue layout */}
            <section id="sa-groups" className="scroll-mt-12">
              <div className="pb-2">
                <SectionHead
                  title="By group"
                  sub={mode !== "theme" && !uniLoaded ? "Loading industries…" : `${groups.length} groups. Click a column to sort, a row for its stocks.`}
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
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th onClick={() => setSortCol("name")} className={`cursor-pointer select-none px-2 py-3 text-left text-[14px] font-semibold ${sortCol === "name" ? "text-[hsl(222,82%,68%)]" : "text-muted-foreground"}`}>Name{sortCol === "name" ? " ↓" : ""}</th>
                      <th className="hidden px-2 py-3 md:table-cell" aria-label="Distribution" />
                      {colHead(1, "S1")}{colHead(2, "S2")}{colHead(3, "S3")}{colHead(4, "S4")}
                      {colHead("a2", "2A", "Fresh Stage 2 breakouts (last 13 weeks) in the group")}
                      {colHead("d2", "Health", "From the share of the group's stocks in each stage right now — Strong: S2 ≥ 50% · Healthy: S2 ≥ 35% · Weak: S4 ≥ 50%. Arrow = change in the S2 share vs 4 weeks ago; click to sort by it. (The leadership tag next to a group's name measures returns vs SPY instead, so the two can differ.)")}
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllGroups ? groups : groups.slice(0, GROUP_PREVIEW)).map((g) => {
                      const h = groupHealth(g.pct[2], g.pct[4]);
                      const open = expanded === g.name;
                      return (
                        <Fragment key={g.name}>
                          <tr onClick={() => setExpanded(open ? null : g.name)} className="cursor-pointer hover:bg-accent/20">
                            <td className="max-w-[300px] px-2 py-3.5">
                              <span className="inline-flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
                                {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                                <span className="truncate">{g.name}</span>
                                <span className="text-[12px] font-normal text-muted-foreground">{g.count}</span>
                                {(() => {
                                  const L = leadBy.get(g.name);
                                  if (!L || L.state === "neutral" || L.state === "lagging") return null;
                                  const sg = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span onClick={(e) => e.stopPropagation()} className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${LEAD_INFO[L.state].cls}`}>{LEAD_INFO[L.state].label}</span>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs text-xs leading-relaxed">
                                        <b>{LEAD_INFO[L.state].label}</b> — {LEAD_INFO[L.state].tip}
                                        <div className="mt-1 font-mono text-[11px]">vs SPY: 4w {sg(L.rs4)} · 13w {sg(L.rs13)} · 26w {sg(L.rs26)}</div>
                                        <div className="font-mono text-[11px]">above 10w line {L.p50.toFixed(0)}% · above 40w {L.p200.toFixed(0)}%</div>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })()}
                              </span>
                            </td>
                            <td className="hidden px-2 py-3.5 md:table-cell">
                              <div className="flex h-2.5 w-[200px] overflow-hidden rounded-full bg-muted">
                                {STAGES.map((k) => <div key={k} style={{ width: `${g.pct[k as 1]}%`, background: STAGE_COLORS[k] }} />)}
                              </div>
                            </td>
                            {STAGES.map((k) => {
                              const v = g.pct[k as 1];
                              const hot = (k === 2 && (sortCol === 2 || v >= 30)) || (k === 4 && v >= 40) || (k === 3 && v >= 30);
                              return <td key={k} className="px-2 py-3.5 text-right text-[15px] tabular-nums" style={hot ? { color: STAGE_COLORS[k] } : undefined}>{v.toFixed(0)}%</td>;
                            })}
                            <td className="px-2 py-3.5 text-right text-[14px] tabular-nums">{g.fresh2A || <span className="text-muted-foreground">·</span>}</td>
                            <td className="whitespace-nowrap px-2 py-3.5 text-right">
                              <span className="inline-block rounded-md px-3 py-1 text-[14px] font-semibold" style={{ color: HEALTH_COLOR[h.tone], background: tint(HEALTH_COLOR[h.tone], 0.14) }}>{h.label}</span>
                              {g.s2Change4w !== null && Math.abs(g.s2Change4w) >= 1 && (
                                <span className={`ml-1.5 font-mono text-[11px] ${g.s2Change4w > 0 ? "text-gain-medium" : "text-loss-strong"}`} title="Change in the group's Stage 2 share vs 4 weeks ago (points)">
                                  {g.s2Change4w > 0 ? "▲" : "▼"}{Math.abs(g.s2Change4w).toFixed(0)}
                                </span>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-card/50">
                              <td colSpan={8} className="px-3 py-3">
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
                <button onClick={() => setShowAllGroups((v) => !v)} className="mt-1 w-full px-2 py-2 text-left text-[12px] text-primary hover:bg-accent/20">
                  {showAllGroups ? `Show the top ${GROUP_PREVIEW} only` : `Show all ${groups.length} groups`}
                </button>
              )}
            </section>

            <div id="sa-verdict" className="scroll-mt-12 space-y-4">
            {/* The verdict comes from the momentum gauge (trend, volatility, momentum's own results,
                stretch, daily breadth + today's checks), not from weekly breadth alone. */}
            <MomentumGauge rows={listAll} onVerdict={onGauge} />
            {regimeNow && (
              <BottomLine
                tone={gauge ? VERDICT_TEXT[gauge.today].tone : regimeNow.color === "green" ? "good" : regimeNow.color === "red" ? "bad" : "warn"}
                title={gauge
                  ? <>{VERDICT_TEXT[gauge.today].label}{gauge.today !== gauge.verdict ? " today" : ""} — {VERDICT_TEXT[gauge.today].text}</>
                  : <>Breadth is {REGIME_TEXT[regimeNow.color].label.toLowerCase()} — {REGIME_TEXT[regimeNow.color].short}</>}
                lines={[
                  <>Weekly breadth of {scope === "market" ? "the whole market" : "your list"}: {REGIME_TEXT[regimeNow.color].label.toLowerCase()}.</>,
                  breadth
                    ? scope === "market"
                      ? <>{breadth.now.toFixed(0)}% of US stocks are in Stage 2 ({ordinal(breadth.pct)} percentile of the last {breadth.weeks} weeks — history rebuilt from today's members, so earlier weeks look healthier than they were).</>
                      : <>{breadth.now.toFixed(0)}% of your stocks are in Stage 2. (Your list is picked by today's strength, so its own history isn't a fair yardstick — switch to Whole market for a percentile.)</>
                    : null,
                  leaders.length
                    ? <>Leading {GROUP_MODE_LABEL[mode].toLowerCase()} groups: {leaders.slice(0, 4).map((g) => g.name).join(", ")}{leaders.length > 4 ? ` +${leaders.length - 4} more` : ""}. Look for setups here first.</>
                    : leadershipData
                      ? <>No {GROUP_MODE_LABEL[mode].toLowerCase()} group is clearly leading SPY right now.</>
                      : <>Group leadership is unavailable for this view (no weekly price history yet — run Scan Stages).</>,
                  bestCandidates.length
                    ? <>{bestCandidates.length} candidates (fresh Stage 2 breakouts with strong RS in an industry where many others are in Stage 2 — not yet validated by the track record): {bestCandidates.slice(0, 5).map((r) => r.symbol).join(", ")}.</>
                    : <>No stock meets the best-candidate rules this week.</>,
                ]}
              />
            )}
            </div>

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
                      onClick={() => { setSubFilter(null); setMinConf(0); setSearch(""); setList({ title: "Candidates (not yet validated)", rows: bestCandidates }); }}
                      className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-left text-[11px] text-primary hover:bg-primary/20 disabled:opacity-40"
                    >
                      Candidates <span className="font-mono font-semibold">{bestCandidates.length}</span>
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
                    className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-[11px] hover:brightness-125 disabled:opacity-40"
                    style={t.rows.length ? { background: tint(STAGE_COLORS[t.color], 0.1), borderColor: tint(STAGE_COLORS[t.color], 0.45) } : undefined}
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


            <div id="sa-breadth" className="scroll-mt-12"><RegimePanel rows={regimeRows} scopeLabel={scope === "market" ? "the whole market" : "your list"} /></div>

            <div id="sa-rotation" className="scroll-mt-12">
              <RotationPanel groups={groups} asOf={asOf} modeLabel={GROUP_MODE_LABEL[mode]} minMembers={minGroupSize} onOpen={(name, rs) => openList(`${name} — stocks by stage`, rs)} />
            </div>

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
        <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              {list?.stage !== undefined && <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLORS[list.stage] }} />}
              {list?.title}
              <span className="text-[12px] font-normal text-muted-foreground">{list?.rows.length.toLocaleString("en-US")}</span>
            </DialogTitle>
            {list?.stage !== undefined && <p className="text-[11px] text-muted-foreground">{STAGE_TIPS[list.stage]}</p>}
          </DialogHeader>

          {/* Stage mix of this list — also the filter (Deepvue-style tinted chips) */}
          {list && list.stage === undefined && list.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {STAGES.map((k) => <div key={k} style={{ width: `${(stageCounts[k as StageNum] / list.rows.length) * 100}%`, background: STAGE_COLORS[k as StageNum] }} />)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setStageFilter(null); setSubFilter(null); }}
                  className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition ${stageFilter === null ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  All <span className="font-normal opacity-70">{list.rows.length}</span>
                </button>
                {([2, 1, 3, 4, 0] as StageNum[]).filter((k) => stageCounts[k] > 0).map((k) => {
                  const on = stageFilter === k, c = STAGE_COLORS[k];
                  return (
                    <button key={k} onClick={() => { setStageFilter(on ? null : k); setSubFilter(null); }} title={STAGE_TIPS[k]}
                      className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition hover:brightness-125"
                      style={{ color: c, borderColor: tint(c, on ? 0.75 : 0.35), background: tint(c, on ? 0.2 : 0.07) }}>
                      {k === 0 ? "Transition" : `S${k}`} <span className="font-normal text-muted-foreground">{stageCounts[k]} · {((stageCounts[k] / list.rows.length) * 100).toFixed(0)}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {subOptions.length > 1 && (
              <div className="flex flex-wrap items-center gap-1" title="Substage (A = fresh, B = late)">
                {subOptions.map(([sub, n]) => {
                  const on = subFilter === sub, c = STAGE_COLORS[(Number(sub[0]) || 0) as StageNum];
                  return (
                    <button key={sub} onClick={() => setSubFilter(on ? null : sub)} title={SUBSTAGE_TIPS[sub] ?? ""}
                      className="rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition"
                      style={on ? { color: c, borderColor: tint(c, 0.7), background: tint(c, 0.18) } : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                      {sub.replace("-", "−")} <span className="opacity-70">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} title="Minimum confidence: how clearly the chart fits its stage"
                className="h-7 rounded-md border border-border bg-background px-1.5 text-[11.5px] text-muted-foreground">
                {[0, 50, 70, 85].map((v) => <option key={v} value={v}>{v ? `Confidence ${v}+` : "Any confidence"}</option>)}
              </select>
              <input
                value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Ticker or ${GROUP_MODE_LABEL[mode].toLowerCase()}…`}
                className="h-7 w-40 rounded-md border border-border bg-background px-2 text-[12px]"
              />
            </div>
          </div>
          <StageStockTable rows={listRows} exportName={list?.title ?? "Stages"} groupOf={firstGroup} rsOf={rsOf} nameOf={nameOf} maxHeight={460} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
