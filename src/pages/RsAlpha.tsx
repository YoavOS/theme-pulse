import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, Info, ChevronDown, ChevronUp, ArrowUpDown, Filter, Hammer, Pause, Play, RotateCcw, Copy, Download, Settings2, PieChart as PieChartIcon, Database, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useRsAlpha, RsStock, RS_FILTER_THRESHOLDS } from "@/hooks/useRsAlpha";
import { useFundamentalsScan } from "@/hooks/useFundamentalsScan";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import HelpButton from "@/components/HelpButton";
import OverallWeightsPanel, { RsWeights, DEFAULT_RS_WEIGHTS, normalizeWeights } from "@/components/rs/OverallWeightsPanel";
import RsRatingBadge, { computeRsRatings } from "@/components/rs/RsRatingBadge";
import CustomTradingViewListModal from "@/components/rs/CustomTradingViewListModal";
import SectorDistributionModal from "@/components/rs/SectorDistributionModal";
import FundamentalsCoverageModal from "@/components/rs/FundamentalsCoverageModal";

type TabId = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";
type SortField = "rank" | "symbol" | "company" | "rs" | "rating" | "stockReturn" | "spyReturn" | "price";
type SortDir = "asc" | "desc";

const RS_WEIGHTS_KEY = "rs-overall-weights-v2";

const TABS: { id: TabId; label: string }[] = [
  { id: "overall", label: "Overall" },
  { id: "1d", label: "1 Day" },
  { id: "1w", label: "1 Week" },
  { id: "1m", label: "1 Month" },
  { id: "3m", label: "3 Months" },
  { id: "6m", label: "6 Months" },
];

function getRsField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1d": return stock.rs1d;
    case "1w": return stock.rs1w;
    case "1m": return stock.rs1m;
    case "3m": return stock.rs3m;
    case "6m": return stock.rs6m;
    default: return stock.rsOverall;
  }
}
function getReturnField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1d": return stock.return1d;
    case "1w": return stock.return1w;
    case "1m": return stock.return1m;
    case "3m": return stock.return3m;
    case "6m": return stock.return6m;
    default: return stock.return1m; // Overall column shows 1M return
  }
}
function getSpyField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1d": return stock.spyReturn1d;
    case "1w": return stock.spyReturn1w;
    case "1m": return stock.spyReturn1m;
    case "3m": return stock.spyReturn3m;
    case "6m": return stock.spyReturn6m;
    default: return stock.spyReturn1m;
  }
}

function rsColor(val: number | null): string {
  if (val === null) return "text-muted-foreground";
  if (val >= 10) return "text-[hsl(160,80%,45%)] font-bold";
  if (val >= 5) return "text-[hsl(160,70%,50%)]";
  if (val > 0) return "text-[hsl(160,60%,55%)]";
  if (val < -5) return "text-destructive font-semibold";
  if (val < 0) return "text-destructive/80";
  return "text-muted-foreground";
}
function rsBg(val: number | null): string {
  if (val === null) return "";
  if (val >= 10) return "bg-[hsl(160,80%,45%)]/10";
  if (val >= 5) return "bg-[hsl(160,70%,50%)]/5";
  if (val < -5) return "bg-destructive/5";
  return "";
}
function pctDisplay(val: number | null): string {
  if (val === null) return "N/A";
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
}

