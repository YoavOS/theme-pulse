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
const DEFAULT_THRESHOLDS: Thresholds = { current: 80, minervini: 80, oneil: 80, ryan: 80 };
const THRESHOLDS_KEY = "superperf_thresholds_v1";
/** Never persist rows scoring under this — keeps the table small regardless of thresholds. */
const PERSIST_FLOOR = 60;

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

  // Reset on close
  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      pauseRef.current = false;
    }
  }, [open]);

  useEffect(() => { saveThresholds(thresholds); }, [thresholds]);

  const total = universe.length;

  const toggleProfile = (key: SuperperformanceProfileKey) => {
    setSelectedProfiles((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);
  };

  const persistFloor = useMemo(
    () => Math.min(PERSIST_FLOOR, ...PROFILE_OPTIONS.map((p) => thresholds[p.key])),
    [thresholds],
  );

  const runScan = async (fromIndex = 0) => {
    if (total === 0) {
      toast.error("Universe is empty — rebuild RS Alpha first.");
      return;
    }
    if (selectedProfiles.length === 0) {
      toast.error("Select at least one profile to scan.");
      return;
    }
    cancelRef.current = false;
    pauseRef.current = false;
    setStatus("running");
    setIndex(fromIndex);
    if (fromIndex === 0) {
      qualifierSymbolsRef.current = new Set();
      setQualifierCount(0);
      setFailed([]);
    }

    const existingBySymbol = new Map<string, any>(rows.map((r) => [r.symbol, { ...r }]));

    for (let i = fromIndex; i < total; i++) {
      if (cancelRef.current) { setStatus("cancelled"); setCurrentSymbol(null); return; }
      while (pauseRef.current) {
        setStatus("paused");
        await new Promise((r) => setTimeout(r, 250));
        if (cancelRef.current) { setStatus("cancelled"); setCurrentSymbol(null); return; }
      }
      setStatus("running");

      const sym = universe[i];
      setIndex(i);
      setCurrentSymbol(sym);

      try {
        const { data, error } = await supabase.functions.invoke("minervini-analysis", {
          body: { symbol: sym, minimal: true, profiles: selectedProfiles },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        const scores = normalizeScores(data, selectedProfiles);

        // Build the upsert payload — only columns for selected profiles get updated.
        const payload: Record<string, any> = {
          symbol: sym,
          last_scanned: new Date().toISOString(),
        };
        let anyQualified = false;   // meets the user's threshold for at least one selected profile
        let anyPersistable = false; // worth keeping in the table at all
        for (const p of selectedProfiles) {
          const s = typeof scores[p] === "number" ? scores[p] : null;
          const col = PROFILE_OPTIONS.find((o) => o.key === p)!.col;
          payload[col] = s;
          if (s !== null && s >= thresholds[p]) anyQualified = true;
          if (s !== null && s >= persistFloor) anyPersistable = true;
        }

        if (anyPersistable) {
          await supabase
            .from("superperformance_stocks" as any)
            .upsert(payload, { onConflict: "symbol" });
          if (anyQualified) {
            qualifierSymbolsRef.current.add(sym);
            setQualifierCount(qualifierSymbolsRef.current.size);
          }
          existingBySymbol.set(sym, { ...(existingBySymbol.get(sym) ?? {}), ...payload });
        } else {
          const existing = existingBySymbol.get(sym);
          const otherProfileKeeps = existing
            ? PROFILE_OPTIONS
                .filter((o) => !selectedProfiles.includes(o.key))
                .some((o) => {
                  const v = (existing as any)[o.col];
                  return typeof v === "number" && v >= persistFloor;
                })
            : false;
          if (otherProfileKeeps) {
            await supabase
              .from("superperformance_stocks" as any)
              .update(payload)
              .eq("symbol", sym);
            existingBySymbol.set(sym, { ...existing, ...payload });
          } else {
            await supabase
              .from("superperformance_stocks" as any)
              .delete()
              .eq("symbol", sym);
            existingBySymbol.delete(sym);
          }
        }
      } catch (e) {
        setFailed((f) => [...f, sym]);
        console.warn("superperformance scan: failed", sym, e);
      }

      // Light pacing to stay friendly with upstream APIs (FMP/Yahoo/Finnhub).
      await new Promise((r) => setTimeout(r, 150));
    }

    setCurrentSymbol(null);
    setStatus("done");
    await reload();
    toast.success("Superperformance scan complete");
  };

  const handleStart = () => runScan(0);
  const handlePause = () => { pauseRef.current = true; };
  const handleResume = () => { pauseRef.current = false; runScan(index); };
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
    return rows.filter(meets).sort((a, b) => bestDelta(b) - bestDelta(a));
  }, [rows, thresholds]);

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
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-[hsl(40,90%,55%)]" />
            Superperformance Stocks
          </DialogTitle>
          <DialogDescription>
            Scans the qualified RS universe through each selected profile. Only the ticker, per-profile scores, and
            last-scanned date are persisted — raw fundamentals are discarded after scoring.
          </DialogDescription>
        </DialogHeader>

        {/* Profile selector + thresholds */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Profiles to score</div>
            <Button size="sm" variant="outline" onClick={() => setThresholdsOpen((v) => !v)}>
              <Settings2 size={14} className="mr-1" /> Score Thresholds
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            {PROFILE_OPTIONS.map((p) => (
              <label
                key={p.key}
                className={`flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm ${scanning ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-muted/50"}`}
              >
                <Checkbox
                  checked={selectedProfiles.includes(p.key)}
                  onCheckedChange={() => toggleProfile(p.key)}
                  disabled={scanning}
                />
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
                  <Slider
                    min={40}
                    max={100}
                    step={1}
                    value={[thresholds[p.key]]}
                    onValueChange={([v]) => setThresholds((t) => ({ ...t, [p.key]: v }))}
                  />
                </div>
              ))}
              <div className="sm:col-span-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Thresholds are saved locally and re-filter the saved list instantly (no rescan needed).</span>
                <Button size="sm" variant="ghost" onClick={() => setThresholds({ ...DEFAULT_THRESHOLDS })}>Reset</Button>
              </div>
            </div>
          )}
        </div>

        {/* Scan controls */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              Universe: <span className="font-mono font-bold">{total}</span> tickers
              {status !== "idle" && (
                <span className="ml-3 text-muted-foreground">
                  · Scanned <span className="font-mono">{index}</span>/{total}
                  · Qualifiers <span className="font-mono text-[hsl(40,90%,55%)]">{qualifierCount}</span>
                  {failed.length > 0 && <> · Failed <span className="font-mono text-loss-medium">{failed.length}</span></>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status === "idle" || status === "done" || status === "cancelled" ? (
                <Button size="sm" onClick={handleStart} className="bg-[hsl(40,90%,55%)] text-black hover:bg-[hsl(40,90%,50%)] font-semibold">
                  <Play size={14} className="mr-1" /> Start Scan
                </Button>
              ) : status === "running" ? (
                <>
                  <Button size="sm" variant="outline" onClick={handlePause}><Pause size={14} className="mr-1" /> Pause</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleResume}><Play size={14} className="mr-1" /> Resume</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Cancel</Button>
                </>
              )}
            </div>
          </div>

          {(status === "running" || status === "paused") && (
            <>
              <Progress value={progressPct} className="h-2" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {status === "running" && <Loader2 size={12} className="animate-spin" />}
                {status === "paused" ? "Paused" : currentSymbol ? `Analyzing ${currentSymbol}…` : "Preparing…"}
              </div>
            </>
          )}
        </div>

        {/* Saved list */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 max-h-[45vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-semibold">
              Saved Superperformance List
              <span className="ml-2 text-muted-foreground font-normal">({sortedRows.length})</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setSectorOpen(true)} disabled={!analyticsReady || sortedRows.length === 0}>
                <PieChartIcon size={14} className="mr-1" /> Sectors
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFiltersOpen(true)} disabled={!analyticsReady || sortedRows.length === 0}>
                <Settings2 size={14} className="mr-1" /> RS Filters
              </Button>
              <Button size="sm" variant="ghost" onClick={() => reload()} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={sortedRows.length === 0}>
                <Copy size={14} className="mr-1" /> Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={sortedRows.length === 0}>
                <Download size={14} className="mr-1" /> .txt
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={rows.length === 0} className="text-loss-medium hover:text-loss-medium">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <div className="overflow-y-auto">
            {sortedRows.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                {rows.length > 0 ? "No stocks meet the current thresholds — lower them or run a scan." : "No qualifying stocks yet. Run a scan to populate."}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5">Ticker</th>
                    <th className="text-right px-2 py-1.5">Current</th>
                    <th className="text-right px-2 py-1.5">Minervini</th>
                    <th className="text-right px-2 py-1.5">O'Neil</th>
                    <th className="text-right px-2 py-1.5">Ryan</th>
                    <th className="text-right px-2 py-1.5">Last Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <Fragment key={r.symbol}>
                      <tr
                        className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                        onClick={() => openBreakdown(r.symbol)}
                        title="Click for score breakdown"
                      >
                        <td className="px-2 py-1 font-mono font-bold flex items-center gap-1">
                          <ChevronRight size={12} className={`transition-transform ${breakdownSymbol === r.symbol ? "rotate-90" : ""}`} />
                          {r.symbol}
                        </td>
                        <td className="px-2 py-1 text-right">{renderScoreCell(r.current_score, "current")}</td>
                        <td className="px-2 py-1 text-right">{renderScoreCell(r.minervini_score, "minervini")}</td>
                        <td className="px-2 py-1 text-right">{renderScoreCell(r.oneil_score, "oneil")}</td>
                        <td className="px-2 py-1 text-right">{renderScoreCell(r.ryan_score, "ryan")}</td>
                        <td className="px-2 py-1 text-right text-xs text-muted-foreground">{new Date(r.last_scanned).toLocaleDateString()}</td>
                      </tr>
                      {breakdownSymbol === r.symbol && (
                        <tr className="bg-muted/20">
                          <td colSpan={6} className="px-3 py-3">
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
                  ))}
                </tbody>
              </table>
            )}
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
