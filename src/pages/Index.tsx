import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ThemeData } from "@/data/themeData";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import ValidateTickersDialog from "@/components/ValidateTickersDialog";
import {
  RefreshCw, Download, Wifi, WifiOff, Loader2, Settings, ScanLine, X,
  ShieldCheck, Brain, ChevronDown, LayoutDashboard, AlertTriangle,
  BarChart3, Zap, Activity, DollarSign, Sun, Database,
} from "lucide-react";
import HeatmapGridView from "@/components/dashboard/HeatmapGridView";
import OverallBestThemesList from "@/components/dashboard/OverallBestThemesList";
import DashboardWeightsPanel, {
  DashboardWeights,
  DEFAULT_DASHBOARD_WEIGHTS,
} from "@/components/dashboard/DashboardWeightsPanel";

import DemoDataConfirmDialog from "@/components/DemoDataConfirmDialog";
import { getCacheAge } from "@/hooks/useScanCache";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useFullScan } from "@/hooks/useFullScan";
import { useVolumeData } from "@/hooks/useVolumeData";
import { Link } from "react-router-dom";
import HelpButton from "@/components/HelpButton";
import ThemeSearchBar from "@/components/ThemeSearchBar";
import { useThemeSearch } from "@/hooks/useThemeSearch";
import { useThemeNews } from "@/hooks/useThemeNews";
import { useFundamentals } from "@/hooks/useFundamentals";
import NewsPanel from "@/components/NewsPanel";

