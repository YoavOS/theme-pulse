import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pin, Bell, Check, X, Plus, Zap, Newspaper } from "lucide-react";
import { useWatchlist, AlertConfig } from "@/hooks/useWatchlistContext";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeCard from "@/components/ThemeCard";
import AddThemeModal from "@/components/AddThemeModal";
import { ThemeData } from "@/data/themeData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";
import { useThemeNews } from "@/hooks/useThemeNews";
import NewsPanel from "@/components/NewsPanel";

export default function Watchlist() {
  const { pinned, togglePin, alerts, setAlert, getAlert } = useWatchlist();
  const { themes } = useLiveThemeData("Today");
  const { getRelativeStrength } = useSpyBenchmark();
  const { fetchThemeNews, getThemeNewsCount, getThemeArticles, hasNegativeNews, getAiSummary, prefetchTopThemes, news } = useThemeNews();
  const [newsPanelTheme, setNewsPanelTheme] = useState<ThemeData | null>(null);
  const [newsPanelSummary, setNewsPanelSummary] = useState<string | null>(null);
  const [newsPanelSummaryLoading, setNewsPanelSummaryLoading] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<
    { themeName: string; message: string; type: "up" | "down" | "volume" }[]
  >([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [removingTheme, setRemovingTheme] = useState<string | null>(null);
  const [fadingOut, setFadingOut] = useState<Set<string>>(new Set());

  const pinnedThemes = useMemo(
    () => themes.filter(t => pinned.includes(t.theme_name)),
    [themes, pinned]
  );

  // Prefetch news for pinned themes (top 5 only)
  useEffect(() => {
    if (pinnedThemes.length > 0) {
      const top5 = pinnedThemes.slice(0, 5).map(t => ({
        name: t.theme_name,
        symbols: t.tickers.filter(tk => !tk.skipped).map(tk => tk.symbol),
      }));
      prefetchTopThemes(top5);
    }
  }, [pinnedThemes, prefetchTopThemes]);

  const handleNewsBadgeClick = useCallback(async (theme: ThemeData) => {
    setNewsPanelTheme(theme);
    setNewsPanelSummary(null);
    setNewsPanelSummaryLoading(true);
    const symbols = theme.tickers.map(t => t.symbol);
    const articles = await fetchThemeNews(symbols);
    const summary = await getAiSummary(theme.theme_name, articles);
    setNewsPanelSummary(summary || null);
    setNewsPanelSummaryLoading(false);
  }, [fetchThemeNews, getAiSummary]);

  // Breaking news check for pinned themes
  useEffect(() => {
    if (!news || pinnedThemes.length === 0) return;
    const lastChecked = JSON.parse(localStorage.getItem("news_last_checked") || "{}");
    const now = Date.now();

    for (const theme of pinnedThemes) {
      const symbols = theme.tickers.map(t => t.symbol);
      const articles = getThemeArticles(symbols);
      const lastCheck = lastChecked[theme.theme_name] || 0;

      const newArticles = articles.filter(a =>
        a.published_at && new Date(a.published_at).getTime() > lastCheck
      );

      if (newArticles.length > 0 && now - lastCheck > 30 * 60 * 1000) {
        toast(`📰 New news for ${theme.theme_name}`, {
          description: newArticles[0].headline.slice(0, 80),
          duration: 8000,
        });
      }

      lastChecked[theme.theme_name] = now;
    }

    localStorage.setItem("news_last_checked", JSON.stringify(lastChecked));
  }, [news, pinnedThemes, getThemeArticles]);

  useEffect(() => {
    checkAlerts();
  }, [pinnedThemes]);

  const checkAlerts = useCallback(async () => {
    const triggered: typeof triggeredAlerts = [];

    const { data: perfData } = await supabase
      .from("ticker_performance")
      .select("symbol, perf_1w");

    if (!perfData) return;

    const perfMap = new Map<string, number>();
    for (const p of perfData) perfMap.set(p.symbol, p.perf_1w || 0);

    const { data: themesDb } = await supabase.from("themes").select("id, name");
    const { data: tickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!themesDb || !tickers) return;

    const themeMap = new Map<string, string[]>();
    const idToName = new Map<string, string>();
    for (const t of themesDb) idToName.set(t.id, t.name);
    for (const tk of tickers) {
      const name = idToName.get(tk.theme_id);
      if (!name) continue;
      const arr = themeMap.get(name) || [];
      arr.push(tk.ticker_symbol);
      themeMap.set(name, arr);
    }

    // Fetch volume cache for Rel Vol alerts
    const allSymbols = [...new Set([...themeMap.values()].flat())];
    const { data: volData } = await supabase
      .from("ticker_volume_cache")
      .select("symbol, today_vol, avg_20d")
      .in("symbol", allSymbols.slice(0, 500));

    const volMap = new Map<string, { today_vol: number; avg_20d: number }>();
    if (volData) {
      for (const v of volData) {
        if (v.today_vol && v.avg_20d && v.avg_20d > 0) {
          volMap.set(v.symbol, { today_vol: v.today_vol, avg_20d: v.avg_20d });
        }
      }
    }

    for (const themeName of pinned) {
      const config = getAlert(themeName);
      const symbols = themeMap.get(themeName) || [];
      if (symbols.length === 0) continue;

      // 1W performance alerts
      if (config.up || config.down) {
        const perfs = symbols.map(s => perfMap.get(s) || 0).filter(Boolean);
        if (perfs.length > 0) {
          const avg1w = perfs.reduce((a, b) => a + b, 0) / perfs.length;
          if (config.up !== null && avg1w >= config.up) {
            triggered.push({
              themeName,
              message: `🔔 ${themeName} crossed +${config.up}% this week — currently ${avg1w >= 0 ? "+" : ""}${avg1w.toFixed(1)}%`,
              type: "up",
            });
          }
          if (config.down !== null && avg1w <= config.down) {
            triggered.push({
              themeName,
              message: `🔔 ${themeName} crossed ${config.down}% this week — currently ${avg1w >= 0 ? "+" : ""}${avg1w.toFixed(1)}%`,
              type: "down",
            });
          }
        }
      }

      // Rel Vol alerts
      if (config.relVol !== null) {
        const relVols = symbols
          .map(s => volMap.get(s))
          .filter((v): v is { today_vol: number; avg_20d: number } => !!v)
          .map(v => v.today_vol / v.avg_20d);

        if (relVols.length > 0) {
          const avgRelVol = relVols.reduce((a, b) => a + b, 0) / relVols.length;
          if (avgRelVol >= config.relVol) {
            triggered.push({
              themeName,
              message: `⚡ ${themeName} showing unusual volume — Rel Vol: ${avgRelVol.toFixed(1)}×`,
              type: "volume",
            });
          }
        }
      }
    }

    setTriggeredAlerts(triggered);
  }, [pinned, getAlert]);

  const dismissAlert = (index: number) => {
    setTriggeredAlerts(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemove = (themeName: string) => {
    setFadingOut(prev => new Set(prev).add(themeName));
    setTimeout(() => {
      togglePin(themeName);
      setFadingOut(prev => {
        const next = new Set(prev);
        next.delete(themeName);
        return next;
      });
      setRemovingTheme(null);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              Watchlist
            </h1>
            <span className="text-xs text-muted-foreground">
              {pinned.length} pinned
            </span>
            {triggeredAlerts.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-bold text-destructive">
                <Bell size={10} /> {triggeredAlerts.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <Plus size={14} />
            Add Theme
          </button>
        </div>
      </header>

      {/* Alert toasts */}
      {triggeredAlerts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {triggeredAlerts.map((alert, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs shadow-lg backdrop-blur-md ${
                alert.type === "volume"
                  ? "border-[#00f5c4]/30 bg-[#00f5c4]/10 text-[#00f5c4]"
                  : alert.type === "up"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-[hsl(40,80%,50%)]/30 bg-[hsl(40,80%,50%)]/10 text-[hsl(40,80%,50%)]"
              }`}
            >
              <span className="flex-1">{alert.message}</span>
              <button onClick={() => dismissAlert(i)} className="shrink-0 mt-0.5 opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="container py-6">
        {pinned.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div
              className="mb-4 rounded-lg border-2 border-dashed border-border p-8 animate-pulse"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <Pin size={32} className="text-muted-foreground mx-auto" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              No themes pinned yet — click 📌 on any theme card to add it here
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
            >
              <Plus size={16} />
              Browse & Add Themes
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
            {pinnedThemes.map((theme, i) => (
              <div
                key={theme.theme_name}
                className="transition-all duration-300"
                style={{
                  opacity: fadingOut.has(theme.theme_name) ? 0 : 1,
                  transform: fadingOut.has(theme.theme_name) ? "scale(0.95)" : "scale(1)",
                  maxHeight: fadingOut.has(theme.theme_name) ? "0px" : "500px",
                  overflow: "hidden",
                }}
              >
                <div className="relative">
                  <div style={{ boxShadow: "0 0 0 1px hsla(152,100%,50%,0.2), 0 0 12px hsla(152,100%,50%,0.08)" }} className="rounded-lg">
                    <ThemeCard
                      theme={theme}
                      index={i}
                      newsCount={getThemeNewsCount(theme.tickers.map(t => t.symbol))}
                      newsNegative={hasNegativeNews(theme.tickers.map(t => t.symbol))}
                      onNewsBadgeClick={handleNewsBadgeClick}
                    />
                  </div>
                  {/* vs SPY line below card */}
                  {theme.dataSource === "real" && (() => {
                    const rs = getRelativeStrength(theme.performance_pct);
                    const f = formatRS(rs);
                    return (
                      <div className={`mt-1 px-3 text-[10px] font-medium ${f.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                        {f.text}
                      </div>
                    );
                  })()}
                </div>
                <AlertRow
                  themeName={theme.theme_name}
                  config={getAlert(theme.theme_name)}
                  onSave={(c) => setAlert(theme.theme_name, c)}
                />
                {/* Remove link */}
                <div className="px-3 py-1.5 text-center">
                  {removingTheme === theme.theme_name ? (
                    <span className="text-[10px] text-muted-foreground">
                      Remove from watchlist?{" "}
                      <button
                        onClick={() => handleRemove(theme.theme_name)}
                        className="text-destructive font-semibold hover:underline"
                      >
                        Yes
                      </button>
                      {" / "}
                      <button
                        onClick={() => setRemovingTheme(null)}
                        className="text-muted-foreground hover:underline"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setRemovingTheme(theme.theme_name)}
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X size={10} /> Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <AddThemeModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        themes={themes}
      />

      {/* News Panel */}
      {newsPanelTheme && (
        <NewsPanel
          themeName={newsPanelTheme.theme_name}
          articles={getThemeArticles(newsPanelTheme.tickers.map(t => t.symbol))}
          onClose={() => setNewsPanelTheme(null)}
          aiSummary={newsPanelSummary}
          isLoadingSummary={newsPanelSummaryLoading}
        />
      )}
    </div>
  );
}

function AlertRow({
  themeName,
  config,
  onSave,
}: {
  themeName: string;
  config: AlertConfig;
  onSave: (c: AlertConfig) => void;
}) {
  const [up, setUp] = useState(config.up?.toString() || "");
  const [down, setDown] = useState(config.down ? Math.abs(config.down).toString() : "");
  const [relVol, setRelVol] = useState(config.relVol?.toString() || "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave({
      up: up ? parseFloat(up) : null,
      down: down ? -Math.abs(parseFloat(down)) : null,
      relVol: relVol ? parseFloat(relVol) : null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="mt-1 rounded-b-lg px-3 py-2 text-[11px]"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderTop: "none",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0">🔔 Alert if 1W &gt; +</span>
        <input
          type="number"
          value={up}
          onChange={e => setUp(e.target.value)}
          placeholder="5"
          className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
          style={{ fontFamily: "'DM Mono', monospace" }}
        />
        <span className="text-muted-foreground">% · &lt; −</span>
        <input
          type="number"
          value={down}
          onChange={e => setDown(e.target.value)}
          placeholder="3"
          className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
          style={{ fontFamily: "'DM Mono', monospace" }}
        />
        <span className="text-muted-foreground">%</span>
        <button
          onClick={handleSave}
          className="ml-auto rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {saved ? <Check size={10} className="text-primary" /> : "Set"}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-muted-foreground shrink-0 inline-flex items-center gap-0.5">
          <Zap size={9} className="text-[#00f5c4]" /> Rel Vol &gt;
        </span>
        <input
          type="number"
          step="0.1"
          value={relVol}
          onChange={e => setRelVol(e.target.value)}
          placeholder="1.8"
          className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
          style={{ fontFamily: "'DM Mono', monospace" }}
        />
        <span className="text-muted-foreground">×</span>
      </div>
    </div>
  );
}
