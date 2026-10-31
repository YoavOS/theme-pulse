import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Loader2, Play, Pause, Square, Copy, Download, Trophy, Trash2, RefreshCw, PieChart as PieChartIcon, Settings2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperperformance, type SuperperformanceProfileKey } from "@/hooks/useSuperperformance";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import type { FiftyTwoWeekHigh } from "@/hooks/useFiftyTwoWeekHighs";
import SectorDistributionModal from "@/components/rs/SectorDistributionModal";
import CustomTradingViewListModal, { type CoilScoreInfo, type EmaDistanceInfo } from "@/components/rs/CustomTradingViewListModal";
import { loadStages, STAGE_COLORS, STAGE_NAMES, type StockStage } from "@/lib/stageAnalysis";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Symbols to scan (current qualified universe). */
  universe: string[];
  /** Full universe rows — enables sector distribution + RS Alpha filters on the saved list. */
  universeStocks?: RsStock[];
  ratingMap?: Map<string, number | null>;
  getRsForTab?: (s: RsStock, t: any) => number | null;
  getReturnField?: (s: RsStock, t: any) => number | null;
  isOtcSymbol?: (sym: string) => boolean;
  fundamentalsMap?: Map<string, StockFundamentals>;
  coilScores?: Map<string, CoilScoreInfo>;
  emaDistances?: Map<string, EmaDistanceInfo>;
  nh52wMap?: Map<string, FiftyTwoWeekHigh>;
  qqqPctChange?: number | null;
}

type Status = "idle" | "running" | "paused" | "done" | "cancelled";

const PROFILE_OPTIONS: { key: SuperperformanceProfileKey; label: string; col: "minervini_score" | "oneil_score" | "ryan_score" | "current_score" }[] = [
  { key: "current",   label: "Current",   col: "current_score" },
  { key: "minervini", label: "Minervini", col: "minervini_score" },
  { key: "oneil",     label: "O'Neil",    col: "oneil_score" },
  { key: "ryan",      label: "Ryan",      col: "ryan_score" },
];

type Thresholds = Record<SuperperformanceProfileKey, number>;
const DEFAULT_THRESHOLDS: Thresholds = { current: 80, minervini: 80, oneil: 80, ryan: 65 };
const THRESHOLDS_KEY = "superperf_thresholds_v2";
/** A score older than this is due for an update (fundamentals only change with earnings reports). */
const STALE_DAYS = 14;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;
/** Stocks scored at the same time. Each one takes ~2 s on the server. */
const CONCURRENCY = 4;
type ScanMode = "update" | "full";