export default function RsAlpha() {
  const {
    stocks, isLoading, isRebuilding, isPaused, isMutatingScan,
    isRecalculating, recalcStatus,
    error, progress, rebuildUniverse, pauseScan, recalculateRs,
  } = useRsAlpha();
  const fundScan = useFundamentalsScan();
  const [activeTab, setActiveTab] = useState<TabId>("overall");
  const [showAll, setShowAll] = useState(false);
  const [sortField, setSortField] = useState<SortField>("rs");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [customListOpen, setCustomListOpen] = useState(false);
  const [sectorDistOpen, setSectorDistOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [hideOtc, setHideOtc] = useState<boolean>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("rs-hide-otc") : null;
    return saved === null ? true : saved === "true";
  });
  const [weights, setWeights] = useState<RsWeights>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_RS_WEIGHTS };
    try {
      const raw = localStorage.getItem(RS_WEIGHTS_KEY);
      if (!raw) return { ...DEFAULT_RS_WEIGHTS };
      const parsed = JSON.parse(raw);
      return {
        w1d: Number(parsed.w1d ?? DEFAULT_RS_WEIGHTS.w1d),
        w1w: Number(parsed.w1w ?? DEFAULT_RS_WEIGHTS.w1w),
        w1m: Number(parsed.w1m ?? DEFAULT_RS_WEIGHTS.w1m),
        w3m: Number(parsed.w3m ?? DEFAULT_RS_WEIGHTS.w3m),
        w6m: Number(parsed.w6m ?? DEFAULT_RS_WEIGHTS.w6m),
      };
    } catch {
      return { ...DEFAULT_RS_WEIGHTS };
    }
  });

  useEffect(() => { setShowAll(false); }, [activeTab]);
  useEffect(() => { localStorage.setItem("rs-hide-otc", String(hideOtc)); }, [hideOtc]);
  useEffect(() => { localStorage.setItem(RS_WEIGHTS_KEY, JSON.stringify(weights)); }, [weights]);

  // Heuristic: 5-letter all-caps tickers ending in 'F' are typically foreign OTC (e.g., FKURF).
  // Also defensively block any symbol with OTC suffixes that may have slipped through historically.
  const isOtcSymbol = (sym: string): boolean => {
    if (!sym) return false;
    if (/\.(PK|OTC|OB)$/i.test(sym)) return true;
    if (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F")) return true;
    return false;
  };

  // Compute custom Overall RS using user-defined weights (auto-rebalance for missing timeframes).
  const computeCustomOverall = (s: RsStock): number | null => {
    const parts: { v: number; w: number }[] = [];
    if (s.rs1d !== null && weights.w1d > 0) parts.push({ v: s.rs1d, w: weights.w1d });
    if (s.rs1w !== null && weights.w1w > 0) parts.push({ v: s.rs1w, w: weights.w1w });
    if (s.rs1m !== null && weights.w1m > 0) parts.push({ v: s.rs1m, w: weights.w1m });
    if (s.rs3m !== null && weights.w3m > 0) parts.push({ v: s.rs3m, w: weights.w3m });
    if (s.rs6m !== null && weights.w6m > 0) parts.push({ v: s.rs6m, w: weights.w6m });
    if (parts.length === 0) return null;
    const tw = parts.reduce((sum, p) => sum + p.w, 0);
    if (tw <= 0) return null;
    return Math.round(parts.reduce((sum, p) => sum + p.v * (p.w / tw), 0) * 100) / 100;
  };

  const getRsForTab = (s: RsStock, tab: TabId): number | null => {
    if (tab === "overall") return computeCustomOverall(s);
    return getRsField(s, tab);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  // Filter, then compute RS Rating (1-99) by ranking within the filtered list for the active timeframe.
  const { sortedStocks, ratingMap } = useMemo(() => {
    const filtered = stocks.filter(s => {
      if (getRsForTab(s, activeTab) === null) return false;
      if (hideOtc && isOtcSymbol(s.symbol)) return false;
      return true;
    });
    const rsValues = filtered.map(s => getRsForTab(s, activeTab));
    const ratings = computeRsRatings(rsValues);
    const map = new Map<string, number | null>();
    filtered.forEach((s, i) => map.set(s.symbol, ratings[i]));

    const sorted = [...filtered].sort((a, b) => {
      const mul = sortDir === "desc" ? -1 : 1;
      switch (sortField) {
        case "symbol": return mul * a.symbol.localeCompare(b.symbol);
        case "company": return mul * (a.companyName ?? "").localeCompare(b.companyName ?? "");
        case "rs": return mul * ((getRsForTab(a, activeTab) ?? -999) - (getRsForTab(b, activeTab) ?? -999));
        case "rating": return mul * ((map.get(a.symbol) ?? -1) - (map.get(b.symbol) ?? -1));
        case "stockReturn": return mul * ((getReturnField(a, activeTab) ?? -999) - (getReturnField(b, activeTab) ?? -999));
        case "spyReturn": return mul * ((getSpyField(a, activeTab) ?? -999) - (getSpyField(b, activeTab) ?? -999));
        case "price": return mul * ((a.price ?? 0) - (b.price ?? 0));
        default: return 0;
      }
    });
    return { sortedStocks: sorted, ratingMap: map };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, activeTab, sortField, sortDir, hideOtc, weights]);

  const otcHiddenCount = useMemo(
    () => hideOtc ? stocks.filter(s => isOtcSymbol(s.symbol) && getRsForTab(s, activeTab) !== null).length : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stocks, hideOtc, activeTab, weights]
  );

  const displayStocks = showAll ? sortedStocks : sortedStocks.slice(0, 25);
  const hasMore = sortedStocks.length > 25;

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className={`inline-flex items-center gap-1 text-left font-medium text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      {label}
      {sortField === field ? (
        sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
  );

  const rebuildPctDone = progress.totalQueued > 0
    ? Math.min(100, Math.round((progress.processed / progress.totalQueued) * 100))
    : 0;

  const formatEta = (sec: number | null): string => {
    if (sec === null || sec <= 0) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `~${h}h ${m}m remaining`;
    return `~${m}m remaining`;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <ArrowLeft size={16} />
            </Link>
            <h1 className="font-['Syne',sans-serif] text-xl font-bold tracking-tight text-foreground">RS Alpha Watchlist</h1>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground"><Info size={14} /></span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[340px] text-xs">
                  <p className="font-semibold mb-1">Relative Strength (RS)</p>
                  <p className="text-muted-foreground mb-2">
                    RS = Stock % return − SPY % return for each timeframe.
                    1D uses live scan data; 1M / 3M / 6M use Yahoo Finance with a 24h cache.
                  </p>
                  <p className="font-semibold mb-1">Overall weighting</p>
                  <p className="text-muted-foreground">50% × 1M + 30% × 3M + 20% × 6M (weights auto-rebalance if a timeframe is missing).</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            {/* Start / Resume / Continue */}
            {!isRebuilding && (
              <button
                onClick={() => rebuildUniverse("resume")}
                disabled={isMutatingScan}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                title={isPaused ? "Resume the paused scan" : "Start or continue the qualified universe scan"}
              >
                {isMutatingScan ? (
                  <><Loader2 size={12} className="animate-spin" /> Working…</>
                ) : isPaused ? (
                  <><Play size={12} /> Resume Scan</>
                ) : progress.totalQueued > 0 && progress.processed < progress.totalQueued ? (
                  <><Play size={12} /> Continue Scan</>
                ) : (
                  <><Hammer size={12} /> Update Stock List</>
                )}
              </button>
            )}

            {/* Pause */}
            {isRebuilding && (
              <button
                onClick={() => pauseScan()}
                disabled={isMutatingScan}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                title="Pause the scan (resumable later)"
              >
                {isMutatingScan ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
                Pause Scan
              </button>
            )}

            {/* Restart from scratch */}
            {progress.totalQueued > 0 && (
              <button
                onClick={() => {
                  if (confirm("Restart the scan from scratch? This wipes existing progress and re-fetches the full US universe.")) {
                    rebuildUniverse("restart");
                  }
                }}
                disabled={isMutatingScan}
                className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="Wipe progress and restart from scratch"
              >
                <RotateCcw size={12} />
              </button>
            )}

            {activeTab === "overall" && (
              <OverallWeightsPanel
                weights={weights}
                onChange={setWeights}
                onReset={() => setWeights({ ...DEFAULT_RS_WEIGHTS })}
              />
            )}

            <button
              onClick={recalculateRs}
              disabled={isRecalculating || isRebuilding || stocks.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {isRecalculating ? (
                <><Loader2 size={12} className="animate-spin" /> {recalcStatus || "Recalculating…"}</>
              ) : (
                <><RefreshCw size={12} /> Recalculate RS Scores</>
              )}
            </button>

            {/* ── Pull Fundamentals for Universe ── */}
            {!fundScan.isRunning && (
              <button
                onClick={() => {
                  if (stocks.length === 0) {
                    toast.error("Run 'Update Stock List' first to build the qualified universe.");
                    return;
                  }
                  // Completed → restart fresh; otherwise resume existing queue
                  const mode =
                    fundScan.isComplete || fundScan.progress.totalQueued === 0
                      ? "restart"
                      : "resume";
                  fundScan.startScan(mode);
                }}
                disabled={fundScan.isMutating || stocks.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/20 disabled:opacity-50"
                title="Pull fundamentals (EPS, revenue, P/E, margins...) from Yahoo + Finnhub for every qualified stock. Runs in background."
              >
                {fundScan.isMutating ? (
                  <><Loader2 size={12} className="animate-spin" /> Working…</>
                ) : fundScan.isComplete ? (
                  <><RefreshCw size={12} /> Re-scan Fundamentals</>
                ) : fundScan.isPaused ? (
                  <><Play size={12} /> Resume Fundamentals</>
                ) : fundScan.progress.totalQueued > 0 && fundScan.progress.processed < fundScan.progress.totalQueued ? (
                  <><Play size={12} /> Continue Fundamentals</>
                ) : (
                  <><Database size={12} /> Pull Fundamentals for Universe</>
                )}
              </button>
            )}
            {fundScan.isRunning && (
              <button
                onClick={() => fundScan.pauseScan()}
                disabled={fundScan.isMutating}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                title="Pause the fundamentals scan (resumable later)"
              >
                {fundScan.isMutating ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
                Pause Fundamentals
              </button>
            )}
            {fundScan.progress.totalQueued > 0 && (
              <button
                onClick={() => setCoverageOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="View % coverage per metric across the scanned universe"
              >
                <BarChart3 size={12} /> Coverage
              </button>
            )}

            <HelpButton />
          </div>
        </div>

        {/* Filter banner */}
        <div className="container pb-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <Filter size={11} className="shrink-0" />
              <span>
                Showing RS rankings from <strong className="text-foreground">{sortedStocks.length}</strong> qualified stocks
                (Market Cap &gt; ${RS_FILTER_THRESHOLDS.MIN_MARKET_CAP / 1000}B
                {" · "}Avg Dollar Volume &gt; ${(RS_FILTER_THRESHOLDS.MIN_DOLLAR_VOLUME / 1_000_000).toFixed(0)}M
                {" · "}Avg Daily Range &gt; {RS_FILTER_THRESHOLDS.MIN_AVG_DAILY_RANGE}%
                {" · "}Price &gt; ${RS_FILTER_THRESHOLDS.MIN_PRICE})
              </span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Hide OTC / Pink Sheet tickers (e.g. 5-letter foreign symbols ending in F)">
              <span className={hideOtc ? "text-foreground font-medium" : ""}>Hide OTC Stocks</span>
              <button
                type="button"
                role="switch"
                aria-checked={hideOtc}
                onClick={() => setHideOtc(v => !v)}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${hideOtc ? "bg-primary" : "bg-muted-foreground/30"}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-background transition-transform ${hideOtc ? "translate-x-3.5" : "translate-x-0.5"}`} />
              </button>
              {hideOtc && otcHiddenCount > 0 && (
                <span className="text-[10px] text-muted-foreground">({otcHiddenCount} hidden)</span>
              )}
            </label>
          </div>
        </div>

        {/* Rebuild progress bar */}
        {(isRebuilding || isPaused || (progress.totalQueued > 0 && progress.processed < progress.totalQueued)) && (
          <div className="container pb-2">
            <div className={`rounded-md border px-3 py-2 text-xs ${isPaused ? "border-amber-500/30 bg-amber-500/5" : "border-accent/30 bg-accent/5"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-foreground font-medium">
                  {isPaused ? <Pause size={11} className="mr-1 inline text-amber-500" /> : <Hammer size={11} className="mr-1 inline" />}
                  {isPaused ? "Scan paused" : "Building qualified universe"} — {rebuildPctDone}%
                </span>
                <span className="text-muted-foreground">
                  {progress.processed.toLocaleString()} / {progress.totalQueued.toLocaleString()} symbols · {progress.qualified} qualified · {progress.failed} failed
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className={`h-full transition-all ${isPaused ? "bg-amber-500/60" : "bg-primary"}`} style={{ width: `${rebuildPctDone}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {isPaused
                    ? "Click Resume Scan to continue from where it stopped."
                    : "~50 symbols/min · runs server-side · safe to close this tab."}
                </span>
                {!isPaused && progress.etaSeconds !== null && (
                  <span className="font-medium">{formatEta(progress.etaSeconds)}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {progress.status === "complete" && progress.totalQueued > 0 && !isRebuilding && (
          <div className="container pb-2">
            <div className="rounded-md border border-[hsl(160,70%,50%)]/30 bg-[hsl(160,70%,50%)]/5 px-3 py-1.5 text-xs text-[hsl(160,70%,50%)]">
              ✓ Universe rebuild complete — {progress.qualified} stocks meet all four criteria.
            </div>
          </div>
        )}

        {/* Fundamentals scan progress bar */}
        {!fundScan.isComplete && (fundScan.isRunning || fundScan.isPaused || (fundScan.progress.totalQueued > 0 && fundScan.progress.processed < fundScan.progress.totalQueued)) && (
          <div className="container pb-2">
            <div className={`rounded-md border px-3 py-2 text-xs ${fundScan.isPaused ? "border-amber-500/30 bg-amber-500/5" : "border-accent/30 bg-accent/5"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-foreground font-medium">
                  {fundScan.isPaused ? <Pause size={11} className="mr-1 inline text-amber-500" /> : <Database size={11} className="mr-1 inline" />}
                  {fundScan.isPaused ? "Fundamentals scan paused" : "Pulling fundamentals (Yahoo + Finnhub)"} — {fundScan.progress.totalQueued > 0 ? Math.min(100, Math.round((fundScan.progress.processed / fundScan.progress.totalQueued) * 100)) : 0}%
                </span>
                <span className="text-muted-foreground">
                  {fundScan.progress.processed.toLocaleString()} / {fundScan.progress.totalQueued.toLocaleString()} stocks · {fundScan.progress.succeeded} saved · {fundScan.progress.failed} failed
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all ${fundScan.isPaused ? "bg-amber-500/60" : "bg-accent"}`}
                  style={{ width: `${fundScan.progress.totalQueued > 0 ? Math.min(100, (fundScan.progress.processed / fundScan.progress.totalQueued) * 100) : 0}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {fundScan.isPaused
                    ? "Click Resume Fundamentals to continue from where it stopped."
                    : "~50 symbols/min · runs server-side · safe to close this tab."}
                </span>
                {!fundScan.isPaused && fundScan.progress.etaSeconds !== null && (
                  <span className="font-medium">{formatEta(fundScan.progress.etaSeconds)}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {fundScan.isComplete && fundScan.progress.totalQueued > 0 && !fundScan.isRunning && (
          <div className="container pb-2">
            <div className="rounded-md border border-[hsl(160,70%,50%)]/30 bg-[hsl(160,70%,50%)]/5 px-3 py-1.5 text-xs text-[hsl(160,70%,50%)] flex items-center justify-between">
              <span>✓ Fundamentals scan completed — {fundScan.progress.processed.toLocaleString()} stocks processed · {fundScan.progress.succeeded.toLocaleString()} saved · {fundScan.progress.failed} failed.</span>
              <button onClick={() => setCoverageOpen(true)} className="text-foreground underline-offset-2 hover:underline">View Coverage →</button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="container pb-2">
          <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSortField("rs"); setSortDir("desc"); }}
                className={`relative rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                  activeTab === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label} Best RS
                {activeTab === tab.id && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container py-5">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Recommendation note */}
        <div className="mb-4 rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Run <em>Rebuild Qualified Universe</em> once per week (or when market conditions shift) to refresh the stock pool. The scan runs in the background and may take several hours. Use <em>Recalculate RS Scores</em> daily for fresh rankings on the existing universe.
        </div>

        {isLoading && stocks.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
          </div>
        ) : stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-20 text-center">
            <h3 className="text-lg font-semibold text-foreground mb-1">No Qualified Universe Yet</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Click <em>Rebuild Qualified Universe</em> to scan the full US market and find stocks meeting all four quality criteria.
              The scan runs in the background and takes 6–10 hours; results stream in as stocks qualify.
            </p>
            <button onClick={() => rebuildUniverse("resume")} disabled={isMutatingScan} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {isMutatingScan ? "Starting…" : "Update Stock List"}
            </button>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Qualified Stocks</div>
                <div className="text-xl font-bold text-foreground">{sortedStocks.length}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Positive RS</div>
                <div className="text-xl font-bold text-[hsl(160,70%,50%)]">
                  {sortedStocks.filter(s => (getRsForTab(s, activeTab) ?? 0) > 0).length}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Negative RS</div>
                <div className="text-xl font-bold text-destructive">
                  {sortedStocks.filter(s => (getRsForTab(s, activeTab) ?? 0) < 0).length}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Top RS Score</div>
                <div className="text-xl font-bold text-[hsl(160,70%,50%)]">
                  {sortedStocks.length > 0 ? pctDisplay(getRsForTab(sortedStocks[0], activeTab)) : "—"}
                </div>
              </div>
            </div>

            {/* Export to TradingView */}
            {sortedStocks.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <div className="text-[11px] text-muted-foreground">
                  Exports all <strong className="text-foreground">{sortedStocks.length}</strong> tickers in this timeframe for easy import into TradingView.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const symbols = sortedStocks.map(s => s.symbol);
                      const text = symbols.join(",");
                      try {
                        await navigator.clipboard.writeText(text);
                        toast.success(`${symbols.length} symbols copied to clipboard.`, {
                          description: "Paste into TradingView Watchlist → Import symbols.",
                        });
                      } catch {
                        toast.error("Could not copy to clipboard.");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    title="Copy comma-separated tickers"
                  >
                    <Copy size={12} /> Export to TradingView (Copy)
                  </button>
                  <button
                    onClick={() => {
                      const symbols = sortedStocks.map(s => s.symbol);
                      const blob = new Blob([symbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const tabLabel = TABS.find(t => t.id === activeTab)?.label.replace(/\s+/g, "") ?? activeTab;
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `RS_${tabLabel}_BestRS_${symbols.length}tickers.txt`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(`Downloaded ${symbols.length} symbols.`, {
                        description: "One ticker per line — ready for TradingView import.",
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Download .txt with one ticker per line"
                  >
                    <Download size={12} /> Download .txt
                  </button>
                  <button
                    onClick={() => setSectorDistOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent/25"
                    title="View interactive GICS sector breakdown of this list"
                  >
                    <PieChartIcon size={12} /> Sector Distribution
                  </button>
                  <button
                    onClick={() => setCustomListOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/25"
                    title="Open custom filters to build a refined TradingView list"
                  >
                    <Settings2 size={12} /> Create Custom TradingView List
                  </button>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-2.5 text-left"><SortHeader field="symbol" label="Ticker" /></th>
                      <th className="px-3 py-2.5 text-center"><SortHeader field="rating" label="RS Rating" className="justify-center" /></th>
                      <th className="px-3 py-2.5 text-left"><SortHeader field="company" label="Company" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="rs" label="RS Score" className="justify-end" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="stockReturn" label="Stock Return" className="justify-end" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="spyReturn" label="SPY Return" className="justify-end" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="price" label="Price" className="justify-end" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayStocks.map((stock, idx) => {
                      const rs = getRsForTab(stock, activeTab);
                      const ret = getReturnField(stock, activeTab);
                      const spy = getSpyField(stock, activeTab);
                      const rating = ratingMap.get(stock.symbol) ?? null;
                      return (
                        <tr key={stock.symbol} className={`border-b border-border/50 transition-colors hover:bg-muted/20 ${rsBg(rs)}`}>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono font-semibold text-foreground">{stock.symbol}</td>
                          <td className="px-3 py-2 text-center"><RsRatingBadge rating={rating} /></td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[240px] truncate" title={stock.companyName ?? ""}>
                            {stock.companyName ?? stock.sector ?? "—"}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono font-semibold ${rsColor(rs)}`}>{pctDisplay(rs)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${ret !== null && ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>
                            {pctDisplay(ret)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono text-xs ${spy !== null && spy >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>
                            {pctDisplay(spy)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {stock.price !== null ? `$${stock.price.toFixed(2)}` : "N/A"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {hasMore && !showAll && (
                <div className="border-t border-border p-3 text-center">
                  <button onClick={() => setShowAll(true)} className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                    Show All {sortedStocks.length} Stocks
                  </button>
                </div>
              )}
              {showAll && hasMore && (
                <div className="border-t border-border p-3 text-center">
                  <button onClick={() => setShowAll(false)} className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                    Show Top 25 Only
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <CustomTradingViewListModal
        open={customListOpen}
        onOpenChange={setCustomListOpen}
        tabId={activeTab}
        tabLabel={`${TABS.find(t => t.id === activeTab)?.label ?? ""} Best RS`}
        stocks={sortedStocks}
        ratingMap={ratingMap}
        getRsForTab={getRsForTab}
        getReturnField={getReturnField}
        isOtcSymbol={isOtcSymbol}
      />

      <SectorDistributionModal
        open={sectorDistOpen}
        onOpenChange={setSectorDistOpen}
        tabId={activeTab}
        tabLabel={`${TABS.find(t => t.id === activeTab)?.label ?? ""} Best RS`}
        stocks={sortedStocks}
        ratingMap={ratingMap}
        getRsForTab={getRsForTab}
        getReturnField={getReturnField}
        isOtcSymbol={isOtcSymbol}
      />

      <FundamentalsCoverageModal open={coverageOpen} onClose={() => setCoverageOpen(false)} />
    </div>
  );
}
