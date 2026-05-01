// ─────────────────────────────────────────────────────────────────────────────
// MoneyFlowTab — Theme RS approach
//
// Left  – Themes ranked by Theme RS for the selected timeframe
//         (Overall | 1W | 1M | 3M | 6M). Columns: Theme RS (0-99),
//         Performance vs SPY %, Avg stock RS, % Growth Stocks, Rel Vol, Trend.
// Right – Selected theme: RS score, sparkline vs SPY, AI summary, recent news,
//         "Why Money is Flowing" rationale grounded in RS + growth + volume.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Newspaper, ExternalLink, Sparkles, TrendingUp, Activity,
  Zap, Info, Target, ArrowUpRight, ArrowDownRight, Minus, Layers,
} from "lucide-react";
import type { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useStockFundamentalsMap } from "@/hooks/useStockFundamentalsMap";
import { useQualifiedRsMap } from "@/hooks/useQualifiedRsMap";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { passesGrowth } from "@/lib/growthFilters";
import {
  useThemeNews,
  type NewsArticle,
} from "@/hooks/useThemeNews";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

type RsTimeframe = "overall" | "1w" | "1m" | "3m" | "6m";

const TF_LABELS: Record<RsTimeframe, string> = {
  overall: "Overall",
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  "6m": "6M",
};

const TF_ORDER: RsTimeframe[] = ["overall", "1w", "1m", "3m", "6m"];

interface ThemeRow {
  theme: ThemeIntelData;
  // Raw average RS rating across constituent tickers for the active timeframe.
  // Comes from qualified_rs_universe (RS pts vs SPY, NOT 0-99).
  rawAvgRs: number | null;
  // 0-99 Theme RS score derived by ranking themes' rawAvgRs against each other.
  themeRs: number | null;
  // Average rs_overall (0-99 scale already, just averaged) for "Avg RS of stocks".
  avgStockRs: number | null;
  // Performance % vs SPY for the active timeframe (theme avg perf - SPY perf).
  perfVsSpy: number | null;
  // % Growth-passing stocks
  growthPct: number | null;
  growthPass: number;
  growthEval: number;
  // Relative volume
  relVol: number | null;
  // Trend: change in 1W RS vs 3M RS (>0 improving)
  trend: number | null;
}

function trendIcon(trend: number | null) {
  if (trend === null) return { icon: <Minus size={11} />, color: "hsl(var(--muted-foreground))", label: "—" };
  if (trend >= 3) return { icon: <ArrowUpRight size={12} />, color: "hsl(170, 80%, 50%)", label: "Improving" };
  if (trend <= -3) return { icon: <ArrowDownRight size={12} />, color: "hsl(0, 70%, 60%)", label: "Weakening" };
  return { icon: <Minus size={11} />, color: "hsl(var(--muted-foreground))", label: "Stable" };
}

function rsColor(r: number | null): string {
  if (r === null) return "hsl(var(--muted-foreground))";
  if (r >= 80) return "hsl(170, 90%, 50%)";
  if (r >= 60) return "hsl(170, 65%, 55%)";
  if (r >= 40) return "hsl(40, 90%, 55%)";
  return "hsl(0, 75%, 60%)";
}

