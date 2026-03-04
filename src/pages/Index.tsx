import { useState, useMemo } from "react";
import { getProcessedThemes, ThemeData } from "@/data/themeData";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeCard from "@/components/ThemeCard";
import { RefreshCw, Download, TrendingUp, TrendingDown, Wifi, WifiOff, Loader2, Settings } from "lucide-react";
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

  const {
    themes: allThemes,
    isLoading,
    isLive,
    lastFetched,
    rateLimited,
    symbolsFetched,
    fetchLiveData,
    resetToDemo,
  } = useLiveThemeData();

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
              · Last updated: {formatTime(lastFetched)}
              · {themes.length} themes
              {isLive && ` · ${symbolsFetched} symbols`}
              {rateLimited && (
                <span className="text-loss-mild"> · Rate limited</span>
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
                  "Go Live"
                )}
              </button>
            )}

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
              onClick={() => isLive ? fetchLiveData() : undefined}
              disabled={isLoading || !isLive}
              className="rounded-md bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20 disabled:opacity-30"
              title="Refresh"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            </button>
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
              <p className="text-sm font-medium text-foreground">Fetching live data from Alpha Vantage…</p>
              <p className="text-xs text-muted-foreground">
                Free tier: 5 requests/min. This may take a few minutes for all themes.
              </p>
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
        />

        {/* ─── NEUTRAL ───────────────────────────────── */}
        {neutral.length > 0 && (
          <Section
            icon={<TrendingUp size={18} />}
            title="Neutral / Mixed"
            accent="muted"
            themes={neutral}
          />
        )}

        {/* ─── WEAK THEMES ───────────────────────────── */}
        {weak.length > 0 && (
          <Section
            icon={<TrendingDown size={18} />}
            title="Weaker / Lagging"
            accent="destructive"
            themes={weak}
          />
        )}
      </main>

      {/* ─── FOOTER ──────────────────────────────────── */}
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {isLive
          ? `Live data via Alpha Vantage · ${symbolsFetched} symbols fetched`
          : "Demo data · Click \"Go Live\" to fetch real-time prices from Alpha Vantage"
        }
      </footer>
    </div>
  );
}

function Section({
  icon,
  title,
  accent,
  themes,
}: {
  icon: React.ReactNode;
  title: string;
  accent: "primary" | "destructive" | "muted";
  themes: ThemeData[];
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
      <div className="grid gap-3 sm:grid-cols-2">
        {themes.map((t, i) => (
          <ThemeCard key={t.theme_name} theme={t} index={i} />
        ))}
      </div>
    </section>
  );
}
