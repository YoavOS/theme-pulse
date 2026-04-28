// ─────────────────────────────────────────────────────────────────────────────
// ThemeMomentumPanel
//
// Right-side slide-in panel triggered by the "i" button on a heatmap theme
// card. Shows the Theme Momentum Index (0-100), a metrics breakdown, and the
// existing AI summary + news feed for that theme — keeping the same look &
// feel as the rest of the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { X, Activity, ExternalLink, Newspaper, Bot } from "lucide-react";
import type { ThemeData } from "@/data/themeData";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useThemeMomentumIndex, type ThemeMomentumBreakdown } from "@/hooks/useThemeMomentumIndex";
import type { NewsArticle, SentimentData } from "@/hooks/useThemeNews";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function pctClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "text-muted-foreground";
  if (v > 0.1) return "text-primary";
  if (v < -0.1) return "text-destructive";
  return "text-muted-foreground";
}

function scoreColor(score: number, rating: string) {
  if (rating === "Insufficient Data") return { color: "hsl(220, 5%, 55%)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)" };
  if (score >= 70) return { color: "hsl(170, 90%, 50%)", bg: "rgba(0, 245, 196, 0.08)", border: "rgba(0, 245, 196, 0.25)" };
  if (score >= 45) return { color: "hsl(40, 90%, 55%)", bg: "rgba(245, 166, 35, 0.08)", border: "rgba(245, 166, 35, 0.25)" };
  return { color: "hsl(0, 75%, 60%)", bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.25)" };
}

