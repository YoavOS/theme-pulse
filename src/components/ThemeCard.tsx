import { useMemo, useEffect, Component, type ReactNode } from "react";
import { ThemeData } from "@/data/themeData";
import { Badge } from "@/components/ui/badge";
import { Pin } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlistContext";
import DemandSignals from "@/components/DemandSignals";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import { hasThemeBreadthEvent } from "@/hooks/useBreadthAlerts";
import { useVolumeDryUp } from "@/hooks/useVolumeDryUp";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";

class DemandSignalsBoundary extends Component<{ children: ReactNode; resetKey?: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidUpdate(prevProps: { resetKey?: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return <span className="mt-2 block text-[10px] text-muted-foreground">Volume data unavailable</span>;
    }
    return this.props.children;
  }
}

function getPctColor(pct: number): string {
  if (pct > 7) return "text-gain-strong";
  if (pct > 2) return "text-gain-medium";
  if (pct >= 0) return "text-gain-mild";
  if (pct > -3) return "text-loss-mild";
  return "text-loss-strong";
}

function getBarColors(ratio: number): { green: string; red: string; gradient: string } {
  const greenW = Math.round(ratio * 100);
  if (ratio >= 0.8) return { green: "hsl(var(--bar-green))", red: "transparent", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-track)) ${greenW}%` };
  if (ratio >= 0.5) return { green: "hsl(var(--bar-green))", red: "hsl(var(--bar-track))", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-red) / 0.4) ${greenW}%` };
  if (ratio >= 0.3) return { green: "hsl(var(--bar-green))", red: "hsl(var(--bar-red))", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-red)) ${greenW}%` };
  return { green: "transparent", red: "hsl(var(--bar-red))", gradient: `hsl(var(--bar-red) / 0.5) ${greenW}%, hsl(var(--bar-red)) ${greenW}%` };
}

function TickerChip({ symbol, pct, skipped, skipReason }: { symbol: string; pct: number; skipped?: boolean; skipReason?: string }) {
  if (skipped) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 font-mono text-[0.8rem] text-muted-foreground"
        title={`Skipped: ${skipReason || "unknown"}`}
      >
        <span className="font-semibold">{symbol}</span>
        <span className="text-destructive/70">N/A</span>
      </span>
    );
  }
  const color = pct >= 0 ? "text-gain-medium" : "text-loss-mild";
  const sign = pct >= 0 ? "+" : "";
  return (
    <a
      href={`https://www.tradingview.com/symbols/${symbol}/`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded bg-secondary/60 px-2 py-0.5 font-mono text-[0.8rem] transition-colors hover:bg-accent"
    >
      <span className="font-semibold text-foreground">{symbol}</span>
      <span className={color}>{sign}{pct.toFixed(2)}%</span>
    </a>
  );
}