function timeAgo(d: string | null | undefined): string {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Average a numeric field over a list, ignoring null/non-finite.
function avgField(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Pick the right per-ticker RS field for a given timeframe.
function rsFieldForTf(tf: RsTimeframe): "rs_overall" | "rs_1w" | "rs_1m" | "rs_3m" | "rs_6m" {
  if (tf === "overall") return "rs_overall";
  if (tf === "1w") return "rs_1w";
  if (tf === "1m") return "rs_1m";
  if (tf === "3m") return "rs_3m";
  return "rs_6m";
}

// Pick the right per-ticker performance field for a given timeframe.
function perfFieldForTf(tf: RsTimeframe): "perf_1w" | "perf_1m" | "perf_3m" | "perf_ytd" | null {
  if (tf === "1w") return "perf_1w";
  if (tf === "1m") return "perf_1m";
  if (tf === "3m") return "perf_3m";
  // overall + 6m: no native theme perf available → use perf_3m as the
  // closest available gauge for the vs-SPY column (or null when missing).
  if (tf === "overall") return "perf_3m";
  return null; // 6m
}

function spyPerfForTf(spy: ReturnType<typeof useSpyBenchmark>["spy"], tf: RsTimeframe): number | null {
  const f = perfFieldForTf(tf);
  if (!f) return null;
  return spy[f] ?? null;
}

export default function MoneyFlowTab({
  themes,
  isLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  const [tf, setTf] = useState<RsTimeframe>("overall");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { spy } = useSpyBenchmark();
  const { map: fundamentalsMap } = useStockFundamentalsMap();
  const { rsMap } = useQualifiedRsMap();
  const {
    fetchThemeNews, getThemeArticles, getAiSummary, aiSummaries, getThemeSentiment,
  } = useThemeNews();

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ── Compute per-theme metrics for the active timeframe ─────────────────
  const rows: ThemeRow[] = useMemo(() => {
    if (themes.length === 0) return [];

    const rsField = rsFieldForTf(tf);
    const perfField = perfFieldForTf(tf);
    const spyVal = spyPerfForTf(spy, tf);

    // Step 1: compute rawAvgRs per theme (for the active TF).
    const partials = themes.map((t) => {
      const rsValues: number[] = [];
      const overallValues: number[] = [];
      const rs1wValues: number[] = [];
      const rs3mValues: number[] = [];
      for (const sym of t.symbols) {
        const r = rsMap.get(sym);
        if (!r) continue;
        const v = r[rsField];
        if (v !== null && v !== undefined && Number.isFinite(v as number)) rsValues.push(v as number);
        if (r.rs_overall !== null && Number.isFinite(r.rs_overall)) overallValues.push(r.rs_overall);
        if (r.rs_1w !== null && Number.isFinite(r.rs_1w)) rs1wValues.push(r.rs_1w);
        if (r.rs_3m !== null && Number.isFinite(r.rs_3m)) rs3mValues.push(r.rs_3m);
      }
      const rawAvgRs = avgField(rsValues);
      const avgStockRs = avgField(overallValues);
      const avg1w = avgField(rs1wValues);
      const avg3m = avgField(rs3mValues);
      const trend = avg1w !== null && avg3m !== null ? avg1w - avg3m : null;

      // Theme avg perf for vs-SPY
      let themePerf: number | null = null;
      if (perfField) {
        const perfs = t.tickers
          .filter((tk) => tk.status === "done")
          .map((tk) => tk[perfField] as number);
        themePerf = avgField(perfs);
      }
      const perfVsSpy =
        themePerf !== null && spyVal !== null && Number.isFinite(spyVal)
          ? Math.round((themePerf - spyVal) * 100) / 100
          : null;

      // Growth %
      let growthPass = 0;
      let growthEval = 0;
      for (const tk of t.tickers) {
        if (tk.status !== "done") continue;
        const f = fundamentalsMap.get(tk.symbol);
        if (!f) continue;
        growthEval++;
        if (passesGrowth(f)) growthPass++;
      }
      const growthPct = growthEval > 0 ? (growthPass / growthEval) * 100 : null;

      return {
        theme: t,
        rawAvgRs,
        avgStockRs: avgStockRs !== null ? Math.round(avgStockRs) : null,
        perfVsSpy,
        growthPct,
        growthPass,
        growthEval,
        relVol: t.avgRelVol,
        trend: trend !== null ? Math.round(trend * 10) / 10 : null,
      };
    });

    // Step 2: rank rawAvgRs across themes → Theme RS 0-99 (same logic as RS Alpha).
    const rawValues = partials.map((p) => (p.rawAvgRs !== null ? p.rawAvgRs : null));
    const ratings = computeRsRatings(rawValues);

    const out: ThemeRow[] = partials.map((p, i) => ({ ...p, themeRs: ratings[i] }));

    // Sort by Theme RS desc (nulls last)
    out.sort((a, b) => {
      if (a.themeRs === null && b.themeRs === null) return 0;
      if (a.themeRs === null) return 1;
      if (b.themeRs === null) return -1;
      return b.themeRs - a.themeRs;
    });
    return out;
  }, [themes, tf, spy, rsMap, fundamentalsMap]);

  useEffect(() => {
    if (!selectedId && rows.length > 0) setSelectedId(rows[0].theme.themeId);
  }, [rows, selectedId]);

  const selected = useMemo(
    () => rows.find((r) => r.theme.themeId === selectedId) ?? rows[0] ?? null,
    [rows, selectedId]
  );

  // ── Load news + AI summary when selection changes ──────────────────────
  useEffect(() => {
    if (!selected) {
      setArticles([]);
      return;
    }
    let cancelled = false;
    const symbols = selected.theme.symbols.slice(0, 8);
    const cached = getThemeArticles(symbols);
    if (cached.length > 0) {
      setArticles(cached);
    } else {
      setArticles([]);
      setLoadingNews(true);
      fetchThemeNews(symbols).then((arts) => {
        if (cancelled) return;
        setArticles(arts);
        setLoadingNews(false);
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.theme.themeId]);

  useEffect(() => {
    if (!selected) return;
    const cached = aiSummaries[selected.theme.themeName];
    if (cached) return;
    if (articles.length === 0) return;
    setLoadingSummary(true);
    let cancelled = false;
    getAiSummary(selected.theme.themeName, articles).finally(() => {
      if (!cancelled) setLoadingSummary(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.theme.themeName, articles]);

  const aiSummary = selected ? aiSummaries[selected.theme.themeName]?.summary ?? null : null;
  const sentiment = selected ? getThemeSentiment(selected.theme.themeName) : null;

  // ── Sparkline: theme avg perf vs SPY (5d closes from cached sparklineData)
  // ThemeIntelData.sparklineData is the theme's perf series; SPY's series is
  // not directly available here, so we draw the theme series and overlay a
  // flat zero line as the "vs SPY" reference. This stays lightweight.
  const sparkline = selected?.theme.sparklineData ?? [];

  // Build "Why Money is Flowing" rationale from RS + growth + volume signals.
  const whyFlowing: string[] = useMemo(() => {
    if (!selected) return [];
    const out: string[] = [];
    const tfLabel = TF_LABELS[tf];
    if (selected.themeRs !== null) {
      if (selected.themeRs >= 80) out.push(`Theme RS ${selected.themeRs}/99 (${tfLabel}) — top-decile leadership across constituents.`);
      else if (selected.themeRs >= 60) out.push(`Theme RS ${selected.themeRs}/99 (${tfLabel}) — solid relative strength vs other themes.`);
      else if (selected.themeRs <= 30) out.push(`Theme RS ${selected.themeRs}/99 (${tfLabel}) — laggard group, capital is rotating away.`);
    }
    if (selected.perfVsSpy !== null) {
      if (selected.perfVsSpy >= 0.5) out.push(`Outperforming SPY by ${selected.perfVsSpy >= 0 ? "+" : ""}${selected.perfVsSpy.toFixed(2)}% (${tfLabel}).`);
      else if (selected.perfVsSpy <= -0.5) out.push(`Underperforming SPY by ${selected.perfVsSpy.toFixed(2)}% (${tfLabel}).`);
    }
    if (selected.trend !== null) {
      if (selected.trend >= 3) out.push(`Trend improving — 1W RS ${selected.trend > 0 ? "+" : ""}${selected.trend.toFixed(1)} pts above 3M RS.`);
      else if (selected.trend <= -3) out.push(`Trend weakening — 1W RS ${selected.trend.toFixed(1)} pts below 3M RS.`);
    }
    if (selected.growthPct !== null && selected.growthEval >= 3) {
      if (selected.growthPct >= 60) out.push(`${selected.growthPass}/${selected.growthEval} stocks (${Math.round(selected.growthPct)}%) pass the Growth filter — fundamentals support the move.`);
      else if (selected.growthPct <= 25) out.push(`Only ${selected.growthPass}/${selected.growthEval} stocks pass Growth — flow is technical, not fundamental.`);
    }
    if (selected.relVol !== null) {
      if (selected.relVol >= 1.4) out.push(`Volume ${selected.relVol.toFixed(2)}× average — institutional confirmation.`);
      else if (selected.relVol < 0.85) out.push(`Volume only ${selected.relVol.toFixed(2)}× average — flow is thin.`);
    }
    if (selected.avgStockRs !== null) {
      if (selected.avgStockRs >= 70) out.push(`Average constituent RS ${selected.avgStockRs}/99 — broad leadership group.`);
      else if (selected.avgStockRs <= 40) out.push(`Average constituent RS ${selected.avgStockRs}/99 — weak underlying group.`);
    }
    return out.slice(0, 6);
  }, [selected, tf]);

  return (
    <div className="space-y-3">
      {/* Toolbar — timeframe selector */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: SYNE }}>
            Theme RS
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-0.5">
            {TF_ORDER.map((opt) => (
              <button
                key={opt}
                onClick={() => setTf(opt)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                  tf === opt
                    ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]"
                }`}
              >
                {TF_LABELS[opt]}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
          {rows.length} themes · ranked by Theme RS
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
        {/* LEFT — Ranked theme RS table */}
        <div
          className="overflow-hidden rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-3 py-2">
            <h3 className="text-xs font-semibold text-foreground" style={{ fontFamily: SYNE }}>
              <TrendingUp size={12} className="inline mr-1.5 text-primary" />
              Themes Ranked by Theme RS · {TF_LABELS[tf]}
            </h3>
          </div>
          <div className="max-h-[72vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium w-7">#</th>
                  <th className="px-2 py-2 text-left font-medium">Theme</th>
                  <th className="px-2 py-2 text-left font-medium" title="Theme RS rating 0-99 — relative rank vs all themes for this timeframe">Theme RS</th>
                  <th className="px-2 py-2 text-right font-medium" title="Theme average performance minus SPY performance for this timeframe">vs SPY</th>
                  <th className="px-2 py-2 text-right font-medium" title="Average rs_overall of constituent stocks (0-99)">Avg RS</th>
                  <th className="px-2 py-2 text-right font-medium" title="% of theme stocks passing the Growth filter">Growth</th>
                  <th className="px-2 py-2 text-right font-medium" title="Relative volume — today vs 20-day average">Rel Vol</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td colSpan={7} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
                      No themes available.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => {
                    const isSel = selected?.theme.themeId === r.theme.themeId;
                    const trs = trendIcon(r.trend);
                    const themeRsClr = rsColor(r.themeRs);
                    return (
                      <tr
                        key={r.theme.themeId}
                        onClick={() => setSelectedId(r.theme.themeId)}
                        className={`cursor-pointer border-b border-[rgba(255,255,255,0.04)] transition-colors ${
                          isSel ? "bg-[rgba(0,245,196,0.06)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                        style={{ borderLeft: isSel ? `2px solid ${themeRsClr}` : "2px solid transparent" }}
                      >
                        <td className="px-2 py-2 text-[11px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                          {i + 1}
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-[12px] font-semibold leading-tight text-foreground" style={{ fontFamily: SYNE }}>
                            {r.theme.themeName}
                          </div>
                          <div className="mt-0.5 text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                            {r.theme.symbols.length} tickers
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: themeRsClr }}>
                              {r.themeRs ?? "—"}
                            </span>
                            <div className="h-1.5 w-10 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${r.themeRs ?? 0}%`, background: themeRsClr }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right text-[11.5px] tabular-nums" style={{
                          fontFamily: DM_MONO,
                          color: r.perfVsSpy === null
                            ? "hsl(var(--muted-foreground))"
                            : r.perfVsSpy >= 0 ? "hsl(170, 80%, 50%)" : "hsl(0, 70%, 60%)",
                        }}>
                          {r.perfVsSpy === null ? "—" : `${r.perfVsSpy >= 0 ? "+" : ""}${r.perfVsSpy.toFixed(2)}%`}
                        </td>
                        <td className="px-2 py-2 text-right text-[11.5px] tabular-nums" style={{
                          fontFamily: DM_MONO,
                          color: rsColor(r.avgStockRs),
                        }}>
                          {r.avgStockRs ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {r.growthPct === null ? (
                            <span className="text-[11.5px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>—</span>
                          ) : r.growthPct >= 60 ? (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{
                              background: "rgba(0,245,196,0.12)", color: "hsl(170, 90%, 50%)",
                              border: "1px solid rgba(0,245,196,0.28)", fontFamily: DM_MONO,
                            }}>
                              {Math.round(r.growthPct)}%
                            </span>
                          ) : (
                            <span className="text-[11.5px] tabular-nums text-foreground" style={{ fontFamily: DM_MONO }}>
                              {Math.round(r.growthPct)}%
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right text-[11.5px] tabular-nums" style={{
                          fontFamily: DM_MONO,
                          color: r.relVol === null
                            ? "hsl(var(--muted-foreground))"
                            : r.relVol >= 1.4 ? "hsl(170, 80%, 50%)"
                            : r.relVol < 0.85 ? "hsl(0, 70%, 60%)"
                            : "hsl(var(--foreground))",
                        }}>
                          {r.relVol === null ? "—" : `${r.relVol.toFixed(2)}×`}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: trs.color }}>
                            {trs.icon}
                            <span>{trs.label}</span>
                          </div>
                          <div className="text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                            {r.trend === null ? "no data" : `${r.trend >= 0 ? "+" : ""}${r.trend.toFixed(1)} RS`}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="border-t border-[rgba(255,255,255,0.08)] px-3 py-2 text-[9.5px] text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span><span className="font-semibold" style={{ color: "hsl(170, 90%, 50%)" }}>80+</span> Very Strong</span>
              <span><span className="font-semibold" style={{ color: "hsl(170, 65%, 55%)" }}>60–79</span> Strong</span>
              <span><span className="font-semibold" style={{ color: "hsl(40, 90%, 55%)" }}>40–59</span> Neutral</span>
              <span><span className="font-semibold" style={{ color: "hsl(0, 75%, 60%)" }}>&lt;40</span> Weak</span>
              <span className="opacity-60">|</span>
              <span><b>Theme RS</b> = themes ranked 1-99 by avg constituent RS for selected timeframe</span>
            </div>
          </div>
        </div>

        {/* RIGHT — Context panel */}
        <div className="space-y-3">
          {!selected ? (
            <div
              className="rounded-lg p-8 text-center text-xs text-muted-foreground"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Select a theme on the left to see its context.
            </div>
          ) : (
            <>
              {/* Header — Theme + Theme RS */}
              <div
                className="rounded-lg px-4 py-3"
                style={{
                  background: "rgba(0, 245, 196, 0.06)",
                  border: "1px solid rgba(0, 245, 196, 0.18)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Theme RS · {TF_LABELS[tf]}
                    </div>
                    <h2 className="mt-0.5 text-base font-bold text-foreground truncate" style={{ fontFamily: SYNE }}>
                      {selected.theme.themeName}
                    </h2>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-3xl font-bold leading-none tabular-nums" style={{ fontFamily: DM_MONO, color: rsColor(selected.themeRs) }}>
                      {selected.themeRs ?? "—"}
                      <span className="text-xs text-muted-foreground font-medium ml-1">/99</span>
                    </div>
                  </div>
                </div>
                {/* Quick stats */}
                <div className="mt-3 grid grid-cols-4 gap-2 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  <Stat label="vs SPY" value={selected.perfVsSpy === null ? "—" : `${selected.perfVsSpy >= 0 ? "+" : ""}${selected.perfVsSpy.toFixed(2)}%`} pos={selected.perfVsSpy !== null && selected.perfVsSpy >= 0} neg={selected.perfVsSpy !== null && selected.perfVsSpy < 0} />
                  <Stat label="Avg RS" value={selected.avgStockRs === null ? "—" : `${selected.avgStockRs}`} pos={selected.avgStockRs !== null && selected.avgStockRs >= 70} neg={selected.avgStockRs !== null && selected.avgStockRs <= 40} />
                  <Stat label="Growth" value={selected.growthPct === null ? "—" : `${Math.round(selected.growthPct)}%`} pos={selected.growthPct !== null && selected.growthPct >= 60} neg={selected.growthPct !== null && selected.growthPct < 25} />
                  <Stat label="Rel Vol" value={selected.relVol === null ? "—" : `${selected.relVol.toFixed(2)}×`} pos={selected.relVol !== null && selected.relVol >= 1.4} neg={selected.relVol !== null && selected.relVol < 0.85} />
                </div>
              </div>

              {/* Sparkline — theme perf vs SPY (zero) */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Activity size={12} className="text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Theme vs SPY</span>
                  </div>
                  <span className="text-[9.5px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                    last {sparkline.length || 0} pts
                  </span>
                </div>
              </div>

              {/* Stocks in this Theme */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Layers size={12} className="text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Stocks in this Theme</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                    {selected.theme.tickers.filter((t) => t.status === "done").length} / {selected.theme.symbols.length}
                  </span>
                </div>
                {(() => {
                  const ticks = selected.theme.tickers
                    .filter((t) => t.status === "done")
                    .map((t) => {
                      const r = rsMap.get(t.symbol);
                      return {
                        sym: t.symbol,
                        rs: r?.rs_overall ?? null,
                        d1: t.perf_1d,
                        m1: t.perf_1m,
                      };
                    })
                    .sort((a, b) => {
                      if (a.rs === null && b.rs === null) return 0;
                      if (a.rs === null) return 1;
                      if (b.rs === null) return -1;
                      return b.rs - a.rs;
                    });
                  if (ticks.length === 0) {
                    return <p className="text-xs text-muted-foreground">No ticker data available.</p>;
                  }
                  return (
                    <div className="max-h-[260px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background/95 backdrop-blur">
                          <tr className="border-b border-[rgba(255,255,255,0.08)] text-[9px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-1.5 py-1.5 text-left font-medium">Ticker</th>
                            <th className="px-1.5 py-1.5 text-right font-medium" title="RS Overall (0-99)">RS</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">1D %</th>
                            <th className="px-1.5 py-1.5 text-right font-medium">1M %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ticks.map((t) => (
                            <tr key={t.sym} className="border-b border-[rgba(255,255,255,0.04)]">
                              <td className="px-1.5 py-1 text-[11.5px] font-bold text-foreground" style={{ fontFamily: DM_MONO }}>
                                {t.sym}
                              </td>
                              <td className="px-1.5 py-1 text-right text-[11px] font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: rsColor(t.rs) }}>
                                {t.rs ?? "—"}
                              </td>
                              <td className="px-1.5 py-1 text-right text-[11px] tabular-nums" style={{
                                fontFamily: DM_MONO,
                                color: !Number.isFinite(t.d1) ? "hsl(var(--muted-foreground))" : t.d1 > 0 ? "hsl(170, 80%, 50%)" : t.d1 < 0 ? "hsl(0, 70%, 60%)" : "hsl(var(--muted-foreground))",
                              }}>
                                {Number.isFinite(t.d1) ? `${t.d1 >= 0 ? "+" : ""}${t.d1.toFixed(2)}%` : "—"}
                              </td>
                              <td className="px-1.5 py-1 text-right text-[11px] tabular-nums" style={{
                                fontFamily: DM_MONO,
                                color: !Number.isFinite(t.m1) ? "hsl(var(--muted-foreground))" : t.m1 > 0 ? "hsl(170, 80%, 50%)" : t.m1 < 0 ? "hsl(0, 70%, 60%)" : "hsl(var(--muted-foreground))",
                              }}>
                                {Number.isFinite(t.m1) ? `${t.m1 >= 0 ? "+" : ""}${t.m1.toFixed(2)}%` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>

              {/* AI Summary */}
              <div className="rounded-lg p-3" style={{ background: "rgba(0, 245, 196, 0.06)", border: "1px solid rgba(0, 245, 196, 0.18)" }}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Bot size={12} className="text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI Summary</span>
                  </div>
                  {sentiment && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: "rgba(0,0,0,0.25)", color: "hsl(var(--foreground))" }}>
                      {sentiment.sentiment} · {sentiment.score}
                    </span>
                  )}
                </div>
                {loadingSummary && !aiSummary ? (
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-[92%]" />
                    <Skeleton className="h-3 w-[78%]" />
                  </div>
                ) : aiSummary ? (
                  <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-line">
                    {aiSummary}
                  </p>
                ) : articles.length === 0 && loadingNews ? (
                  <p className="text-xs text-muted-foreground">Loading news…</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    AI summary will appear once enough recent news is available.
                  </p>
                )}
              </div>

              {/* Recent News */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Newspaper size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Recent News</span>
                  <span className="text-[9px] text-muted-foreground ml-auto">{articles.length} fetched</span>
                </div>
                {loadingNews && articles.length === 0 ? (
                  <Skeleton className="h-12 w-full" />
                ) : articles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recent headlines.</p>
                ) : (
                  <div className="space-y-1.5">
                    {articles.slice(0, 5).map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-md p-2 transition-colors hover:bg-accent/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-[12px] font-medium text-foreground leading-snug group-hover:text-primary transition-colors">
                            {a.headline}
                          </p>
                          <ExternalLink size={10} className="shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          {a.symbol && (
                            <span className="rounded bg-secondary px-1 py-0.5 font-bold text-foreground" style={{ fontFamily: DM_MONO }}>
                              {a.symbol}
                            </span>
                          )}
                          {a.source && <span>{a.source}</span>}
                          {a.published_at && <span>· {timeAgo(a.published_at)}</span>}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Why Money Is Flowing */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Zap size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Why Money is Flowing</span>
                </div>
                {whyFlowing.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Not enough RS / fundamentals data yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {whyFlowing.map((text, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-foreground/90">
                        <Sparkles size={10} className="text-primary mt-1 shrink-0" />
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Footer note */}
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground px-1 leading-snug">
                <Info size={10} className="text-primary mt-0.5 shrink-0" />
                <span>
                  Theme RS is computed by averaging the per-stock RS rating
                  ({TF_LABELS[tf]} timeframe) of constituent tickers, then
                  ranking the resulting averages 1–99 across all themes.
                  Same methodology as the RS Alpha tab — applied at theme level.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, pos, neg }: { label: string; value: string; pos?: boolean; neg?: boolean }) {
  const color = pos ? "hsl(170, 80%, 50%)" : neg ? "hsl(0, 70%, 60%)" : "hsl(var(--foreground))";
  return (
    <div>
      <div>{label}</div>
      <div className="mt-0.5 text-[12px] font-bold tabular-nums" style={{ fontFamily: DM_MONO, color }}>
        {value}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) {
    return <div className="h-10 flex items-center justify-center text-[10px] text-muted-foreground">Not enough data</div>;
  }
  const w = 240;
  const h = 40;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * stepX},${h - ((v - min) / range) * h}`)
    .join(" ");
  const lastUp = data[data.length - 1] >= 0;
  const stroke = lastUp ? "hsl(170, 80%, 50%)" : "hsl(0, 70%, 60%)";
  // Zero-line y position
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      {/* SPY reference line at 0 */}
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.4" strokeDasharray="3,3" strokeWidth="1" />
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={points} />
    </svg>
  );
}
