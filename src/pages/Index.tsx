import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getProcessedThemes, ThemeData } from "@/data/themeData";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeCard from "@/components/ThemeCard";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import ValidateTickersDialog from "@/components/ValidateTickersDialog";
import { RefreshCw, Download, TrendingUp, TrendingDown, Wifi, WifiOff, Loader2, Settings, ScanLine, X, ShieldCheck, Save, Zap, Calendar, Brain, Eye, Bookmark, Bell } from "lucide-react";
import { useFullScan } from "@/hooks/useFullScan";
import { useEodSave } from "@/hooks/useEodSave";
import { useSaveEodFromScan } from "@/hooks/useSaveEodFromScan";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Link } from "react-router-dom";

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
  const { pinned, alerts, getAlert } = useWatchlist();

  const {
    themes: allThemes,
    isLoading,
    isLive,
    lastFetched,
    rateLimited,
    symbolsFetched,
    usingCache,
    fetchLiveData,
    resetToDemo,
    setScanResults,
  } = useLiveThemeData(activeTimeframe);

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
      {/* ─── HEADER ──────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Best Performing Themes{" "}
              <span className="text-primary">{formatDate(lastFetched)}</span>
            </h1>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {isLive ? (
                <span className="inline-flex items-center gap-1 text-gain-medium">
                  <Wifi size={12} /> Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <WifiOff size={12} /> Demo data
                </span>
              )}
              {isLive && (
                rateLimited ? (
                  <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                    Finnhub: Rate limit
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-gain-medium/30 bg-gain-medium/10 px-1.5 py-0.5 text-[10px] font-semibold text-gain-medium">
                    Finnhub: OK
                  </span>
                )
              )}
              {usingCache && (
                <span className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  Using cached data
                </span>
              )}
              · Last updated: {formatTime(lastFetched)}
              · {themes.length} themes
              {isLive && ` · ${symbolsFetched} symbols`}
              {scanProgress && scanProgress.failed > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                  ⚠ {scanProgress.failed} tickers unavailable
                </span>
              )}
              {eodStatus?.alreadySaved && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  · EOD: {eodStatus.date}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Timeframe selector */}
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

            {/* Live / Demo toggle */}
            {isLive ? (
              <button
                onClick={resetToDemo}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Demo Data
              </button>
            ) : (
              <button
                onClick={() => fetchLiveData()}
                disabled={isLoading}
                className="rounded-md border border-gain-medium/40 bg-gain-medium/10 px-3 py-1.5 text-xs font-semibold text-gain-medium transition-colors hover:bg-gain-medium/20 disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> Fetching…
                  </span>
                ) : (
                  "Go Live (All)"
                )}
              </button>
            )}

            <button
              onClick={() => setShowSelector(!showSelector)}
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              {showSelector ? "Hide Selector" : "Select Themes"}
            </button>

            <button
              onClick={() => setShowPlaceholders(!showPlaceholders)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {showPlaceholders ? "Hide" : "Show"} Empty
            </button>
            <button
              onClick={handleExport}
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Export CSV"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setShowValidateDialog(true)}
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              title="Checks which tickers do not exist on Finnhub — helps clean up bad symbols"
            >
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={12} /> Validate
              </span>
            </button>
            <button
              onClick={startFullScan}
              disabled={isFullScanning || isLoading}
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              title="Update all themes sequentially with rate limit handling"
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
              <span className="inline-flex max-w-[260px] items-center gap-1 truncate text-[10px] text-muted-foreground" title={fullScanStatus}>
                {fullScanStatus}
                {!isFullScanning && fullScanStatus.includes("ticker") && (
                  <button
                    onClick={clearProgress}
                    className="ml-1 rounded p-0.5 text-destructive hover:bg-destructive/10"
                    title="Clear scan progress"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            )}

            {/* Save as EOD from scan */}
            {showSaveEodFromScan && !isFullScanning && (
              <div className="flex flex-col items-start gap-0.5">
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
                <span className={`text-[9px] leading-tight ${
                  eodAlreadySavedFromScan
                    ? "text-muted-foreground"
                    : scanAfterClose
                    ? "text-gain-medium/70"
                    : "text-[hsl(40,80%,50%)]/70"
                }`}>
                  {eodAlreadySavedFromScan
                    ? "✓ EOD already saved"
                    : scanAfterClose
                    ? "✓ Market closed — valid EOD"
                    : "⚠ Before market close"
                  }
                </span>
              </div>
            )}

            {/* Save EOD button */}
            {isEodSaving && eodProgress ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
                <Loader2 size={12} className="animate-spin" />
                {eodProgress.currentTheme?.startsWith("Retry") ? "Retrying" : "Saving EOD"}: {eodProgress.saved}/{eodProgress.total}
                {eodProgress.failed > 0 && (
                  <span className="text-[10px] text-destructive">· {eodProgress.failed} failed</span>
                )}
                {eodProgress.currentTheme && (
                  <span className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                    · {eodProgress.currentTheme}
                  </span>
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

            {/* Save Friday Close button — weekend only */}
            {eodStatus?.isWeekend && !isEodSaving && (
              <button
                onClick={() => startEodSave(true)}
                disabled={!canSaveFriday}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                title={fridayTooltip}
              >
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} /> Save Friday Close
                </span>
              </button>
            )}
            <button
              onClick={toggleEodAutoSave}
              className={`rounded-md border p-1.5 transition-colors ${
                eodAutoSave
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              title={eodAutoSave ? "Auto-save EOD: ON (triggers at 4:05 PM ET)" : "Auto-save EOD: OFF"}
            >
              <Zap size={14} />
            </button>
            <button
              onClick={() => isLive ? fetchLiveData() : undefined}
              disabled={isLoading || !isLive}
              className="rounded-md bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-30"
              title="Refresh"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            </button>
            <Link
              to="/intelligence"
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              title="Theme Intelligence"
            >
              <Brain size={14} />
              <span className="hidden sm:inline">Intelligence</span>
            </Link>
            <Link
              to="/watchlist"
              className="relative inline-flex items-center gap-1.5 rounded-md border border-[hsl(40,80%,50%)]/30 bg-[hsl(40,80%,50%)]/10 px-3 py-1.5 text-xs font-semibold text-[hsl(40,80%,50%)] transition-colors hover:bg-[hsl(40,80%,50%)]/20"
              title="Watchlist"
            >
              <Bookmark size={14} />
              <span className="hidden sm:inline">Watchlist</span>
              {pinned.length > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/20 px-1.5 py-0 text-[9px] font-bold text-primary">
                  {pinned.length}
                </span>
              )}
            </Link>
            <Link
              to="/eod-history"
              className="relative inline-flex items-center gap-1.5 rounded-md border border-gain-medium/30 bg-gain-medium/10 px-3 py-1.5 text-xs font-semibold text-gain-medium transition-colors hover:bg-gain-medium/20"
              title="EOD History"
            >
              <Calendar size={14} />
              <span className="hidden sm:inline">EOD</span>
              {eodStatus && !eodStatus.alreadySaved && !eodStatus.isWeekend && (
                <span className="h-2 w-2 rounded-full bg-[hsl(40,80%,50%)] animate-pulse" title="EOD not saved today" />
              )}
            </Link>
            <Link
              to="/admin"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Manage Themes & Tickers"
            >
              <Settings size={16} />
            </Link>
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
        {/* ─── STRONG THEMES ─────────────────────────── */}
        <Section
          icon={<TrendingUp size={18} />}
          title="Strong / Best Performing"
          accent="primary"
          themes={strong}
          onCardClick={setDrilldownTheme}
        />

        {/* ─── NEUTRAL ───────────────────────────────── */}
        {neutral.length > 0 && (
          <Section
            icon={<TrendingUp size={18} />}
            title="Neutral / Mixed"
            accent="muted"
            themes={neutral}
            onCardClick={setDrilldownTheme}
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
}: {
  icon: React.ReactNode;
  title: string;
  accent: "primary" | "destructive" | "muted";
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
}) {
  const accentColor =
    accent === "primary"
      ? "text-primary"
      : accent === "destructive"
      ? "text-destructive"
      : "text-muted-foreground";

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
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
        {themes.map((t, i) => (
          <ThemeCard key={t.theme_name} theme={t} index={i} onClick={onCardClick} />
        ))}
      </div>
    </section>
  );
}
