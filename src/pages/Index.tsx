import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getProcessedThemes, ThemeData } from "@/data/themeData";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeCard from "@/components/ThemeCard";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import ValidateTickersDialog from "@/components/ValidateTickersDialog";
import { RefreshCw, Download, TrendingUp, TrendingDown, Wifi, WifiOff, Loader2, Settings, ScanLine, X, ShieldCheck, Save, Zap, Calendar, Brain, Bookmark, Bell, ChevronDown, LayoutDashboard, AlertTriangle } from "lucide-react";
import DemoDataConfirmDialog from "@/components/DemoDataConfirmDialog";
import { getCacheAge } from "@/hooks/useScanCache";
import { useDispersion, getDispersionColorClass } from "@/hooks/useDispersion";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";
import { useFullScan } from "@/hooks/useFullScan";
import { useEodSave } from "@/hooks/useEodSave";
import { useSaveEodFromScan } from "@/hooks/useSaveEodFromScan";
import { useWatchlist } from "@/hooks/useWatchlistContext";
import { useVolumeData } from "@/hooks/useVolumeData";
import { Link } from "react-router-dom";
import HelpButton from "@/components/HelpButton";
import ThemeSearchBar from "@/components/ThemeSearchBar";
import { useThemeSearch } from "@/hooks/useThemeSearch";