const PROFILE_HELP: Record<SuperperformanceProfileKey, string> = {
  current: "Growth right now: the last few quarters' earnings and sales.",
  minervini: "Mark Minervini's SEPA fundamentals: accelerating earnings and sales, margins, ROE.",
  oneil: "William O'Neil's CAN SLIM: current-quarter and annual earnings growth.",
  ryan: "David Ryan's strict checklist. It rarely scores above 75, so its default bar is lower.",
};
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const fmtAgo = (iso: string) => { const d = daysAgo(iso); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`; };

function loadThresholds(): Thresholds {
  if (typeof window === "undefined") return { ...DEFAULT_THRESHOLDS };
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_THRESHOLDS, ...parsed };
  } catch { return { ...DEFAULT_THRESHOLDS }; }
}
function saveThresholds(t: Thresholds) {
  try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

const scoreKeys: Record<SuperperformanceProfileKey, string[]> = {
  current: ["current", "currentScore", "current_score"],
  minervini: ["minervini", "minerviniScore", "minervini_score"],
  oneil: ["oneil", "oneilScore", "oneil_score"],
  ryan: ["ryan", "ryanScore", "ryan_score"],
};

const normalizeScores = (data: any, profiles: SuperperformanceProfileKey[]) => {
  const out: Partial<Record<SuperperformanceProfileKey, number>> = {};
  const scoreBag = data?.scores && typeof data.scores === "object" ? data.scores : {};
  for (const profile of profiles) {
    const candidates = [
      ...scoreKeys[profile].map((k) => scoreBag?.[k]),
      ...scoreKeys[profile].map((k) => data?.[k]),
      data?.reports?.[profile]?.overallScore,
    ];
    const value = candidates.find((v) => typeof v === "number" && Number.isFinite(v));
    if (typeof value === "number") out[profile] = value;
  }
  return out;
};

interface BreakdownCriterion { label: string; actual?: string; target?: string; status?: string; comment?: string }
interface BreakdownReport {
  overallScore: number;
  verdict?: string;
  headline?: string;
  criteria?: BreakdownCriterion[];
  subScores?: { label: string; score: number; max: number }[];
}

export default function SuperperformanceScanModal({
  open, onOpenChange, universe, universeStocks, ratingMap, getRsForTab, getReturnField,
  isOtcSymbol, fundamentalsMap, coilScores, emaDistances, nh52wMap, qqqPctChange,
}: Props) {
  const { rows, loading, reload } = useSuperperformance();
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null);
  const [qualifierCount, setQualifierCount] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<SuperperformanceProfileKey[]>(["current", "minervini"]);
  const [thresholds, setThresholds] = useState<Thresholds>(() => loadThresholds());
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [sectorOpen, setSectorOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [breakdownSymbol, setBreakdownSymbol] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, BreakdownReport> | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const qualifierSymbolsRef = useRef<Set<string>>(new Set());
  const breakdownCache = useRef<Map<string, Record<string, BreakdownReport>>>(new Map());
  const [mode, setMode] = useState<ScanMode>("update");
  const [queue, setQueue] = useState<string[]>([]);
  const [showDropped, setShowDropped] = useState(false);
  const [stages, setStages] = useState<Map<string, StockStage>>(new Map());

  // Stage of each stock (from the Stages scan), for the saved list.
  useEffect(() => {
    if (!open) return;
    loadStages().then((rows) => setStages(new Map(rows.map((r) => [r.symbol.toUpperCase(), r])))).catch(() => undefined);
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      pauseRef.current = false;
    }
  }, [open]);

  useEffect(() => { saveThresholds(thresholds); }, [thresholds]);

  const toggleProfile = (key: SuperperformanceProfileKey) => {
    setSelectedProfiles((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);
  };

  const universeSet = useMemo(() => new Set(universe), [universe]);
  const bySymbol = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);

  /** Stocks that need scoring: never scored, scored more than 2 weeks ago, or missing a selected profile. */
  const dueSymbols = useMemo(() => universe.filter((sym) => {
    const r = bySymbol.get(sym);
    if (!r || Date.now() - new Date(r.last_scanned).getTime() > STALE_MS) return true;
    return selectedProfiles.some((p) => typeof (r as any)[PROFILE_OPTIONS.find((o) => o.key === p)!.col] !== "number");
  }), [universe, bySymbol, selectedProfiles]);

  /** Freshness of the scores for stocks currently in the list. */
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
      body: { symbol: sym, minimal: true, profiles: selectedProfiles },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    const scores = normalizeScores(data, selectedProfiles);
    // Keep every scored stock (a few bytes each) so the next Update knows what is already fresh.
    // Only the selected profiles' columns change; the others keep their earlier scores.
    const payload: Record<string, any> = { symbol: sym, last_scanned: new Date().toISOString() };
    let qualified = false;
    for (const p of selectedProfiles) {
      const v = typeof scores[p] === "number" ? scores[p] : null;
      payload[PROFILE_OPTIONS.find((o) => o.key === p)!.col] = v;
      if (v !== null && v >= thresholds[p]) qualified = true;
    }
    const { error: upErr } = await supabase.from("superperformance_stocks" as any).upsert(payload, { onConflict: "symbol" });
    if (upErr) throw new Error(upErr.message);
    if (qualified) {
      qualifierSymbolsRef.current.add(sym);
      setQualifierCount(qualifierSymbolsRef.current.size);
    }
  };

  /** Scores a list of stocks, a few at a time. Pause/Cancel take effect between stocks. */
  const runScan = async (list: string[]) => {
    if (universe.length === 0) { toast.error("Your stock list is empty. Run 'Update Stock List' first."); return; }
    if (selectedProfiles.length === 0) { toast.error("Select at least one profile to score."); return; }
    if (list.length === 0) { toast.success("Every stock was scored in the last 2 weeks. Nothing to update."); return; }
    cancelRef.current = false;
    pauseRef.current = false;
    qualifierSymbolsRef.current = new Set();
    setQualifierCount(0);
    setFailed([]);
    setQueue(list);
    setIndex(0);
    setStatus("running");

    let next = 0, done = 0;
    const failedNow: string[] = [];
    const worker = async () => {
      while (next < list.length) {
        while (pauseRef.current && !cancelRef.current) await new Promise((r) => setTimeout(r, 250));
        if (cancelRef.current) return;
        const sym = list[next++];
        setCurrentSymbol(sym);
        try { await scoreOne(sym); }
        catch (e) { failedNow.push(sym); console.warn("superperformance scan: failed", sym, e); }
        done++;
        setIndex(done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

    // One more try for the ones that failed (usually a brief rate limit upstream).
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
    toast.success(`Scored ${list.length - failedNow.length} stocks${failedNow.length ? ` · ${failedNow.length} failed` : ""}`);
  };

  const handleStart = () => runScan(mode === "update" ? dueSymbols : universe);
  const handlePause = () => { pauseRef.current = true; setStatus("paused"); };
  const handleResume = () => { pauseRef.current = false; setStatus("running"); };
  const handleCancel = () => { cancelRef.current = true; pauseRef.current = false; };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL Superperformance Stocks entries?")) return;
    const { error } = await supabase.from("superperformance_stocks" as any).delete().neq("symbol", "");
    if (error) { toast.error(error.message); return; }
    await reload();
    toast.success("Cleared Superperformance list");
  };

  const progressPct = total > 0 ? Math.round((index / total) * 100) : 0;

  /** Rows meeting the user's per-profile thresholds on at least one profile. */
  const sortedRows = useMemo(() => {
    const meets = (r: any) => PROFILE_OPTIONS.some((o) => {
      const v = (r as any)[o.col];
      return typeof v === "number" && v >= thresholds[o.key];
    });
    const bestDelta = (r: any) => Math.max(
      ...PROFILE_OPTIONS.map((o) => {
        const v = (r as any)[o.col];
        return typeof v === "number" ? v - thresholds[o.key] : -999;
      }),
    );
    return rows
      .filter(meets)
      .filter((r) => showDropped || universeSet.has(r.symbol))
      .sort((a, b) => bestDelta(b) - bestDelta(a));
  }, [rows, thresholds, showDropped, universeSet]);

  /** Qualifiers that have since left the stock list (RS or liquidity fell below the list rules). */
  const droppedCount = useMemo(() => rows.filter((r) => !universeSet.has(r.symbol) && PROFILE_OPTIONS.some((o) => {
    const v = (r as any)[o.col];
    return typeof v === "number" && v >= thresholds[o.key];
  })).length, [rows, universeSet, thresholds]);

  const ratingOf = (sym: string) => ratingMap?.get(sym) ?? null;
  const nameOf = useMemo(() => new Map((universeStocks ?? []).map((u) => [u.symbol, u.companyName])), [universeStocks]);

  const qualifyingSymbols = useMemo(() => new Set(sortedRows.map((r) => r.symbol)), [sortedRows]);

  /** Universe rows restricted to the qualifying Superperformance names. */
  const qualifyingStocks = useMemo(
    () => (universeStocks ?? []).filter((s) => qualifyingSymbols.has(s.symbol)),
    [universeStocks, qualifyingSymbols],
  );

  /** Threshold-aware sets, so the RS Alpha profile chips inside the filter modal match. */
  const thresholdSets = useMemo(() => {
    const out: Record<SuperperformanceProfileKey, Set<string>> = {
      current: new Set(), minervini: new Set(), oneil: new Set(), ryan: new Set(),
    };
    for (const r of rows) {
      for (const o of PROFILE_OPTIONS) {
        const v = (r as any)[o.col];
        if (typeof v === "number" && v >= thresholds[o.key]) out[o.key].add(r.symbol);
      }
    }
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

  const openBreakdown = async (symbol: string) => {
    if (breakdownSymbol === symbol) { setBreakdownSymbol(null); return; }
    setBreakdownSymbol(symbol);
    const cached = breakdownCache.current.get(symbol);
    if (cached) { setBreakdown(cached); return; }
    setBreakdown(null);
    setBreakdownLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("minervini-analysis", {
        body: { symbol, profiles: PROFILE_OPTIONS.map((p) => p.key) },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const reports = (data?.reports ?? {}) as Record<string, BreakdownReport>;
      breakdownCache.current.set(symbol, reports);
      setBreakdown(reports);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Breakdown unavailable");
      setBreakdown({});
    } finally {
      setBreakdownLoading(false);
    }
  };

  const renderScoreCell = (val: number | null | undefined, key: SuperperformanceProfileKey) => {
    if (typeof val !== "number") return <span className="text-muted-foreground">—</span>;
    const cls = val >= thresholds[key] ? "text-[hsl(40,90%,55%)] font-bold" : val >= thresholds[key] - 15 ? "text-foreground" : "text-muted-foreground";
    return <span className={`font-mono ${cls}`}>{val}</span>;
  };

  const scanning = status === "running" || status === "paused";

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
            Scores every stock in your list against growth-stock profiles, using its latest earnings reports.
            Scores only change when a company reports, so an update every couple of weeks in earnings season is enough.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* Freshness */}
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm ${dueSymbols.length > universe.length * 0.25 ? "border-[hsl(40,80%,50%)]/40 bg-[hsl(40,80%,50%)]/10" : "border-border bg-card"}`}>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {freshness.scored === 0
                ? "No scores yet for the stocks in your list"
                : `${freshness.fresh.toLocaleString()} of ${universe.length.toLocaleString()} stocks scored in the last ${STALE_DAYS} days`}
            </div>
            <div className="text-xs text-muted-foreground">
              {freshness.newest ? `Latest scoring ${fmtAgo(freshness.newest)}. ` : ""}
              {dueSymbols.length > 0
                ? `${dueSymbols.length.toLocaleString()} need an update (new to the list, or not scored for ${STALE_DAYS}+ days).`
                : "Everything is up to date."}
            </div>
          </div>
        </div>

        {/* Profiles + thresholds */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Profiles to score</div>
            <Button size="sm" variant="outline" onClick={() => setThresholdsOpen((v) => !v)}>
              <Settings2 size={14} className="mr-1" /> Score thresholds
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {PROFILE_OPTIONS.map((p) => (
              <label
                key={p.key}
                title={PROFILE_HELP[p.key]}
                className={`flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm ${scanning ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
              >
                <Checkbox checked={selectedProfiles.includes(p.key)} onCheckedChange={() => toggleProfile(p.key)} disabled={scanning} />
                <span className="font-medium">{p.label}</span>
                <span className="font-mono text-xs text-muted-foreground">≥{thresholds[p.key]}</span>
              </label>
            ))}
          </div>
          {thresholdsOpen && (
            <div className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-2">
              {PROFILE_OPTIONS.map((p) => (
                <div key={p.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{p.label} minimum</span>
                    <span className="font-mono text-[hsl(40,90%,55%)]">≥ {thresholds[p.key]}</span>
                  </div>
                  <Slider min={40} max={100} step={1} value={[thresholds[p.key]]} onValueChange={([v]) => setThresholds((t) => ({ ...t, [p.key]: v }))} />
                  <div className="text-[11px] leading-snug text-muted-foreground">{PROFILE_HELP[p.key]}</div>
                </div>
              ))}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground sm:col-span-2">
                <span>Thresholds only filter the saved list. No rescan needed.</span>
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
                ["update", `Update · ${dueSymbols.length.toLocaleString()}`, "Only stocks that are new to the list or weren't scored in the last 2 weeks"],
                ["full", `Full rescan · ${universe.length.toLocaleString()}`, "Score every stock in the list again"],
              ] as [ScanMode, string, string][]).map(([k, label, tip]) => (
                <button
                  key={k}
                  type="button"
                  title={tip}
                  disabled={scanning}
                  aria-pressed={mode === k}
                  onClick={() => setMode(k)}
                  className={`rounded px-3 py-1 text-xs font-medium transition disabled:opacity-60 ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {!scanning ? (
                <Button size="sm" onClick={handleStart} className="bg-[hsl(40,90%,55%)] font-semibold text-black hover:bg-[hsl(40,90%,50%)]">
                  <Play size={14} className="mr-1" /> {mode === "update" ? "Update scores" : "Rescan all"}
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
                : `About ${Math.max(1, Math.round(((mode === "update" ? dueSymbols.length : universe.length) * 2.3) / CONCURRENCY / 60))} min. Keep this window open while it runs; stopping keeps everything scored so far.`}
            </div>
          )}
          {status !== "idle" && (
            <>
              {scanning && <Progress value={progressPct} className="h-2" />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {status === "running" && <Loader2 size={12} className="animate-spin" />}
                <span>
                  {status === "paused" ? "Paused" : status === "running" ? (currentSymbol ? `Scoring ${currentSymbol}…` : "Starting…") : status === "cancelled" ? "Stopped" : "Done"}
                </span>
                <span>· <span className="font-mono">{index}</span>/{total} scored</span>
                <span>· <span className="font-mono text-[hsl(40,90%,55%)]">{qualifierCount}</span> qualify</span>
                {failed.length > 0 && <span title={failed.join(", ")}>· <span className="font-mono text-loss-medium">{failed.length}</span> failed (no reliable fundamentals)</span>}
              </div>
            </>
          )}
        </div>

        {/* Saved list */}
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
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={sortedRows.length === 0}>
                <Copy size={14} className="mr-1" /> Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={sortedRows.length === 0}>
                <Download size={14} className="mr-1" /> .txt
              </Button>
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
            {sortedRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {rows.length > 0 ? "No stocks meet the current thresholds. Lower them or update the scores." : "No scores yet. Run Update to score your list."}
              </div>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1.5 text-left font-medium">Stock</th>
                    <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="RS rating (overall), 1–99">RS</th>
                    {PROFILE_OPTIONS.map((p) => <th key={p.key} className="px-2 py-1.5 text-right font-medium" title={PROFILE_HELP[p.key]}>{p.label}</th>)}
                    <th className="px-2 py-1.5 text-right font-medium">Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const st = stages.get(r.symbol.toUpperCase());
                    const rs = ratingOf(r.symbol);
                    const stale = Date.now() - new Date(r.last_scanned).getTime() > STALE_MS;
                    const inList = universeSet.has(r.symbol);
                    return (
                    <Fragment key={r.symbol}>
                      <tr className="cursor-pointer border-b border-border/40 hover:bg-muted/30" onClick={() => openBreakdown(r.symbol)} title="Click for the score breakdown">
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <ChevronRight size={12} className={`shrink-0 transition-transform ${breakdownSymbol === r.symbol ? "rotate-90" : ""}`} />
                            <span className="font-mono font-bold">{r.symbol}</span>
                            {nameOf.get(r.symbol) && <span className="ml-1 hidden max-w-[160px] truncate text-xs text-muted-foreground md:inline">{nameOf.get(r.symbol)}</span>}
                            {!inList && <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">left list</span>}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          {st ? (
                            <span className="inline-flex items-center gap-1.5 text-xs" title={STAGE_NAMES[st.stage]}>
                              <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[st.stage] }} />
                              {st.stage === 0 ? "Transition" : `Stage ${st.stage}`}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{typeof rs === "number" ? rs : "—"}</td>
                        {PROFILE_OPTIONS.map((p) => <td key={p.key} className="px-2 py-1.5 text-right">{renderScoreCell((r as any)[p.col], p.key)}</td>)}
                        <td className={`px-2 py-1.5 text-right text-xs ${stale ? "text-[hsl(40,80%,55%)]" : "text-muted-foreground"}`} title={new Date(r.last_scanned).toLocaleString()}>
                          {fmtAgo(r.last_scanned)}
                        </td>
                      </tr>
                      {breakdownSymbol === r.symbol && (
                        <tr className="bg-muted/20">
                          <td colSpan={8} className="px-3 py-3">
                            {breakdownLoading ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 size={12} className="animate-spin" /> Loading score breakdown…
                              </div>
                            ) : !breakdown || Object.keys(breakdown).length === 0 ? (
                              <div className="text-xs text-muted-foreground">No breakdown available.</div>
                            ) : (
                              <div className="grid gap-3 md:grid-cols-2">
                                {PROFILE_OPTIONS.map((p) => {
                                  const rep = breakdown[p.key];
                                  if (!rep) return null;
                                  return (
                                    <div key={p.key} className="rounded-md border border-border bg-background p-3 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold uppercase tracking-wide">{p.label}</span>
                                        <span className={`font-mono text-sm ${rep.overallScore >= thresholds[p.key] ? "text-[hsl(40,90%,55%)] font-bold" : "text-muted-foreground"}`}>
                                          {rep.overallScore}
                                        </span>
                                      </div>
                                      {rep.subScores && rep.subScores.length > 0 && (
                                        <div className="space-y-1">
                                          {rep.subScores.map((s) => (
                                            <div key={s.label} className="flex items-center justify-between text-[11px]">
                                              <span className="text-muted-foreground">{s.label}</span>
                                              <span className="font-mono">{s.score}/{s.max}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {rep.criteria && rep.criteria.length > 0 && (
                                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                                          {rep.criteria.map((c, i) => (
                                            <div key={i} className="flex items-start justify-between gap-2 text-[11px]">
                                              <span className="text-muted-foreground">{c.label}</span>
                                              <span className={
                                                c.status === "pass" ? "text-gain-medium font-mono" :
                                                c.status === "fail" ? "text-loss-medium font-mono" : "font-mono text-muted-foreground"
                                              }>
                                                {c.actual ?? "—"}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
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
          getRsForTab={getRsForTab as any}
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
          getRsForTab={getRsForTab as any}
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
