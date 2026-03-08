import { useMemo } from "react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";
import { SentimentData } from "@/hooks/useThemeNews";

const DM_MONO = "'DM Mono', monospace";

function getPctColor(pct: number): string {
  if (pct > 7) return "text-gain-strong";
  if (pct > 2) return "text-gain-medium";
  if (pct >= 0) return "text-gain-mild";
  if (pct > -3) return "text-loss-mild";
  return "text-loss-strong";
}

function getBreadthColor(pct: number): string {
  if (pct >= 80) return "text-gain-medium";
  if (pct >= 50) return "text-foreground";
  if (pct >= 30) return "text-[#f5a623]";
  return "text-destructive";
}

export default function RankedListView({
  themes,
  onCardClick,
  getThemeSignals,
  dimmedThemes,
  getNewsCount,
  getThemeFundamentalScore,
  getThemeSentiment,
}: {
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  dimmedThemes?: Set<string> | null;
  getNewsCount?: (symbols: string[]) => number;
  getThemeFundamentalScore?: (symbols: string[]) => number | null;
  getThemeSentiment?: (themeName: string) => SentimentData | null;
}) {
  const { getRelativeStrength } = useSpyBenchmark();

  const sorted = useMemo(() => {
    return [...themes].sort((a, b) => b.performance_pct - a.performance_pct);
  }, [themes]);

  return (
    <div className="space-y-0">
      {sorted.map((t, i) => {
        const isDimmed = dimmedThemes ? !dimmedThemes.has(t.theme_name.toLowerCase()) : false;
        const validTickers = t.tickers.filter(tk => !tk.skipped);
        const total = validTickers.length;
        const up = validTickers.filter(tk => tk.pct > 0).length;
        const down = validTickers.filter(tk => tk.pct <= 0).length;
        const breadthPct = total > 0 ? Math.round((up / total) * 100) : 0;
        const rs = getRelativeStrength(t.performance_pct);
        const rsF = formatRS(rs);
        const symbols = t.tickers.map(tk => tk.symbol);
        const signals = getThemeSignals ? getThemeSignals(symbols) : null;
        const fScore = getThemeFundamentalScore ? getThemeFundamentalScore(validTickers.map(tk => tk.symbol)) : null;
        const sentiment = getThemeSentiment ? getThemeSentiment(t.theme_name) : null;
        const sign = t.performance_pct >= 0 ? "+" : "";

        // Top 3 tickers by abs perf
        const top3 = [...validTickers].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 3);

        return (
          <div
            key={t.theme_name}
            onClick={() => onCardClick?.(t)}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50 cursor-pointer transition-all hover:bg-surface-hover hover:border-l-2 hover:border-l-primary"
            style={isDimmed ? { opacity: 0.3, filter: "grayscale(60%)" } : { minHeight: 48 }}
          >
            {/* Rank */}
            <span className="w-6 text-right text-xs text-muted-foreground shrink-0" style={{ fontFamily: DM_MONO }}>
              {i + 1}
            </span>

            {/* Name */}
            <span className="w-[140px] shrink-0 truncate text-sm font-semibold text-foreground font-['Syne',sans-serif]">
              {t.theme_name}
            </span>

            {/* Performance */}
            <span className={`w-[72px] shrink-0 text-right text-sm font-bold ${getPctColor(t.performance_pct)}`} style={{ fontFamily: DM_MONO }}>
              {sign}{t.performance_pct.toFixed(2)}%
            </span>

            {/* Breadth bar */}
            <div className="w-[60px] shrink-0">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-bar-track">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${breadthPct}%`,
                    background: breadthPct >= 50 ? "hsl(var(--bar-green))" : "hsl(var(--bar-red))",
                  }}
                />
              </div>
            </div>

            {/* Adv/Dec */}
            <span className="w-[48px] shrink-0 text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
              <span className="text-gain-medium">{up}↑</span>{" "}
              <span className="text-loss-mild">{down}↓</span>
            </span>

            {/* Breadth % */}
            <span className={`w-[32px] shrink-0 text-right text-[10px] font-semibold ${getBreadthColor(breadthPct)}`} style={{ fontFamily: DM_MONO }}>
              {breadthPct}%
            </span>

            {/* vs SPY */}
            {rs !== null && (
              <span className={`w-[52px] shrink-0 text-right text-[10px] font-medium ${rsF.color}`} style={{ fontFamily: DM_MONO }}>
                {rsF.text}
              </span>
            )}

            {/* Rel Vol */}
            {signals?.relVol != null && (
              <span
                className={`shrink-0 rounded px-1 py-0 text-[9px] font-semibold ${
                  signals.relVol > 1.4 ? "bg-primary/10 text-primary" : "bg-secondary/60 text-muted-foreground"
                }`}
                style={{ fontFamily: DM_MONO }}
              >
                {signals.relVol.toFixed(1)}×
              </span>
            )}

            {/* F score */}
            {fScore != null && (
              <span
                className={`shrink-0 rounded px-1 py-0 text-[9px] font-semibold ${
                  fScore >= 70 ? "text-primary bg-primary/10" :
                  fScore >= 50 ? "text-gain-medium bg-gain-medium/10" :
                  "text-[#f5a623] bg-[#f5a623]/10"
                }`}
                style={{ fontFamily: DM_MONO }}
              >
                F:{fScore}
              </span>
            )}

            {/* Top 3 tickers */}
            <div className="hidden lg:flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
              {top3.map((tk, j) => (
                <span key={tk.symbol} className="text-[10px] text-muted-foreground whitespace-nowrap" style={{ fontFamily: DM_MONO }}>
                  {j > 0 && "· "}
                  <span className="text-foreground font-medium">{tk.symbol}</span>{" "}
                  <span className={tk.pct >= 0 ? "text-gain-medium" : "text-loss-mild"}>
                    {tk.pct >= 0 ? "+" : ""}{tk.pct.toFixed(1)}%
                  </span>
                </span>
              ))}
            </div>

            {/* News sentiment */}
            {sentiment && (
              <span className="shrink-0 text-[11px]">
                {sentiment.sentiment === "bullish" ? "📈" : sentiment.sentiment === "bearish" ? "📉" : sentiment.sentiment === "mixed" ? "⚖️" : "📋"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
