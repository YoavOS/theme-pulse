import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Loader2, Play, Pause, Square, Copy, Download, Trophy, Trash2, RefreshCw, PieChart as PieChartIcon, Settings2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperperformance, loadBreakdown, type SuperperformanceProfileKey } from "@/hooks/useSuperperformance";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import type { FiftyTwoWeekHigh } from "@/hooks/useFiftyTwoWeekHighs";
import SectorDistributionModal from "@/components/rs/SectorDistributionModal";
import CustomTradingViewListModal, { type CoilScoreInfo, type EmaDistanceInfo } from "@/components/rs/CustomTradingViewListModal";
import { loadStages, STAGE_COLORS, STAGE_NAMES, type StockStage } from "@/lib/stageAnalysis";
import {
  DEFAULT_THRESHOLDS, PROFILES, PROFILE_BY_KEY, passes, priceProfile, saveListSettings, saveThresholds, scoreOf,
  type Breakdown, type ListSettings, type PriceInputs, type ProfileKey, type SavedRow, type Thresholds,
} from "@/lib/superperfProfiles";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Symbols to scan (current qualified universe). */
  universe: string[];
  /** Full universe rows — enables sector distribution + RS Alpha filters on the saved list. */
  universeStocks?: RsStock[];
  ratingMap?: Map<string, number | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the RS Alpha tab id type lives in the page
  getRsForTab?: (s: RsStock, t: any) => number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getReturnField?: (s: RsStock, t: any) => number | null;
  isOtcSymbol?: (sym: string) => boolean;
  fundamentalsMap?: Map<string, StockFundamentals>;
  coilScores?: Map<string, CoilScoreInfo>;
  emaDistances?: Map<string, EmaDistanceInfo>;
  nh52wMap?: Map<string, FiftyTwoWeekHigh>;
  qqqPctChange?: number | null;
}

type Status = "idle" | "running" | "paused" | "done" | "cancelled";
type ScanMode = "update" | "full";

const LEGACY: SuperperformanceProfileKey[] = ["current", "minervini", "oneil", "ryan"];
const COL: Record<SuperperformanceProfileKey, "current_score" | "minervini_score" | "oneil_score" | "ryan_score"> = {
  current: "current_score", minervini: "minervini_score", oneil: "oneil_score", ryan: "ryan_score",
};
/** A score older than this is due for an update (fundamentals only change with earnings reports). */
const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;
/** Stocks scored at the same time. Each one takes ~2 s on the server. */
const CONCURRENCY = 4;