export default function ThemeCard({ theme, index, onClick, fetchVolume, getThemeSignals, newsCount, newsNegative, onNewsBadgeClick, fundamentalScore, onFundamentalBadgeClick, newsSentiment }: {
  theme: ThemeData;
  index: number;
  onClick?: (theme: ThemeData) => void;
  fetchVolume?: (symbols: string[]) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  newsCount?: number;
  newsNegative?: boolean;
  onNewsBadgeClick?: (theme: ThemeData) => void;
  fundamentalScore?: number | null;
  onFundamentalBadgeClick?: (theme: ThemeData) => void;
  newsSentiment?: "bullish" | "bearish" | "mixed" | "neutral" | null;
}) {
  const { isPinned, togglePin } = useWatchlist();
  const themePinned = isPinned(theme.theme_name);
  const breadthEvent = useMemo(() => hasThemeBreadthEvent(theme.theme_name), [theme.theme_name]);
  const { isThemeDryingUp } = useVolumeDryUp();
  const isDryingUp = useMemo(() => isThemeDryingUp(theme.theme_name), [theme.theme_name, isThemeDryingUp]);
  const { getRelativeStrength } = useSpyBenchmark();
  const rs = useMemo(() => getRelativeStrength(theme.performance_pct), [theme.performance_pct, getRelativeStrength]);
  const rsFormatted = formatRS(rs);
  const validTickers = theme.tickers.filter(t => !t.skipped);
  const naTickers = theme.tickers.filter(t => t.skipped);
  const total = validTickers.length;
  const up = validTickers.filter(t => t.pct > 0).length;
  const down = validTickers.filter(t => t.pct <= 0).length;
  const ratio = total > 0 ? up / total : 0;
  const bar = getBarColors(ratio);
  const sign = theme.performance_pct >= 0 ? "+" : "";

  const tickerSymbols = useMemo(() => theme.tickers.map(t => t.symbol), [theme.tickers]);
  const signals = getThemeSignals ? getThemeSignals(tickerSymbols) : null;

  // Trigger volume fetch from ThemeCard so data loads regardless of DemandSignals render state
  useEffect(() => {
    if (fetchVolume && tickerSymbols.length > 0) {
      fetchVolume(tickerSymbols);
    }
  }, [tickerSymbols.join(","), fetchVolume]);

  // Sort tickers: non-skipped by absolute % desc, skipped at end. Show top 5.
  const sorted = [...theme.tickers].sort((a, b) => {
    if (a.skipped && !b.skipped) return 1;
    if (!a.skipped && b.skipped) return -1;
    return Math.abs(b.pct) - Math.abs(a.pct);
  });
  const MAX_VISIBLE = 5;
  const visibleTickers = sorted.slice(0, MAX_VISIBLE);
  const extraCount = sorted.length - MAX_VISIBLE;

  const isEmpty = total === 0 && theme.tickers.length === 0;
  const allSkipped = theme.tickers.length > 0 && total === 0;

  // Data source badge
  const isReal = theme.dataSource === "real";

  return (
    <div
      onClick={(e) => { if (onClick) onClick(theme); }}
      className={`group relative rounded-lg border bg-card px-3.5 py-3 transition-all hover:border-muted-foreground/30 hover:bg-surface-hover ${onClick ? "cursor-pointer" : ""}`}
      style={{
        animationDelay: `${index * 40}ms`,
        borderColor: themePinned ? "rgba(0,245,196,0.25)" : undefined,
        boxShadow: themePinned ? "0 0 8px rgba(0,245,196,0.08)" : undefined,
      }}
      title={isReal && theme.lastUpdated ? `Real data · Updated ${new Date(theme.lastUpdated).toLocaleTimeString()}` : "Demo/fallback data"}
    >
      {/* Pin button */}
      <button
        onClick={(e) => { e.stopPropagation(); togglePin(theme.theme_name); }}
        className={`absolute top-2 right-2 z-10 rounded p-1 transition-all ${
          themePinned
            ? "text-[#00f5c4] opacity-100"
            : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100"
        }`}
        title={themePinned ? "Unpin from watchlist" : "Pin to watchlist"}
      >
        <Pin size={12} className={themePinned ? "fill-current" : ""} />
      </button>

      {/* Row 1: Name + Percentage + Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[1.05rem] font-bold leading-tight text-foreground">
              {theme.theme_name}
            </h3>
            {isReal ? (
              <Badge variant="secondary" className="shrink-0 text-[9px] px-1.5 py-0 bg-gain-medium/15 text-gain-medium border-gain-medium/30">
                {total}/{theme.tickers.length}
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0 text-[9px] px-1.5 py-0 bg-muted text-muted-foreground">
                Demo
              </Badge>
            )}
            {breadthEvent && (
              <Badge
                variant="secondary"
                className={`shrink-0 text-[9px] px-1.5 py-0 ${
                  breadthEvent.type === "surge"
                    ? "bg-[#00f5c4]/15 text-[#00f5c4] border-[#00f5c4]/30"
                    : "bg-[#f5a623]/15 text-[#f5a623] border-[#f5a623]/30"
                }`}
                title={
                  breadthEvent.type === "surge"
                    ? `Breadth surged from ${breadthEvent.yesterdayBreadth}% → ${breadthEvent.todayBreadth}%`
                    : `Breadth collapsed from ${breadthEvent.yesterdayBreadth}% → ${breadthEvent.todayBreadth}%`
                }
              >
                {breadthEvent.type === "surge" ? "🔥 Surge" : "❄️ Collapse"}
              </Badge>
            )}
          </div>
          {theme.notes && (
            <span className="mt-0.5 inline-block text-[11px] text-muted-foreground italic leading-tight">
              {theme.notes}
            </span>
          )}
          {fundamentalScore != null && (
            <button
              onClick={(e) => { e.stopPropagation(); onFundamentalBadgeClick?.(theme); }}
              className={`mt-0.5 inline-flex items-center gap-0.5 rounded border px-1.5 py-0 text-[10px] font-semibold transition-colors cursor-pointer ${
                fundamentalScore >= 70 ? "text-primary bg-primary/10 border-primary/20 hover:bg-primary/15" :
                fundamentalScore >= 50 ? "text-gain-medium bg-gain-medium/10 border-gain-medium/20 hover:bg-gain-medium/15" :
                fundamentalScore >= 30 ? "text-[#f5a623] bg-[#f5a623]/10 border-[#f5a623]/20 hover:bg-[#f5a623]/15" :
                "text-destructive bg-destructive/10 border-destructive/20 hover:bg-destructive/15"
              }`}
              style={{ fontFamily: "'DM Mono', monospace" }}
              title={`Fundamental Score: ${fundamentalScore}/100 — ${
                fundamentalScore >= 70 ? "Good fundamentals" :
                fundamentalScore >= 50 ? "Mixed fundamentals" :
                "Weak fundamentals"
              }. Click to see details.`}
            >
              F:{fundamentalScore}
            </button>
          )}
        </div>
        <span className={`shrink-0 font-mono text-[1.85rem] font-bold leading-none tracking-tight ${getPctColor(theme.performance_pct)}`}>
          {sign}{theme.performance_pct.toFixed(2)}%
        </span>
      </div>

      {allSkipped ? (
        <p className="mt-2 text-xs text-destructive">No valid tickers — all {naTickers.length} skipped (invalid or rate-limited). Add real symbols.</p>
      ) : isEmpty ? (
        <p className="mt-2 text-xs text-muted-foreground">No data — placeholder theme</p>
      ) : (
        <>
          {/* Row 2: Progress bar */}
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-bar-track">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(ratio * 100)}%`,
                background: ratio >= 0.5 ? "hsl(var(--bar-green))" : `linear-gradient(90deg, ${bar.gradient})`,
              }}
            />
          </div>

          {/* Row 3: Up/Down/NA counts */}
          <div className="mt-1 flex items-center gap-3 text-[11px] font-medium">
            <span className="text-gain-medium">{up} up ↑</span>
            <span className="text-loss-mild">{down} down ↓</span>
            {naTickers.length > 0 && (
              <span className="text-muted-foreground">{naTickers.length} N/A</span>
            )}
            <span className="ml-auto text-muted-foreground">{Math.round(ratio * 100)}% advancing</span>
          </div>

          {/* vs SPY relative strength */}
          {theme.dataSource === "real" && (
            <div className={`text-[10px] font-medium mt-0.5 ${rsFormatted.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>
              {rsFormatted.text}
            </div>
          )}

          {/* Row 4: Tickers — single row, max 5 visible */}
          {visibleTickers.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
              {visibleTickers.map((t) => (
                <TickerChip key={t.symbol} symbol={t.symbol} pct={t.pct} skipped={t.skipped} skipReason={t.skipReason} />
              ))}
              {extraCount > 0 && (
                <span className="shrink-0 text-[10px] text-muted-foreground">+{extraCount} more</span>
              )}
            </div>
          )}

          {/* Row 5: Demand Signals */}
          {signals && (
            <DemandSignalsBoundary resetKey={theme.theme_name}>
              <DemandSignals signals={signals} />
            </DemandSignalsBoundary>
          )}

          {/* Row 6: News badge */}
          {newsCount != null && newsCount !== 0 && (
            <div className="mt-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); onNewsBadgeClick?.(theme); }}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  newsCount === -1
                    ? "text-muted-foreground bg-secondary/60 border border-border hover:bg-secondary"
                    : newsSentiment === "bullish"
                    ? "text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15"
                    : newsSentiment === "bearish"
                    ? "text-destructive bg-destructive/10 border border-destructive/20 hover:bg-destructive/15"
                    : newsSentiment === "mixed"
                    ? "text-[#f5a623] bg-[#f5a623]/10 border border-[#f5a623]/20 hover:bg-[#f5a623]/15"
                    : newsNegative
                    ? "text-destructive bg-destructive/10 border border-destructive/20 hover:bg-destructive/15"
                    : "text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15"
                }`}
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {newsSentiment === "bullish" ? "📈" : newsSentiment === "bearish" ? "📉" : newsSentiment === "mixed" ? "⚖️" : "📰"}
                {newsCount > 0 ? ` ${newsCount}` : ""}
              </button>
            </div>
          )}

          {/* Row 7: Volume Dry-Up badge */}
          {isDryingUp && (
            <div className="mt-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  color: "#f5a623",
                  background: "rgba(245, 166, 35, 0.08)",
                  border: "1px solid rgba(245, 166, 35, 0.2)",
                }}
              >
                📉 Vol drying up
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