function ComponentRow({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  const has = value !== null && Number.isFinite(value);
  const v = has ? Math.round(value as number) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground" title={hint}>{label}</span>
        <span
          className="font-bold tabular-nums"
          style={{ fontFamily: DM_MONO, color: has ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
        >
          {has ? `${v}/100` : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-full transition-all"
          style={{
            width: `${has ? v : 0}%`,
            background: !has
              ? "transparent"
              : v >= 70 ? "hsl(170, 90%, 45%)"
              : v >= 45 ? "hsl(40, 80%, 50%)"
              : "hsl(0, 70%, 50%)",
          }}
        />
      </div>
    </div>
  );
}

function MetricTile({ label, primary, sub, color }: { label: string; primary: string; sub?: string; color?: string }) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className="mt-0.5 text-lg font-bold tabular-nums leading-tight"
        style={{ fontFamily: DM_MONO, color: color ?? "hsl(var(--foreground))" }}
      >
        {primary}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

interface Props {
  theme: ThemeData | null;
  open: boolean;
  onClose: () => void;
  // News
  articles: NewsArticle[];
  aiSummary: string | null;
  isLoadingSummary: boolean;
  sentiment: SentimentData | null;
  // Optional analytics inputs
  fundamentalsBySymbol?: Map<string, StockFundamentals>;
  relVolBySymbol?: Map<string, number>;
}

export default function ThemeMomentumPanel({
  theme,
  open,
  onClose,
  articles,
  aiSummary,
  isLoadingSummary,
  sentiment,
  fundamentalsBySymbol,
  relVolBySymbol,
}: Props) {
  const { spy } = useSpyBenchmark();
  const { breakdown, isLoading } = useThemeMomentumIndex(theme, spy, {
    fundamentalsBySymbol,
    relVolBySymbol,
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[460px] overflow-y-auto p-0 border-l border-border bg-background"
      >
        {theme && (
          <PanelBody
            theme={theme}
            breakdown={breakdown}
            isLoading={isLoading}
            articles={articles}
            aiSummary={aiSummary}
            isLoadingSummary={isLoadingSummary}
            sentiment={sentiment}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({
  theme,
  breakdown,
  isLoading,
  articles,
  aiSummary,
  isLoadingSummary,
  sentiment,
  onClose,
}: {
  theme: ThemeData;
  breakdown: ThemeMomentumBreakdown | null;
  isLoading: boolean;
  articles: NewsArticle[];
  aiSummary: string | null;
  isLoadingSummary: boolean;
  sentiment: SentimentData | null;
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const by: Record<string, NewsArticle[]> = {};
    for (const a of articles) {
      const k = a.symbol || "Market";
      if (!by[k]) by[k] = [];
      if (by[k].length < 5) by[k].push(a);
    }
    return by;
  }, [articles]);

  const score = breakdown?.score ?? 0;
  const rating = breakdown?.rating ?? "Insufficient Data";
  const sc = scoreColor(score, rating);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={16} className="text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Theme Momentum Index</div>
            <h3 className="truncate text-sm font-bold text-foreground" style={{ fontFamily: SYNE }}>
              {theme.theme_name}
            </h3>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Score block */}
      <div
        className="mx-4 mt-3 rounded-lg px-4 py-4"
        style={{ background: sc.bg, border: `1px solid ${sc.border}` }}
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Momentum Score</div>
            {isLoading && !breakdown ? (
              <Skeleton className="h-10 w-24 mt-1" />
            ) : (
              <div
                className="font-bold tabular-nums leading-none"
                style={{ fontFamily: DM_MONO, color: sc.color, fontSize: "44px" }}
              >
                {rating === "Insufficient Data" ? "—" : score}
                {rating !== "Insufficient Data" && (
                  <span className="text-base font-medium text-muted-foreground ml-1">/100</span>
                )}
              </div>
            )}
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: sc.color, background: "rgba(0,0,0,0.25)", border: `1px solid ${sc.border}` }}
          >
            {rating}
          </span>
        </div>
        {/* Big progress bar */}
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${rating === "Insufficient Data" ? 0 : score}%`, background: sc.color }}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          Balanced blend of average RS, growth-stock %, volume consistency, and relative performance vs SPY.
        </p>
      </div>

      {/* Component breakdown */}
      <div className="mx-4 mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Score Breakdown</div>
        <div className="space-y-2.5">
          <ComponentRow
            label="Avg RS Rating"
            value={breakdown?.components.avgRs ?? null}
            hint="Average RS Rating (0-99) of the theme's stocks, normalized to 0-100."
          />
          <ComponentRow
            label="% Passing Growth Filter"
            value={breakdown?.components.growthPass ?? null}
            hint="% of theme stocks (with fundamentals) that pass the Growth Stocks filter (rev/EPS growth + profitability)."
          />
          <ComponentRow
            label="Volume Consistency"
            value={breakdown?.components.volConsist ?? null}
            hint="% of theme stocks trading at >= 1.0× their 20-day average volume."
          />
          <ComponentRow
            label="Relative Strength vs SPY"
            value={breakdown?.components.relSpy ?? null}
            hint="Theme performance vs SPY blended across 1D/1W/1M/3M (centered at 50, ±5% = ±50 pts)."
          />
        </div>
      </div>

      {/* Key Metrics */}
      <div className="mx-4 mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Key Metrics</div>
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            label="Avg RS Rating"
            primary={breakdown?.avgRsRating != null ? `${breakdown.avgRsRating}` : "—"}
            sub={breakdown?.avgRsRating != null ? "out of 99" : "no RS data"}
          />
          <MetricTile
            label="Growth Stocks"
            primary={
              breakdown && breakdown.evaluatedStockCount > 0
                ? `${breakdown.growthStocksCount}/${breakdown.evaluatedStockCount}`
                : "—"
            }
            sub={breakdown && breakdown.growthPassPct != null ? `${Math.round(breakdown.growthPassPct)}% pass` : "no fundamentals"}
          />
          <MetricTile
            label="Stocks in Theme"
            primary={`${breakdown?.validTickerCount ?? theme.tickers.filter(t => !t.skipped).length}`}
            sub={`${theme.tickers.length} total`}
          />
          <MetricTile
            label="Vol Consistency"
            primary={breakdown?.components.volConsist != null ? `${Math.round(breakdown.components.volConsist)}%` : "—"}
            sub="≥1.0× rel vol"
          />
        </div>

        {/* vs SPY across timeframes */}
        <div
          className="mt-2 rounded-md px-3 py-2"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Theme vs SPY</div>
          <div className="grid grid-cols-4 gap-2 text-center" style={{ fontFamily: DM_MONO }}>
            {(["d1", "w1", "m1", "m3"] as const).map((k) => {
              const labels = { d1: "1D", w1: "1W", m1: "1M", m3: "3M" } as const;
              const v = breakdown?.relSpy[k] ?? null;
              return (
                <div key={k}>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{labels[k]}</div>
                  <div className={`text-sm font-bold ${pctClass(v)}`}>{fmtPct(v)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sentiment + AI summary */}
      <div className="mx-4 mt-4">
        {sentiment && (
          <SentimentBar sentiment={sentiment} />
        )}
        {(aiSummary || isLoadingSummary) && (
          <div
            className="mt-2 rounded-lg p-3"
            style={{ background: "rgba(0, 245, 196, 0.06)", border: "1px solid rgba(0, 245, 196, 0.15)" }}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Bot size={12} className="text-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI Summary</span>
            </div>
            {isLoadingSummary && !aiSummary ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-3 w-[75%]" />
              </div>
            ) : (
              <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{aiSummary}</p>
            )}
          </div>
        )}
      </div>

      {/* News feed */}
      <div className="mx-4 mt-4 mb-6">
        <div className="flex items-center gap-1.5 mb-2">
          <Newspaper size={12} className="text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">News</span>
        </div>
        {articles.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No recent news for this theme's tickers.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([sym, arts]) => (
              <div key={sym}>
                <div className="mb-1.5">
                  <span
                    className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-foreground"
                    style={{ fontFamily: DM_MONO }}
                  >
                    {sym}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {arts.map((a, i) => (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-md p-2 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {a.headline}
                        </p>
                        <ExternalLink
                          size={10}
                          className="shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        {a.source && <span>{a.source}</span>}
                        {a.published_at && <span>· {timeAgo(a.published_at)}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentimentBar({ sentiment }: { sentiment: SentimentData }) {
  const config = {
    bullish: { emoji: "📈", title: "Bullish News Flow", bg: "rgba(0, 245, 196, 0.08)", border: "rgba(0, 245, 196, 0.2)", text: "text-primary" },
    bearish: { emoji: "📉", title: "Bearish News Flow", bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.2)", text: "text-destructive" },
    mixed: { emoji: "⚖️", title: "Mixed Signals", bg: "rgba(245, 166, 35, 0.08)", border: "rgba(245, 166, 35, 0.2)", text: "text-[#f5a623]" },
    neutral: { emoji: "📋", title: "Neutral Coverage", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", text: "text-muted-foreground" },
  }[sentiment.sentiment] || { emoji: "📋", title: "Neutral Coverage", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", text: "text-muted-foreground" };

  return (
    <div className="rounded-lg p-3" style={{ background: config.bg, border: `1px solid ${config.border}` }}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${config.text}`}>
          {config.emoji} {config.title}
        </span>
        <span className="text-[10px] font-bold text-muted-foreground" style={{ fontFamily: DM_MONO }}>
          {sentiment.score}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--destructive)), hsl(var(--destructive)) 35%, #facc15 50%, hsl(var(--primary)) 65%, hsl(var(--primary)))",
            opacity: 0.3,
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-background shadow-md"
          style={{
            left: `${Math.max(2, Math.min(98, sentiment.score))}%`,
            transform: "translate(-50%, -50%)",
            background: sentiment.score > 65 ? "hsl(var(--primary))" : sentiment.score < 35 ? "hsl(var(--destructive))" : "#facc15",
          }}
        />
      </div>
      {sentiment.reasoning && (
        <p className="text-[10px] text-muted-foreground mt-1.5">{sentiment.reasoning}</p>
      )}
    </div>
  );
}