const TIMEFRAMES = ["Today", "1W", "1M", "3M", "Overall"] as const;
const DASHBOARD_WEIGHTS_KEY = "dashboard_overall_weights_v1";

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

  const { fetchVolume, getThemeSignals } = useVolumeData();
  const {
    fetchThemeNews, prefetchTopThemes, getThemeArticles,
    getAiSummary, getThemeSentiment,
  } = useThemeNews();
  const [newsPanelTheme, setNewsPanelTheme] = useState<ThemeData | null>(null);
  const [newsPanelSummary, setNewsPanelSummary] = useState<string | null>(null);
  const [newsPanelSummaryLoading, setNewsPanelSummaryLoading] = useState(false);
  const [newsPanelSentiment, setNewsPanelSentiment] = useState<import("@/hooks/useThemeNews").SentimentData | null>(null);
  const { fetchFundamentals, getCachedFundamentals, isLoading: isFundLoading } = useFundamentals();
  const [drilldownDefaultTab, setDrilldownDefaultTab] = useState<"tickers" | "news" | "fundamentals">("tickers");

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

  const { spy } = useSpyBenchmark();
  const {
    query: searchQuery, setQuery: setSearchQuery, isSearching,
    result: searchResult, clearSearch, runSearch, history: searchHistory,
  } = useThemeSearch(allThemes);

  const searchMatchSet = useMemo(() => {
    if (!searchResult) return null;
    return new Set(searchResult.matchingThemes.map(n => n.toLowerCase()));
  }, [searchResult]);

  const handleScanComplete = useCallback((themes: ThemeData[], timeframe: string) => {
    setScanResults(themes, timeframe);
  }, [setScanResults]);

  const {
    isRunning: isFullScanning,
    statusText: fullScanStatus,
    progress: scanProgress,
    startFullScan,
    clearProgress,
    loadTimeframe,
  } = useFullScan(handleScanComplete);

  const prevTimeframe = useRef(activeTimeframe);
  useEffect(() => {
    if (prevTimeframe.current !== activeTimeframe) {
      prevTimeframe.current = activeTimeframe;
      loadTimeframe(activeTimeframe).then((loaded) => {
        if (!loaded && !isLive && !isLoading) fetchLiveData();
      });
    }
  }, [activeTimeframe, isLive, isLoading, fetchLiveData, loadTimeframe]);

  const handleNewsBadgeClick = useCallback(async (theme: ThemeData) => {
    setNewsPanelTheme(theme);
    setNewsPanelSummary(null);
    setNewsPanelSummaryLoading(true);
    setNewsPanelSentiment(null);
    const symbols = theme.tickers.map(t => t.symbol);
    const articles = await fetchThemeNews(symbols);
    const summary = await getAiSummary(theme.theme_name, articles);
    setNewsPanelSummary(summary || null);
    setNewsPanelSummaryLoading(false);
    setNewsPanelSentiment(getThemeSentiment(theme.theme_name));
  }, [fetchThemeNews, getAiSummary, getThemeSentiment]);

  const themes = useMemo(() => {
    if (showPlaceholders) return allThemes;
    return allThemes.filter(
      (t) => t.tickers.length > 0 || t.up_count > 0 || t.down_count > 0
    );
  }, [allThemes, showPlaceholders]);

  // Prefetch news for the top 5 most-moving themes
  useEffect(() => {
    if (isLive && themes.length > 0) {
      const sorted = [...themes].sort(
        (a, b) => Math.abs(b.performance_pct) - Math.abs(a.performance_pct),
      );
      const top5 = sorted.slice(0, 5).map(t => ({
        name: t.theme_name,
        symbols: t.tickers.filter(tk => !tk.skipped).map(tk => tk.symbol),
      }));
      prefetchTopThemes(top5);
    }
  }, [isLive, themes, prefetchTopThemes]);

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

  // Trigger volume fetch once themes are loaded so signals are populated.
  useEffect(() => {
    if (!isLive || themes.length === 0) return;
    const allSymbols = themes.flatMap(t => t.tickers.filter(tk => !tk.skipped).map(tk => tk.symbol));
    if (allSymbols.length > 0) fetchVolume(allSymbols);
  }, [isLive, themes, fetchVolume]);

  const dashboardTabs = [
    { to: "/", label: "Dashboard", icon: <LayoutDashboard size={14} />, active: true, color: "" },
    { to: "/morning-brief", label: "Morning Brief", icon: <Sun size={14} />, active: false, color: "text-[hsl(40,90%,55%)]" },
    { to: "/intelligence", label: "Intelligence", icon: <Brain size={14} />, active: false, color: "text-primary" },
    { to: "/rs-alpha", label: "RS Alpha", icon: <Zap size={14} />, active: false, color: "text-[hsl(280,70%,60%)]" },
    { to: "/live", label: "Live Execution", icon: <Activity size={14} />, active: false, color: "text-[hsl(160,80%,45%)]" },
    { to: "/market-drivers", label: "Market Drivers", icon: <BarChart3 size={14} />, active: false, color: "text-[hsl(200,80%,55%)]" },
    { to: "/earnings", label: "Earnings", icon: <DollarSign size={14} />, active: false, color: "text-[hsl(40,90%,55%)]" },
    { to: "/storage", label: "Storage", icon: <Database size={14} />, active: false, color: "text-muted-foreground" },
  ];

  return (
    <div className="relative min-h-screen bg-background">
      {isStale && isLive && (
        <div className="border-b border-[hsl(40,80%,50%)]/30 bg-[hsl(40,80%,50%)]/10 px-4 py-2 text-center text-xs text-[hsl(40,80%,50%)]">
          <AlertTriangle size={12} className="mr-1 inline" />
          Showing data from {getCacheAge(lastFetched.toISOString())} — run a fresh scan for latest
        </div>
      )}

      <DemoDataConfirmDialog
        open={showDemoConfirm}
        onConfirm={() => { resetToDemo(); setShowDemoConfirm(false); }}
        onCancel={() => setShowDemoConfirm(false)}
      />

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container py-3">
          {/* Row 1: title + status */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
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
                      <p className="font-semibold mb-1">S&amp;P 500 Benchmark</p>
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
            </div>
          </div>

          {/* Search */}
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
          <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
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

            <div className="flex items-center gap-2">
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
              <HelpButton />
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
                        <Settings size={13} /> Manage Themes &amp; Tickers
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: tab navigation */}
          <div className="mt-3 flex items-center gap-1 border-t border-border/50 pt-2.5 flex-wrap">
            {dashboardTabs.map((tab) => (
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
              </Link>
            ))}
          </div>
        </div>
      </header>

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

      {showSelector && (
        <div className="container py-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Select Themes to Refresh ({selectedThemes.size} selected)
                </p>
                <p className="text-xs text-muted-foreground">
                  Finnhub free: 60 calls/min — plenty for normal use.
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

        {activeTimeframe === "Overall" ? (
          <OverallBestThemesList
            themes={searchMatchSet ? themes.filter(t => searchMatchSet.has(t.theme_name.toLowerCase())) : themes}
            onThemeClick={setDrilldownTheme}
          />
        ) : (
          <HeatmapGridView
            themes={themes}
            onCardClick={setDrilldownTheme}
            onInfoClick={(t) => { setDrilldownTheme(t); setDrilldownDefaultTab("news"); }}
            getThemeSignals={getThemeSignals}
            dimmedThemes={searchMatchSet}
          />
        )}

      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {isLive
          ? `Live data via Finnhub · ${symbolsFetched} symbols fetched`
          : "Demo data · Click \"Go Live\" to fetch real-time prices via Finnhub"}
      </footer>

      <ValidateTickersDialog open={showValidateDialog} onOpenChange={setShowValidateDialog} />
      <ThemeDrilldownModal
        theme={drilldownTheme}
        open={!!drilldownTheme}
        onOpenChange={(o) => { if (!o) { setDrilldownTheme(null); setDrilldownDefaultTab("tickers"); } }}
        newsArticles={drilldownTheme ? getThemeArticles(drilldownTheme.tickers.map(t => t.symbol)) : []}
        fetchNewsForTheme={fetchThemeNews}
        fundamentals={drilldownTheme ? getCachedFundamentals(drilldownTheme.tickers.filter(t => !t.skipped).map(t => t.symbol)) : null}
        fetchFundamentals={fetchFundamentals}
        isFundamentalsLoading={drilldownTheme ? isFundLoading(drilldownTheme.tickers.filter(t => !t.skipped).map(t => t.symbol)) : false}
        defaultTab={drilldownDefaultTab}
      />

      {newsPanelTheme && (
        <NewsPanel
          themeName={newsPanelTheme.theme_name}
          articles={getThemeArticles(newsPanelTheme.tickers.map(t => t.symbol))}
          onClose={() => { setNewsPanelTheme(null); setNewsPanelSentiment(null); }}
          aiSummary={newsPanelSummary}
          isLoadingSummary={newsPanelSummaryLoading}
          sentiment={newsPanelSentiment}
        />
      )}
    </div>
  );
}