const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const fmtAgo = (iso: string) => { const d = daysAgo(iso); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`; };
const daysUntil = (iso: string) => Math.ceil((new Date(iso + "T12:00:00Z").getTime() - Date.now()) / 86_400_000);

interface BgStatus { active: boolean; due: number; reportedSince: number; neverScored: number; older30d: number }

export default function SuperperformanceScanModal({
  open, onOpenChange, universe, universeStocks, ratingMap, getRsForTab, getReturnField,
  isOtcSymbol, fundamentalsMap, coilScores, emaDistances, nh52wMap, qqqPctChange,
}: Props) {
  const { rows, loading, reload, thresholds: savedThresholds, list: savedList } = useSuperperformance();
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null);
  const [qualifierCount, setQualifierCount] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds>(savedThresholds);
  const [list, setList] = useState<ListSettings>(savedList);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [sectorOpen, setSectorOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [breakdownSymbol, setBreakdownSymbol] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [mode, setMode] = useState<ScanMode>("update");
  const [queue, setQueue] = useState<string[]>([]);
  const [showDropped, setShowDropped] = useState(false);
  const [stages, setStages] = useState<Map<string, StockStage>>(new Map());
  const [bg, setBg] = useState<BgStatus | null | "unavailable">(null);
  const [bgBusy, setBgBusy] = useState(false);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const qualifierSymbolsRef = useRef<Set<string>>(new Set());
  const breakdownCache = useRef<Map<string, Breakdown>>(new Map());

  useEffect(() => { if (!open) { cancelRef.current = true; pauseRef.current = false; } }, [open]);
  useEffect(() => { saveThresholds(thresholds); saveListSettings(list); }, [thresholds, list]);

  // Stage of each stock (from the Stages scan): shown in the list and used by the price profiles.
  useEffect(() => {
    if (!open) return;
    loadStages().then((r) => setStages(new Map(r.map((x) => [x.symbol.toUpperCase(), x])))).catch(() => undefined);
  }, [open]);

  // Background refresh status (the server job that rescores stocks after they report).
  const loadBg = async () => {
    const { data, error } = await supabase.functions.invoke("superperf-refresh", { body: { action: "status" } });
    if (error || !data?.ok) { setBg("unavailable"); return; }
    setBg({ active: data.active !== false, due: data.due ?? 0, reportedSince: data.reportedSince ?? 0, neverScored: data.neverScored ?? 0, older30d: data.older30d ?? 0 });
  };
  useEffect(() => { if (open) void loadBg(); }, [open]);
  const toggleBg = async () => {
    if (!bg || bg === "unavailable") return;
    setBgBusy(true);
    const { error } = await supabase.functions.invoke("superperf-refresh", { body: { action: bg.active ? "pause" : "resume" } });
    setBgBusy(false);
    if (error) { toast.error("Couldn't change background updates"); return; }
    toast.success(bg.active ? "Background updates paused" : "Background updates on");
    void loadBg();
  };

  const universeSet = useMemo(() => new Set(universe), [universe]);
  const bySymbol = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);
  const stockBySymbol = useMemo(() => new Map((universeStocks ?? []).map((u) => [u.symbol, u])), [universeStocks]);

  const priceInputs = (sym: string): PriceInputs => {
    const s = stockBySymbol.get(sym);
    return { stage: stages.get(sym.toUpperCase()) ?? null, rsRating: ratingMap?.get(sym) ?? null, rs1w: s?.rs1w ?? null, rs1m: s?.rs1m ?? null, rsNewHigh: s?.rsNh20d ?? null };
  };
  const score = (sym: string, k: ProfileKey) => scoreOf(k, bySymbol.get(sym), PROFILE_BY_KEY.get(k)?.source === "price" ? priceInputs(sym) : null);

  /** Stocks that need scoring: never scored, scored over 2 weeks ago, or scored before the newer profiles existed. */
  const dueSymbols = useMemo(() => universe.filter((sym) => {
    const r = bySymbol.get(sym);
    if (!r || Date.now() - new Date(r.last_scanned).getTime() > STALE_MS) return true;
    // profile_scores is undefined before the database migration and null for rows scored before it.
    return r.profile_scores === null;
  }), [universe, bySymbol]);

  const freshness = useMemo(() => {
    let scored = 0, fresh = 0, newest: string | null = null;
    for (const sym of universe) {
      const r = bySymbol.get(sym);
      if (!r) continue;
      scored++;
      if (Date.now() - new Date(r.last_scanned).getTime() <= STALE_MS) fresh++;
      if (!newest || r.last_scanned > newest) newest = r.last_scanned;
    }
    return { scored, fresh, newest };
  }, [universe, bySymbol]);

  const total = queue.length;

  const scoreOne = async (sym: string) => {
    const { data, error } = await supabase.functions.invoke("minervini-analysis", {
      body: { symbol: sym, minimal: true, profiles: LEGACY, breakdown: true },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    const payload: Record<string, unknown> = { symbol: sym, last_scanned: new Date().toISOString() };
    for (const k of LEGACY) {
      const v = data?.scores?.[k];
      payload[COL[k]] = typeof v === "number" ? v : null;
    }
    // Newer backend: every evidence-based profile, a compact breakdown and the report dates.
    if (data?.profileScores) {
      payload.profile_scores = data.profileScores;
      payload.breakdown = data.breakdown ?? null;
      payload.last_report = data.lastReport ?? null;
      payload.next_report = data.nextReport ?? null;
    }
    let { error: upErr } = await supabase.from("superperformance_stocks" as never).upsert(payload as never, { onConflict: "symbol" });
    if (upErr && /column/i.test(upErr.message)) {
      // Database not migrated yet: save the classic scores only.
      for (const k of ["profile_scores", "breakdown", "last_report", "next_report"]) delete payload[k];
      ({ error: upErr } = await supabase.from("superperformance_stocks" as never).upsert(payload as never, { onConflict: "symbol" }));
    }
    if (upErr) throw new Error(upErr.message);
    breakdownCache.current.delete(sym);
    const row = { ...(bySymbol.get(sym) ?? {}), ...payload } as SavedRow;
    if (passes(list, thresholds, (k) => scoreOf(k, row, PROFILE_BY_KEY.get(k)?.source === "price" ? priceInputs(sym) : null))) {
      qualifierSymbolsRef.current.add(sym);
      setQualifierCount(qualifierSymbolsRef.current.size);
    }
  };

  /** Scores a list of stocks, a few at a time. Pause/Stop take effect between stocks. */
  const runScan = async (todo: string[]) => {
    if (universe.length === 0) { toast.error("Your stock list is empty. Run 'Update Stock List' first."); return; }
    if (todo.length === 0) { toast.success("Every stock was scored in the last 2 weeks. Nothing to update."); return; }
    cancelRef.current = false;
    pauseRef.current = false;
    qualifierSymbolsRef.current = new Set();
    setQualifierCount(0);
    setFailed([]);
    setQueue(todo);
    setIndex(0);
    setStatus("running");

    let next = 0, done = 0;
    const failedNow: string[] = [];
    const worker = async () => {
      while (next < todo.length) {
        while (pauseRef.current && !cancelRef.current) await new Promise((r) => setTimeout(r, 250));
        if (cancelRef.current) return;
        const sym = todo[next++];
        setCurrentSymbol(sym);
        try { await scoreOne(sym); }
        catch (e) { failedNow.push(sym); console.warn("superperformance scan: failed", sym, e); }
        done++;
        setIndex(done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    if (!cancelRef.current && failedNow.length) {
      const retry = failedNow.splice(0);
      for (const sym of retry) {
        if (cancelRef.current) break;
        try { await scoreOne(sym); } catch { failedNow.push(sym); }
      }
    }
    setFailed(failedNow);
    setCurrentSymbol(null);
    await reload();
    if (cancelRef.current) { setStatus("cancelled"); return; }
    setStatus("done");
    toast.success(`Scored ${todo.length - failedNow.length} stocks${failedNow.length ? ` · ${failedNow.length} failed` : ""}`);
  };

  const handleStart = () => runScan(mode === "update" ? dueSymbols : universe);
  const handlePause = () => { pauseRef.current = true; setStatus("paused"); };
  const handleResume = () => { pauseRef.current = false; setStatus("running"); };
  const handleCancel = () => { cancelRef.current = true; pauseRef.current = false; };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL Superperformance Stocks entries?")) return;
    const { error } = await supabase.from("superperformance_stocks" as never).delete().neq("symbol", "");
    if (error) { toast.error(error.message); return; }
    await reload();
    toast.success("Cleared Superperformance list");
  };

  const progressPct = total > 0 ? Math.round((index / total) * 100) : 0;
  const scanning = status === "running" || status === "paused";

  // Candidates: every stock in the list (price profiles need no scan), plus saved stocks that left it.
  const candidates = useMemo(() => {
    const s = new Set<string>(universe);
    if (showDropped) rows.forEach((r) => s.add(r.symbol));
    return [...s];
  }, [universe, rows, showDropped]);

  const sortedRows = useMemo(() => {
    const out: { symbol: string; scores: Record<string, number | null>; best: number }[] = [];
    for (const sym of candidates) {
      const sc: Record<string, number | null> = {};
      for (const k of list.profiles) sc[k] = score(sym, k);
      if (!passes(list, thresholds, (k) => sc[k] ?? null)) continue;
      const best = Math.max(...list.profiles.map((k) => (sc[k] ?? -999) - thresholds[k]));
      out.push({ symbol: sym, scores: sc, best });
    }
    return out.sort((a, b) => b.best - a.best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, list, thresholds, bySymbol, stages, ratingMap, stockBySymbol]);

  const droppedCount = useMemo(() => rows.filter((r) => !universeSet.has(r.symbol)
    && passes(list, thresholds, (k) => (PROFILE_BY_KEY.get(k)?.source === "fundamental" ? scoreOf(k, r, null) : null))).length,
  [rows, universeSet, list, thresholds]);

  const qualifyingSymbols = useMemo(() => new Set(sortedRows.map((r) => r.symbol)), [sortedRows]);
  const qualifyingStocks = useMemo(() => (universeStocks ?? []).filter((s) => qualifyingSymbols.has(s.symbol)), [universeStocks, qualifyingSymbols]);

  /** Threshold-aware sets for the RS Alpha profile chips inside the filter modal. */
  const thresholdSets = useMemo(() => {
    const out: Record<SuperperformanceProfileKey, Set<string>> = { current: new Set(), minervini: new Set(), oneil: new Set(), ryan: new Set() };
    for (const r of rows) for (const k of LEGACY) { const v = r[COL[k]]; if (typeof v === "number" && v >= thresholds[k]) out[k].add(r.symbol); }
    return out;
  }, [rows, thresholds]);

  const analyticsReady = (universeStocks?.length ?? 0) > 0 && !!ratingMap && !!getRsForTab && !!getReturnField && !!isOtcSymbol;
  const tickerString = sortedRows.map((r) => r.symbol).join(",");

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(tickerString); toast.success(`${sortedRows.length} tickers copied`); }
    catch { toast.error("Copy failed"); }
  };
  const handleDownload = () => {
    const blob = new Blob([sortedRows.map((r) => r.symbol).join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Superperformance_${sortedRows.length}tickers.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** Breakdown: saved with the score when available, otherwise worked out once on demand. */
  const openBreakdown = async (symbol: string) => {
    if (breakdownSymbol === symbol) { setBreakdownSymbol(null); return; }
    setBreakdownSymbol(symbol);
    const cached = breakdownCache.current.get(symbol);
    if (cached) { setBreakdown(cached); return; }
    setBreakdown(null);
    setBreakdownLoading(true);
    try {
      let b = await loadBreakdown(symbol);
      if (!b || b.err) {
        const { data, error } = await supabase.functions.invoke("minervini-analysis", { body: { symbol, minimal: true, profiles: LEGACY, breakdown: true } });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        b = (data?.breakdown as Breakdown | undefined) ?? null;
        if (!b) {
          // Older backend: full reports only.
          const full = await supabase.functions.invoke("minervini-analysis", { body: { symbol, profiles: LEGACY } });
          b = fromFullReports(full.data?.reports) ?? {};
        }
      }
      breakdownCache.current.set(symbol, b);
      setBreakdown(b);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Breakdown unavailable");
      setBreakdown({});
    } finally {
      setBreakdownLoading(false);
    }
  };

  const renderScore = (val: number | null | undefined, key: ProfileKey) => {
    if (typeof val !== "number") return <span className="text-muted-foreground">—</span>;
    const cls = val >= thresholds[key] ? "text-[hsl(40,90%,55%)] font-bold" : val >= thresholds[key] - 15 ? "text-foreground" : "text-muted-foreground";
    return <span className={`font-mono ${cls}`}>{val}</span>;
  };

  const toggleListProfile = (k: ProfileKey) =>
    setList((l) => ({ ...l, profiles: l.profiles.includes(k) ? l.profiles.filter((x) => x !== k) : [...l.profiles, k] }));

  const groups: [string, string, ProfileKey[]][] = [
    ["From earnings reports", "Saved by the scan; refreshed after each company reports.", PROFILES.filter((p) => p.source === "fundamental").map((p) => p.key)],
    ["From price action", "Live from the Stages scan and RS ratings. No scan needed.", PROFILES.filter((p) => p.source === "price").map((p) => p.key)],
  ];
  const nextReportSoon = (sym: string) => {
    const nr = bySymbol.get(sym)?.next_report;
    if (!nr) return null;
    const d = daysUntil(nr);
    return d >= 0 && d <= 14 ? d : null;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-[hsl(40,90%,55%)]" />
            Superperformance Stocks
          </DialogTitle>
          <DialogDescription>
            Finds the stocks in your list that pass the profiles you pick. Earnings-based scores change only when a company
            reports; price-based ones are live.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* Freshness + background updates */}
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm ${dueSymbols.length > universe.length * 0.25 && !(bg && bg !== "unavailable" && bg.active) ? "border-[hsl(40,80%,50%)]/40 bg-[hsl(40,80%,50%)]/10" : "border-border bg-card"}`}>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {freshness.scored === 0
                ? "No earnings scores yet for the stocks in your list"
                : `${freshness.fresh.toLocaleString()} of ${universe.length.toLocaleString()} stocks scored in the last ${STALE_DAYS} days`}
            </div>
            <div className="text-xs text-muted-foreground">
              {freshness.newest ? `Latest scoring ${fmtAgo(freshness.newest)}. ` : ""}
              {bg && bg !== "unavailable"
                ? bg.active
                  ? bg.due > 0
                    ? `Background updates are on: ${bg.due.toLocaleString()} queued (${bg.reportedSince} reported since their last score, ${bg.neverScored} never scored, ${bg.older30d} older than 30 days), about 90 an hour.`
                    : "Background updates are on: every stock is rescored the day after it reports."
                  : "Background updates are paused."
                : bg === "unavailable"
                  ? `Background updates aren't set up yet. ${dueSymbols.length.toLocaleString()} need an update.`
                  : `${dueSymbols.length.toLocaleString()} need an update.`}
            </div>
          </div>
          {bg && bg !== "unavailable" && (
            <Button size="sm" variant="outline" onClick={toggleBg} disabled={bgBusy}>
              {bgBusy ? <Loader2 size={14} className="mr-1 animate-spin" /> : bg.active ? <Pause size={14} className="mr-1" /> : <Play size={14} className="mr-1" />}
              {bg.active ? "Pause background updates" : "Turn on background updates"}
            </Button>
          )}
        </div>

        {/* Profiles that define the list */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">A stock qualifies when it passes</div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5" role="group" aria-label="Match">
                {(["any", "all"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={list.match === m} onClick={() => setList((l) => ({ ...l, match: m }))}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${list.match === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {m === "any" ? "Any of them" : "All of them"}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setThresholdsOpen((v) => !v)}>
                <Settings2 size={14} className="mr-1" /> Thresholds
              </Button>
            </div>
          </div>
          {groups.map(([title, sub, keys]) => (
            <div key={title} className="space-y-1.5">
              <div className="text-xs"><span className="font-medium text-foreground">{title}</span> <span className="text-muted-foreground">· {sub}</span></div>
              <div className="flex flex-wrap gap-2">
                {keys.map((k) => {
                  const p = PROFILE_BY_KEY.get(k)!;
                  return (
                    <label key={k} title={p.help} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted/50">
                      <Checkbox checked={list.profiles.includes(k)} onCheckedChange={() => toggleListProfile(k)} />
                      <span className="font-medium">{p.label}</span>
                      <span className="font-mono text-xs text-muted-foreground">≥{thresholds[k]}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {thresholdsOpen && (
            <div className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2">
              {PROFILES.map((p) => (
                <div key={p.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{p.label}</span>
                    <span className="font-mono text-[hsl(40,90%,55%)]">≥ {thresholds[p.key]}</span>
                  </div>
                  <Slider min={40} max={100} step={1} value={[thresholds[p.key]]} onValueChange={([v]) => setThresholds((t) => ({ ...t, [p.key]: v }))} />
                  <div className="text-[11px] leading-snug text-muted-foreground">{p.help}</div>
                </div>
              ))}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground sm:col-span-2">
                <span>Thresholds only filter the list. No rescan needed.</span>
                <Button size="sm" variant="ghost" onClick={() => setThresholds({ ...DEFAULT_THRESHOLDS })}>Reset</Button>
              </div>
            </div>
          )}
        </div>

        {/* Scan controls */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5" role="group" aria-label="What to score">
              {([
                ["update", `Update · ${dueSymbols.length.toLocaleString()}`, "Only stocks that are new to the list, weren't scored in the last 2 weeks, or miss the newer profiles"],
                ["full", `Full rescan · ${universe.length.toLocaleString()}`, "Score every stock in the list again"],
              ] as [ScanMode, string, string][]).map(([k, label, tip]) => (
                <button key={k} type="button" title={tip} disabled={scanning} aria-pressed={mode === k} onClick={() => setMode(k)}
                  className={`rounded px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {!scanning ? (
                <Button size="sm" onClick={handleStart} className="bg-[hsl(40,90%,55%)] font-semibold text-black hover:bg-[hsl(40,90%,50%)]">
                  <Play size={14} className="mr-1" /> {mode === "update" ? "Update now" : "Rescan all"}
                </Button>
              ) : status === "running" ? (
                <>
                  <Button size="sm" variant="outline" onClick={handlePause}><Pause size={14} className="mr-1" /> Pause</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Stop</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleResume}><Play size={14} className="mr-1" /> Resume</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Stop</Button>
                </>
              )}
            </div>
          </div>
          {!scanning && (
            <div className="text-xs text-muted-foreground">
              {(mode === "update" ? dueSymbols.length : universe.length) === 0
                ? "Nothing to update right now."
                : `Scores every earnings-based profile. About ${Math.max(1, Math.round(((mode === "update" ? dueSymbols.length : universe.length) * 2.3) / CONCURRENCY / 60))} min; keep this window open. Stopping keeps everything scored so far.`}
            </div>
          )}
          {status !== "idle" && (
            <>
              {scanning && <Progress value={progressPct} className="h-2" />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {status === "running" && <Loader2 size={12} className="animate-spin" />}
                <span>{status === "paused" ? "Paused" : status === "running" ? (currentSymbol ? `Scoring ${currentSymbol}…` : "Starting…") : status === "cancelled" ? "Stopped" : "Done"}</span>
                <span>· <span className="font-mono">{index}</span>/{total} scored</span>
                <span>· <span className="font-mono text-[hsl(40,90%,55%)]">{qualifierCount}</span> qualify</span>
                {failed.length > 0 && <span title={failed.join(", ")}>· <span className="font-mono text-loss-medium">{failed.length}</span> failed (no reliable fundamentals)</span>}
              </div>
            </>
          )}
        </div>

        {/* Qualifying list */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              Qualifying stocks <span className="ml-1 font-normal text-muted-foreground">({sortedRows.length})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setSectorOpen(true)} disabled={!analyticsReady || sortedRows.length === 0}>
                <PieChartIcon size={14} className="mr-1" /> Sectors
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFiltersOpen(true)} disabled={!analyticsReady || sortedRows.length === 0}>
                <Settings2 size={14} className="mr-1" /> RS filters
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reload()} disabled={loading} aria-label="Reload saved scores">
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={sortedRows.length === 0}><Copy size={14} className="mr-1" /> Copy</Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={sortedRows.length === 0}><Download size={14} className="mr-1" /> .txt</Button>
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={rows.length === 0} className="text-loss-medium hover:text-loss-medium" aria-label="Delete all saved scores">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          {droppedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={showDropped} onCheckedChange={(v) => setShowDropped(v === true)} />
              Also show {droppedCount} that qualified but have since left your stock list
            </label>
          )}
          <div className="overflow-x-auto">
            {list.profiles.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Pick at least one profile above.</div>
            ) : sortedRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {rows.length > 0 ? "No stocks pass these profiles at these thresholds. Lower them, switch to “Any of them”, or update the scores." : "No scores yet. Run Update now to score your list."}
              </div>
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1.5 text-left font-medium">Stock</th>
                    <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="RS rating (overall), 1–99">RS</th>
                    {list.profiles.map((k) => <th key={k} className="px-2 py-1.5 text-right font-medium" title={PROFILE_BY_KEY.get(k)?.help}>{PROFILE_BY_KEY.get(k)?.short}</th>)}
                    <th className="px-2 py-1.5 text-right font-medium">Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(({ symbol, scores }) => {
                    const saved = bySymbol.get(symbol);
                    const st = stages.get(symbol.toUpperCase());
                    const rs = ratingMap?.get(symbol) ?? null;
                    const stale = saved ? Date.now() - new Date(saved.last_scanned).getTime() > STALE_MS : false;
                    const inList = universeSet.has(symbol);
                    const er = nextReportSoon(symbol);
                    return (
                      <Fragment key={symbol}>
                        <tr className="cursor-pointer border-b border-border/40 hover:bg-muted/30" onClick={() => openBreakdown(symbol)} title="Click for the score breakdown">
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <ChevronRight size={12} className={`shrink-0 transition-transform ${breakdownSymbol === symbol ? "rotate-90" : ""}`} />
                              <span className="font-mono font-bold">{symbol}</span>
                              {stockBySymbol.get(symbol)?.companyName && <span className="ml-1 hidden max-w-[150px] truncate text-xs text-muted-foreground md:inline">{stockBySymbol.get(symbol)?.companyName}</span>}
                              {!inList && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">left list</span>}
                              {er !== null && <span className="ml-1 rounded bg-[hsl(40,80%,50%)]/15 px-1 text-[10px] text-[hsl(40,90%,62%)]" title={`Reports earnings ${er === 0 ? "today" : `in ${er} day${er === 1 ? "" : "s"}`}`}>ER {er === 0 ? "today" : `${er}d`}</span>}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            {st ? (
                              <span className="inline-flex items-center gap-1.5 text-xs" title={STAGE_NAMES[st.stage]}>
                                <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[st.stage] }} />
                                {st.stage === 0 ? "Transition" : `Stage ${st.substage || st.stage}`}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-xs">{typeof rs === "number" ? rs : "—"}</td>
                          {list.profiles.map((k) => <td key={k} className="px-2 py-1.5 text-right">{renderScore(scores[k], k)}</td>)}
                          <td className={`px-2 py-1.5 text-right text-xs ${stale ? "text-[hsl(40,80%,55%)]" : "text-muted-foreground"}`} title={saved ? new Date(saved.last_scanned).toLocaleString() : "Not scored on earnings yet"}>
                            {saved ? fmtAgo(saved.last_scanned) : "—"}
                          </td>
                        </tr>
                        {breakdownSymbol === symbol && (
                          <tr className="bg-muted/20">
                            <td colSpan={4 + list.profiles.length} className="px-3 py-3">
                              <BreakdownPanel
                                loading={breakdownLoading}
                                breakdown={breakdown}
                                profiles={list.profiles}
                                thresholds={thresholds}
                                price={priceInputs(symbol)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>

    {analyticsReady && (
      <>
        <SectorDistributionModal
          open={sectorOpen}
          onOpenChange={setSectorOpen}
          tabId="overall"
          tabLabel="Superperformance Stocks"
          stocks={qualifyingStocks}
          ratingMap={ratingMap!}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getRsForTab={getRsForTab as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getReturnField={getReturnField as any}
          isOtcSymbol={isOtcSymbol!}
        />
        <CustomTradingViewListModal
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          tabId="overall"
          tabLabel="Superperformance Stocks"
          stocks={qualifyingStocks}
          ratingMap={ratingMap!}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getRsForTab={getRsForTab as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getReturnField={getReturnField as any}
          isOtcSymbol={isOtcSymbol!}
          fundamentalsMap={fundamentalsMap}
          coilScores={coilScores}
          emaDistances={emaDistances}
          nh52wMap={nh52wMap}
          qqqPctChange={qqqPctChange}
          superperfSets={thresholdSets}
        />
      </>
    )}
    </>
  );
}

/** Full reports (older backend) → the compact breakdown shape. */
function fromFullReports(reports: unknown): Breakdown | null {
  if (!reports || typeof reports !== "object") return null;
  const out: Breakdown = {};
  for (const [k, r] of Object.entries(reports as Record<string, { overallScore?: number; headline?: string; criteria?: { name?: string; label?: string; value?: string; actual?: string; status?: string }[] }>)) {
    if (!r) continue;
    out[k as ProfileKey] = {
      s: r.overallScore ?? null, h: r.headline,
      c: (r.criteria ?? []).map((c) => [c.name ?? c.label ?? "", c.value ?? c.actual ?? "—", c.status === "pass" ? 1 : c.status === "fail" ? -1 : 0]),
    };
  }
  return out;
}

function BreakdownPanel({ loading, breakdown, profiles, thresholds, price }: {
  loading: boolean; breakdown: Breakdown | null; profiles: ProfileKey[]; thresholds: Thresholds; price: PriceInputs;
}) {
  const cards = profiles.map((k) => {
    const def = PROFILE_BY_KEY.get(k)!;
    if (def.source === "price") {
      const p = priceProfile(k, price);
      if (!p) return null;
      return { k, label: def.label, score: p.score, note: p.score === null ? "Not enough price data (run the Stages scan)." : undefined,
        crit: p.parts.map((x) => [x.label, `${x.value} · ${x.earned}/${x.max}`, x.good === true ? 1 : x.good === false ? -1 : 0] as [string, string, number]) };
    }
    const b = breakdown?.[k];
    if (!b) return { k, label: def.label, score: null, note: loading ? undefined : "No details saved for this score yet. They're added the next time the stock is scored.", crit: [] as [string, string, number][] };
    return { k, label: def.label, score: b.s, note: b.n ?? (b.s === null ? "Not enough filing history." : undefined), crit: b.c ?? [] };
  }).filter(Boolean) as { k: ProfileKey; label: string; score: number | null; note?: string; crit: [string, string, number][] }[];

  return (
    <div className="space-y-2">
      {loading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading the earnings breakdown…</div>}
      {breakdown?.err && <div className="text-xs text-muted-foreground">Last scoring attempt failed: {breakdown.err}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <div key={c.k} className="space-y-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{c.label}</span>
              <span className={`font-mono text-sm ${c.score !== null && c.score >= thresholds[c.k] ? "font-bold text-[hsl(40,90%,55%)]" : "text-muted-foreground"}`}>{c.score ?? "—"}</span>
            </div>
            {c.note && <div className="text-[11px] text-muted-foreground">{c.note}</div>}
            {c.crit.length > 0 && (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {c.crit.map(([label, value, st], i) => (
                  <div key={i} className="flex items-start justify-between gap-3 text-[11px]">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`shrink-0 text-right font-mono ${st > 0 ? "text-gain-medium" : st < 0 ? "text-loss-medium" : "text-muted-foreground"}`}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