const TIMEFRAMES = ["Today", "1W", "1M", "3M", "YTD"] as const;

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}
function formatTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function Index() {
  const [activeTimeframe, setActiveTimeframe] = useState<string>("Today");
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());
  const [showSelector, setShowSelector] = useState(false);
  const [showValidateDialog, setShowValidateDialog] = useState(false);
  const [drilldownTheme, setDrilldownTheme] = useState<ThemeData | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showDemoConfirm, setShowDemoConfirm] = useState(false);
  const { pinned, alerts, getAlert } = useWatchlist();
  const { fetchVolume, getThemeSignals } = useVolumeData();

  const {
    themes: allThemes,
    isLoading,
    isLive,
    lastFetched,
    rateLimited,
    symbolsFetched,
    usingCache,
    isStale,
    fetchLiveData,
    resetToDemo,
    setScanResults,
  } = useLiveThemeData(activeTimeframe);

  const dispersion = useDispersion(allThemes);
  const { spy, getRelativeStrength } = useSpyBenchmark();
  const { query: searchQuery, setQuery: setSearchQuery, isSearching, result: searchResult, clearSearch, runSearch, history: searchHistory } = useThemeSearch(allThemes);

  const searchMatchSet = useMemo(() => {
    if (!searchResult) return null;
    return new Set(searchResult.matchingThemes.map(n => n.toLowerCase()));
  }, [searchResult]);

  // Full scan handler: receives themes + timeframe from scan
  const handleScanComplete = useCallback((themes: ThemeData[], timeframe: string) => {
    setScanResults(themes, timeframe);
  }, [setScanResults]);

  const {
    isRunning: isFullScanning,
    statusText: fullScanStatus,
    progress: scanProgress,
    scanCompletedAt,
    startFullScan,
    clearProgress,
    loadTimeframe,
  } = useFullScan(handleScanComplete);

  const {
    showButton: showSaveEodFromScan,
    isSaving: isSavingEodFromScan,
    isAfterClose: scanAfterClose,
    alreadySavedToday: eodAlreadySavedFromScan,
    tooltip: saveEodFromScanTooltip,
    saveEodFromScan,
  } = useSaveEodFromScan(scanCompletedAt);

  const {
    status: eodStatus,
    progress: eodProgress,
    isSaving: isEodSaving,
    canSave: canSaveEod,
    canSaveFriday,
    tooltip: eodTooltip,
    fridayTooltip,
    fridayLastSavedAt,
    autoSave: eodAutoSave,
    startEodSave,
    toggleAutoSave: toggleEodAutoSave,
  } = useEodSave();

  // When timeframe changes, try to load from scan cache
  const prevTimeframe = useRef(activeTimeframe);
  useEffect(() => {
    if (prevTimeframe.current !== activeTimeframe) {
      prevTimeframe.current = activeTimeframe;
      // Try loading from scan performance cache
      loadTimeframe(activeTimeframe).then((loaded) => {
        if (!loaded && !isLive && !isLoading) {
          fetchLiveData();
        }
      });
    }
  }, [activeTimeframe, isLive, isLoading, fetchLiveData, loadTimeframe]);

  const themes = useMemo(() => {
    if (showPlaceholders) return allThemes;
    return allThemes.filter(
      (t) => t.tickers.length > 0 || t.up_count > 0 || t.down_count > 0
    );
  }, [allThemes, showPlaceholders]);

  const strong = themes.filter((t) => t.category === "Strong");
  const neutral = themes.filter((t) => t.category === "Neutral");
  const weak = themes.filter((t) => t.category === "Weak");

  const nonEmptyThemeNames = allThemes
    .filter((t) => t.tickers.length > 0 || t.up_count > 0 || t.down_count > 0)
    .map((t) => t.theme_name);

  const toggleTheme = (name: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelectedThemes(new Set(nonEmptyThemeNames));
  const selectNone = () => setSelectedThemes(new Set());

  const handleExport = () => {
    const rows = themes.map((t) =>
      [t.rank, t.theme_name, t.performance_pct, t.up_count, t.down_count, t.category, t.notes || ""].join(",")
    );
    const csv = "Rank,Theme,Performance%,Up,Down,Category,Notes\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `themes_${formatDate(lastFetched).replace(/\//g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Stale data banner */}
      {isStale && isLive && (
        <div className="border-b border-[hsl(40,80%,50%)]/30 bg-[hsl(40,80%,50%)]/10 px-4 py-2 text-center text-xs text-[hsl(40,80%,50%)]">
          <AlertTriangle size={12} className="mr-1 inline" />
          Showing data from {getCacheAge(lastFetched.toISOString())} — run a fresh scan for latest
        </div>
      )}

      {/* Demo data confirmation */}
      <DemoDataConfirmDialog
        open={showDemoConfirm}
        onConfirm={() => { resetToDemo(); setShowDemoConfirm(false); }}
        onCancel={() => setShowDemoConfirm(false)}
      />
      {/* ─── ROW 1: Title + Status ──────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container py-3">
          {/* Row 1 */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                Best Performing Themes{" "}
                <span className="text-primary">{formatDate(lastFetched)}</span>
              </h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isLive ? (
                <span className="inline-flex items-center gap-1 text-gain-medium">
                  <Wifi size={12} /> Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <WifiOff size={12} /> Demo
                </span>
              )}
              {isLive && (
                rateLimited ? (
                  <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    Rate limited
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-gain-medium/30 bg-gain-medium/10 px-1.5 py-0.5 text-[10px] font-semibold text-gain-medium">
                    Finnhub OK
                  </span>
                )
              )}
              {usingCache && (
                <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] font-semibold">
                  Cached
                </span>
              )}
              {dispersion && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`inline-flex items-center gap-1 rounded border ${getDispersionColorClass(dispersion.score).border} ${getDispersionColorClass(dispersion.score).bg} px-1.5 py-0.5 text-[10px] font-semibold ${getDispersionColorClass(dispersion.score).text} cursor-help`}>
                        Dispersion: {dispersion.score.toFixed(1)}σ
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                      <p className="font-semibold mb-1">{dispersion.label}</p>
                      <p className="text-muted-foreground">{dispersion.tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {spy.perf_1d !== null && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-help ${
                        spy.perf_1d >= 0
                          ? "border-gain-medium/30 bg-gain-medium/10 text-gain-medium"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      }`}>
                        SPY: {spy.perf_1d >= 0 ? "+" : ""}{spy.perf_1d.toFixed(2)}%
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                      <p className="font-semibold mb-1">S&P 500 Benchmark</p>
                      <p className="text-muted-foreground">All "vs SPY" values compare theme performance to this index</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span className="hidden sm:inline">· {formatTime(lastFetched)}</span>
              <span className="hidden sm:inline">· {themes.length} themes</span>
              {isLive && <span className="hidden sm:inline">· {symbolsFetched} symbols</span>}
              {scanProgress && scanProgress.failed > 0 && (
                <span className="text-[10px] text-destructive">⚠ {scanProgress.failed} unavailable</span>
              )}
              {eodStatus?.alreadySaved && (
                <span className="text-[10px]">· EOD ✓</span>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="mt-2.5">
            <ThemeSearchBar
              query={searchQuery}
              setQuery={setSearchQuery}
              isSearching={isSearching}
              clearSearch={clearSearch}
              runSearch={runSearch}
              history={searchHistory}
            />
          </div>

          {/* Row 2: Timeframes + Actions */}
          <div className="mt-2.5 flex items-center justify-between gap-3">
            {/* Left: Timeframe pills */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border bg-secondary/50">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setActiveTimeframe(tf)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activeTimeframe === tf
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Primary actions */}
            <div className="flex items-center gap-2">
              {/* Full Scan */}
              <button
                onClick={startFullScan}
                disabled={isFullScanning || isLoading}
                className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                title="Update all themes sequentially"
              >
                {isFullScanning ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Scanning…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <ScanLine size={12} /> Full Scan
                  </span>
                )}
              </button>
              {fullScanStatus && (
                <span className="hidden sm:inline-flex max-w-[200px] items-center gap-1 truncate text-[10px] text-muted-foreground" title={fullScanStatus}>
                  {fullScanStatus}
                  {!isFullScanning && fullScanStatus.includes("ticker") && (
                    <button onClick={clearProgress} className="ml-1 rounded p-0.5 text-destructive hover:bg-destructive/10" title="Clear">
                      <X size={10} />
                    </button>
                  )}
                </span>
              )}

              {/* Save as EOD from scan */}
              {showSaveEodFromScan && !isFullScanning && (
                <button
                  onClick={saveEodFromScan}
                  disabled={eodAlreadySavedFromScan || isSavingEodFromScan}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    eodAlreadySavedFromScan
                      ? "border-border bg-secondary/50 text-muted-foreground"
                      : scanAfterClose
                      ? "border-gain-medium/40 bg-gain-medium/10 text-gain-medium hover:bg-gain-medium/20"
                      : "border-[hsl(40,80%,50%)]/40 bg-[hsl(40,80%,50%)]/10 text-[hsl(40,80%,50%)] hover:bg-[hsl(40,80%,50%)]/20"
                  }`}
                  title={saveEodFromScanTooltip}
                >
                  <span className="inline-flex items-center gap-1">
                    <Save size={12} />
                    {isSavingEodFromScan ? "Saving..." : "Save as EOD"}
                  </span>
                </button>
              )}

              {/* Save EOD */}
              {isEodSaving && eodProgress ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
                  <Loader2 size={12} className="animate-spin" />
                  {eodProgress.currentTheme?.startsWith("Retry") ? "Retrying" : "Saving"}: {eodProgress.saved}/{eodProgress.total}
                  {eodProgress.failed > 0 && (
                    <span className="text-[10px] text-destructive">· {eodProgress.failed} failed</span>
                  )}
                </span>
              ) : (
                <button
                  onClick={() => startEodSave(false)}
                  disabled={!canSaveEod}
                  className="relative rounded-md border border-gain-medium/40 bg-gain-medium/10 px-3 py-1.5 text-xs font-semibold text-gain-medium transition-colors hover:bg-gain-medium/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={eodTooltip}
                >
                  <span className="inline-flex items-center gap-1">
                    <Save size={12} /> Save EOD
                  </span>
                  {eodAutoSave && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary animate-pulse" title="Auto-save enabled" />
                  )}
                </button>
              )}

              {/* Friday Close — weekend only */}
              {eodStatus?.isWeekend && !isEodSaving && (
                <button
                  onClick={() => startEodSave(true)}
                  disabled={!canSaveFriday}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    fridayLastSavedAt
                      ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                      : "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                  }`}
                  title={fridayTooltip}
                >
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={12} />
                    {fridayLastSavedAt
                      ? `Re-save Friday Close · last saved at ${fridayLastSavedAt}`
                      : "Save Friday Close"}
                  </span>
                </button>
              )}

              {/* Auto-save toggle */}
              <button
                onClick={toggleEodAutoSave}
                className={`rounded-md border p-1.5 transition-colors ${
                  eodAutoSave
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={eodAutoSave ? "Auto-save EOD: ON" : "Auto-save EOD: OFF"}
              >
                <Zap size={14} />
              </button>

              {/* Help button */}
              <HelpButton />

              {/* Options dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowOptions(!showOptions)}
                  className="inline-flex items-center gap-1 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="More options"
                >
                  <Settings size={14} />
                  <ChevronDown size={10} className={`transition-transform ${showOptions ? "rotate-180" : ""}`} />
                </button>
                {showOptions && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowOptions(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-card p-1 shadow-xl">
                      {isLive ? (
                        <button
                          onClick={() => { setShowDemoConfirm(true); setShowOptions(false); }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <WifiOff size={13} /> Switch to Demo Data
                        </button>
                      ) : (
                        <button
                          onClick={() => { fetchLiveData(); setShowOptions(false); }}
                          disabled={isLoading}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-gain-medium hover:bg-accent transition-colors disabled:opacity-50"
                        >
                          <Wifi size={13} /> Go Live (All)
                        </button>
                      )}
                      <button
                        onClick={() => { setShowSelector(!showSelector); setShowOptions(false); }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <ScanLine size={13} /> {showSelector ? "Hide" : "Select"} Themes
                      </button>
                      <button
                        onClick={() => { setShowPlaceholders(!showPlaceholders); setShowOptions(false); }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <LayoutDashboard size={13} /> {showPlaceholders ? "Hide" : "Show"} Empty Themes
                      </button>
                      <button
                        onClick={() => { handleExport(); setShowOptions(false); }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <Download size={13} /> Export CSV
                      </button>
                      <button
                        onClick={() => { setShowValidateDialog(true); setShowOptions(false); }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <ShieldCheck size={13} /> Validate Tickers
                      </button>
                      <button
                        onClick={() => { isLive && fetchLiveData(); setShowOptions(false); }}
                        disabled={isLoading || !isLive}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30"
                      >
                        <RefreshCw size={13} /> Refresh Data
                      </button>
                      <div className="my-1 border-t border-border" />
                      <Link
                        to="/admin"
                        onClick={() => setShowOptions(false)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <Settings size={13} /> Manage Themes & Tickers
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Tab Navigation */}
          <div className="mt-3 flex items-center gap-1 border-t border-border/50 pt-2.5">
            {([
              { to: "/", label: "Dashboard", icon: <LayoutDashboard size={14} />, active: true, color: "", badge: null as number | null, pulse: false },
              { to: "/intelligence", label: "Intelligence", icon: <Brain size={14} />, active: false, color: "text-primary", badge: null, pulse: false },
              { to: "/watchlist", label: "Watchlist", icon: <Bookmark size={14} />, active: false, color: "text-[hsl(40,80%,50%)]",
                badge: pinned.length > 0 ? pinned.length : null, pulse: false },
              { to: "/eod-history", label: "EOD History", icon: <Calendar size={14} />, active: false, color: "text-gain-medium",
                badge: null, pulse: !!(eodStatus && !eodStatus.alreadySaved && !eodStatus.isWeekend) },
            ]).map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={`relative inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  tab.active
                    ? "bg-primary/10 text-primary border-b-2 border-primary"
                    : `text-muted-foreground hover:bg-accent hover:text-foreground ${tab.color}`
                }`}
              >
                <span className={tab.active ? "text-primary" : tab.color}>{tab.icon}</span>
                {tab.label}
                {tab.badge && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-[9px] font-bold text-primary">
                    {tab.badge}
                  </span>
                )}
                {tab.pulse && (
                  <span className="h-2 w-2 rounded-full bg-[hsl(40,80%,50%)] animate-pulse" title="EOD not saved today" />
                )}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Loading overlay */}
      {isLoading && (
        <div className="container py-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <Loader2 size={20} className="animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Fetching live data from Finnhub…</p>
              <p className="text-xs text-muted-foreground">
                Finnhub free tier: 60 calls/min. Should complete quickly.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── THEME SELECTOR ──────────────────────────── */}
      {showSelector && (
        <div className="container py-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Select Themes to Refresh ({selectedThemes.size} selected)
                </p>
              <p className="text-xs text-muted-foreground">
                  Select specific themes to refresh. Finnhub free: 60 calls/min — plenty for normal use.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={selectAll} className="text-xs text-primary hover:underline">All</button>
                <button onClick={selectNone} className="text-xs text-muted-foreground hover:underline">None</button>
                <button
                  onClick={() => fetchLiveData([...selectedThemes])}
                  disabled={isLoading || selectedThemes.size === 0}
                  className="rounded-md border border-gain-medium/40 bg-gain-medium/10 px-3 py-1.5 text-xs font-semibold text-gain-medium transition-colors hover:bg-gain-medium/20 disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> Fetching…
                    </span>
                  ) : (
                    `Refresh Selected (${selectedThemes.size})`
                  )}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nonEmptyThemeNames.map((name) => (
                <label
                  key={name}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    selectedThemes.has(name)
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedThemes.has(name)}
                    onChange={() => toggleTheme(name)}
                    className="sr-only"
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="container py-6">
        {/* Search results banner */}
        {searchResult && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="font-medium text-foreground">
              {searchResult.matchingThemes.length > 0
                ? `Showing ${searchResult.matchingThemes.length} theme${searchResult.matchingThemes.length === 1 ? "" : "s"} matching "${searchQuery}"`
                : `No themes match your query`}
            </span>
            {searchResult.explanation && (
              <span className="text-xs text-muted-foreground">· {searchResult.explanation}</span>
            )}
            <button onClick={clearSearch} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              Clear <X size={12} />
            </button>
          </div>
        )}

        {/* ─── STRONG THEMES ─────────────────────────── */}
        <Section
          icon={<TrendingUp size={18} />}
          title="Strong / Best Performing"
          accent="primary"
          themes={strong}
          onCardClick={setDrilldownTheme}
          fetchVolume={fetchVolume}
          getThemeSignals={getThemeSignals}
          dimmedThemes={searchMatchSet}
        />

        {/* ─── NEUTRAL ───────────────────────────────── */}
        {neutral.length > 0 && (
          <Section
            icon={<TrendingUp size={18} />}
            title="Neutral / Mixed"
            accent="muted"
            themes={neutral}
            onCardClick={setDrilldownTheme}
            fetchVolume={fetchVolume}
            getThemeSignals={getThemeSignals}
            dimmedThemes={searchMatchSet}
          />
        )}

        {/* ─── WEAK THEMES ───────────────────────────── */}
        {weak.length > 0 && (
          <Section
            icon={<TrendingDown size={18} />}
            title="Weaker / Lagging"
            accent="destructive"
            themes={weak}
            onCardClick={setDrilldownTheme}
            fetchVolume={fetchVolume}
            getThemeSignals={getThemeSignals}
            dimmedThemes={searchMatchSet}
          />
        )}
      </main>

      {/* ─── FOOTER ──────────────────────────────────── */}
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {isLive
          ? `Live data via Finnhub · ${symbolsFetched} symbols fetched`
          : "Demo data · Click \"Go Live\" to fetch real-time prices via Finnhub"
        }
      </footer>

      <ValidateTickersDialog open={showValidateDialog} onOpenChange={setShowValidateDialog} />
      <ThemeDrilldownModal theme={drilldownTheme} open={!!drilldownTheme} onOpenChange={(o) => { if (!o) setDrilldownTheme(null); }} />
    </div>
  );
}

function Section({
  icon,
  title,
  accent,
  themes,
  onCardClick,
  fetchVolume,
  getThemeSignals,
  dimmedThemes,
}: {
  icon: React.ReactNode;
  title: string;
  accent: "primary" | "destructive" | "muted";
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  fetchVolume?: (symbols: string[]) => void;
  getThemeSignals?: (symbols: string[]) => import("@/hooks/useVolumeData").ThemeDemandSignals;
  dimmedThemes?: Set<string> | null;
}) {
  const accentColor =
    accent === "primary"
      ? "text-primary"
      : accent === "destructive"
      ? "text-destructive"
      : "text-muted-foreground";

  // Compute aggregate volume badge for section
  let volBadge: React.ReactNode = null;
  if (getThemeSignals && themes.length > 0) {
    try {
      const relVols = themes
        .map(t => {
          const s = getThemeSignals(t.tickers.map(tk => tk.symbol));
          return s.relVol;
        })
        .filter((v): v is number => v !== null);
      if (relVols.length > 0) {
        const avgRel = relVols.reduce((a, b) => a + b, 0) / relVols.length;
        if (avgRel > 1.4) {
          volBadge = <span className="inline-flex items-center gap-0.5 rounded-full bg-[#00f5c4]/10 px-2 py-0.5 text-[10px] font-semibold text-[#00f5c4]">⚡ elevated volume</span>;
        } else if (avgRel < 0.8) {
          volBadge = <span className="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">low volume</span>;
        }
      }
    } catch {}
  }

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <span className={accentColor}>{icon}</span>
        <h2 className={`text-sm font-bold uppercase tracking-widest ${accentColor}`}>
          {title}
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {themes.length}
        </span>
        {volBadge}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
        {themes.map((t, i) => {
          const isDimmed = dimmedThemes ? !dimmedThemes.has(t.theme_name.toLowerCase()) : false;
          return (
            <div
              key={t.theme_name}
              className="transition-all duration-300"
              style={isDimmed ? { opacity: 0.3, filter: "grayscale(60%)" } : {}}
            >
              <ThemeCard theme={t} index={i} onClick={onCardClick} fetchVolume={fetchVolume} getThemeSignals={getThemeSignals} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
