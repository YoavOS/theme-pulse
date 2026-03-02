import { useState, useMemo } from "react";
import { demoThemes, getProcessedThemes, ThemeData } from "@/data/themeData";
import ThemeCard from "@/components/ThemeCard";
import { RefreshCw, Download, TrendingUp, TrendingDown } from "lucide-react";

const TIMEFRAMES = ["Today", "1W", "1M", "3M", "YTD"] as const;

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}
function formatTime(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function Index() {
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeTimeframe, setActiveTimeframe] = useState<string>("Today");
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  const themes = useMemo(() => {
    const processed = getProcessedThemes(demoThemes);
    if (showPlaceholders) return processed;
    return processed.filter(
      (t) => t.tickers.length > 0 || t.up_count > 0 || t.down_count > 0
    );
  }, [showPlaceholders]);

  const strong = themes.filter((t) => t.category === "Strong");
  const neutral = themes.filter((t) => t.category === "Neutral");
  const weak = themes.filter((t) => t.category === "Weak");

  const handleRefresh = () => setLastUpdated(new Date());

  const handleExport = () => {
    const rows = themes.map((t) =>
      [t.rank, t.theme_name, t.performance_pct, t.up_count, t.down_count, t.category, t.notes || ""].join(",")
    );
    const csv = "Rank,Theme,Performance%,Up,Down,Category,Notes\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `themes_${formatDate(lastUpdated).replace(/\//g, "-")}.csv`;
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
              <span className="text-primary">{formatDate(lastUpdated)}</span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Last updated: {formatTime(lastUpdated)} · {themes.length} themes tracked
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
              onClick={handleRefresh}
              className="rounded-md bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </header>

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
        Demo data only · Connect to Polygon.io, yfinance, or any REST API for live prices
        {/* 
          To make live:
          - Use yfinance.download() or polygon REST API for group % changes
          - theme_groups = {"Fiber Optics": ["AAOI","LITE","COHR",...], ...}
          - Compute equal-weight return for each group daily
          - Auto-refresh every 15 min via setInterval or cloud scheduler
        */}
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
