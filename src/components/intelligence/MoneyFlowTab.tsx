// ─────────────────────────────────────────────────────────────────────────────
// MoneyFlowTab
//
// Two-column "where is smart money rotating" view:
//   • Left  – ranked themes by Money Flow Score (0-100) with key signal text
//   • Right – AI Summary + recent news + "Why money is flowing" rationale
//
// Money Flow Score blends the same signals used by the Theme Momentum Index,
// but weighted toward MONEY FLOW evidence (relative-vs-SPY + relative volume).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Newspaper, ExternalLink, Sparkles, TrendingUp, Activity } from "lucide-react";
import type { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useStockFundamentalsMap } from "@/hooks/useStockFundamentalsMap";
import { passesGrowth } from "@/lib/growthFilters";
import { useThemeNews, type NewsArticle } from "@/hooks/useThemeNews";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

type Timeframe = "Today" | "1W" | "1M";

interface ScoredTheme {
  theme: ThemeIntelData;
  score: number;            // 0-100 Money Flow Score
  band: "strong" | "building" | "weakening";
  rsVsSpy: number | null;   // perf - SPY for selected timeframe
  growthPct: number | null; // % of theme stocks passing growth
  growthPass: number;
  growthEval: number;
  signal: string;           // short text driver
  avgRs: number | null;     // avg RS rating (0-99)
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreColors(score: number, band: ScoredTheme["band"]) {
  if (band === "strong") return { fg: "hsl(170, 90%, 50%)", bg: "rgba(0, 245, 196, 0.10)", border: "rgba(0, 245, 196, 0.28)" };
  if (band === "building") return { fg: "hsl(40, 90%, 55%)", bg: "rgba(245, 166, 35, 0.10)", border: "rgba(245, 166, 35, 0.28)" };
  return { fg: "hsl(0, 75%, 60%)", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.28)" };
}

function bandLabel(b: ScoredTheme["band"]): string {
  if (b === "strong") return "Strong inflow";
  if (b === "building") return "Building";
  return "Weakening";
}

function tfPerf(t: ThemeIntelData, tf: Timeframe): number {
  if (tf === "1W") return t.perf_1w;
  if (tf === "1M") return t.perf_1m;
  return t.perf_1d;
}

function tfHasData(t: ThemeIntelData, tf: Timeframe): boolean {
  if (tf === "Today") return true;
  return t.hasEodHistory;
}

function relSpyToScore(delta: number | null): number | null {
  if (delta === null || !Number.isFinite(delta)) return null;
  // ±5pp vs SPY → ±50 pts around midpoint
  return clamp(50 + delta * 10);
}

function relVolToScore(rv: number | null): number | null {
  if (rv === null || !Number.isFinite(rv)) return null;
  // 1.0× → 50, 2.0× → 100, 0.5× → 25
  return clamp(rv * 50);
}

function buildSignal(s: Omit<ScoredTheme, "signal">): string {
  const drivers: string[] = [];
  if (s.rsVsSpy !== null && s.rsVsSpy >= 0.5) drivers.push(`+${s.rsVsSpy.toFixed(1)}% vs SPY`);
  else if (s.rsVsSpy !== null && s.rsVsSpy <= -0.5) drivers.push(`${s.rsVsSpy.toFixed(1)}% vs SPY`);
  if (s.theme.avgRelVol !== null && s.theme.avgRelVol >= 1.4) drivers.push(`${s.theme.avgRelVol.toFixed(1)}× rel vol`);
  else if (s.theme.avgRelVol !== null && s.theme.avgRelVol < 0.85) drivers.push(`thin volume (${s.theme.avgRelVol.toFixed(1)}×)`);
  if (s.theme.breadthTotal > 0) {
    const bp = Math.round((s.theme.breadthUp / s.theme.breadthTotal) * 100);
    if (bp >= 70) drivers.push(`${bp}% breadth`);
    else if (bp <= 30) drivers.push(`weak breadth ${bp}%`);
  }
  if (s.growthPct !== null && s.growthPct >= 60) drivers.push(`${Math.round(s.growthPct)}% growth stocks`);
  if (drivers.length === 0) return "Mixed signals";
  return drivers.slice(0, 3).join(" · ");
}

function buildWhyParagraph(s: ScoredTheme): string {
  const bits: string[] = [];
  const t = s.theme;
  if (s.rsVsSpy !== null) {
    bits.push(
      s.rsVsSpy >= 0.3
        ? `Outperforming SPY by ${s.rsVsSpy.toFixed(2)}% — a sign of active rotation INTO the theme.`
        : s.rsVsSpy <= -0.3
        ? `Underperforming SPY by ${Math.abs(s.rsVsSpy).toFixed(2)}% — capital is rotating AWAY.`
        : `Tracking SPY closely — no clear directional flow.`
    );
  }
  if (t.avgRelVol !== null) {
    bits.push(
      t.avgRelVol >= 1.4
        ? `Relative volume of ${t.avgRelVol.toFixed(2)}× confirms institutional participation.`
        : t.avgRelVol < 0.85
        ? `Volume only ${t.avgRelVol.toFixed(2)}× average — flow is thin.`
        : `Volume near normal at ${t.avgRelVol.toFixed(2)}×.`
    );
  }
  if (t.breadthTotal > 0) {
    const bp = Math.round((t.breadthUp / t.breadthTotal) * 100);
    bits.push(
      bp >= 60
        ? `Broad participation (${t.breadthUp}/${t.breadthTotal} advancing) — not a one-name story.`
        : bp <= 35
        ? `Narrow breadth (${t.breadthUp}/${t.breadthTotal} advancing) — move concentrated in few names.`
        : `Mixed breadth (${t.breadthUp}/${t.breadthTotal}).`
    );
  }
  if (s.avgRs !== null) {
    bits.push(
      s.avgRs >= 70
        ? `High average RS rating (${s.avgRs}/99) — these stocks lead the market.`
        : s.avgRs <= 40
        ? `Weak average RS (${s.avgRs}/99) — laggards.`
        : `Average RS at ${s.avgRs}/99.`
    );
  }
  if (s.growthPct !== null && s.growthEval >= 3) {
    bits.push(`${s.growthPass}/${s.growthEval} stocks pass the Growth filter (${Math.round(s.growthPct)}%).`);
  }
  return bits.join(" ");
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

export default function MoneyFlowTab({
  themes,
  isLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  const [tf, setTf] = useState<Timeframe>("1W");
  const [growthOnly, setGrowthOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { spy } = useSpyBenchmark();
  const { map: fundamentalsMap } = useStockFundamentalsMap();
  const { fetchThemeNews, getThemeArticles, getAiSummary, aiSummaries } = useThemeNews();

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // ── Score + rank themes ────────────────────────────────────────────────
  const scored: ScoredTheme[] = useMemo(() => {
    if (themes.length === 0) return [];

    const spyVal =
      tf === "1W" ? spy.perf_1w : tf === "1M" ? spy.perf_1m : spy.perf_1d;

    const out: ScoredTheme[] = themes.map((t) => {
      const perf = tfPerf(t, tf);
      const hasPerf = tfHasData(t, tf);
      const rsVsSpy =
        spyVal !== null && spyVal !== undefined && hasPerf
          ? Math.round((perf - spyVal) * 100) / 100
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

      // Avg RS proxy = momentum score (already 0-100, derived from perf+vol)
      const avgRs = null as number | null; // we don't have per-symbol RS here

      // Component scores
      const cRel = relSpyToScore(rsVsSpy);
      const cVol = relVolToScore(t.avgRelVol);
      const cMomentum = clamp(t.momentumScore); // 0-100
      const cBreadth =
        t.breadthTotal > 0 ? clamp((t.breadthUp / t.breadthTotal) * 100) : null;
      const cGrowth = growthPct;

      // Money-flow weighted blend
      const weights = { rel: 0.32, vol: 0.22, momentum: 0.18, breadth: 0.18, growth: 0.10 };
      const parts: { v: number; w: number }[] = [];
      if (cRel !== null) parts.push({ v: cRel, w: weights.rel });
      if (cVol !== null) parts.push({ v: cVol, w: weights.vol });
      parts.push({ v: cMomentum, w: weights.momentum });
      if (cBreadth !== null) parts.push({ v: cBreadth, w: weights.breadth });
      if (cGrowth !== null) parts.push({ v: cGrowth, w: weights.growth });
      const totalW = parts.reduce((s, p) => s + p.w, 0);
      const score = totalW > 0
        ? Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / totalW)
        : 0;

      const band: ScoredTheme["band"] =
        score >= 65 ? "strong" : score >= 45 ? "building" : "weakening";

      const partial: Omit<ScoredTheme, "signal"> = {
        theme: t,
        score,
        band,
        rsVsSpy,
        growthPct,
        growthPass,
        growthEval,
        avgRs,
      };
      return { ...partial, signal: buildSignal(partial) };
    });

    out.sort((a, b) => b.score - a.score);
    return out;
  }, [themes, tf, spy, fundamentalsMap]);

  const filtered = useMemo(() => {
    if (!growthOnly) return scored;
    return scored.filter((s) => s.growthPct !== null && s.growthPct >= 50);
  }, [scored, growthOnly]);

  // Auto-select first theme
  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].theme.themeId);
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => filtered.find((s) => s.theme.themeId === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId]
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.theme.themeId]);

  // Generate AI summary once articles are loaded
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.theme.themeName, articles]);

  const aiSummary = selected ? aiSummaries[selected.theme.themeName]?.summary ?? null : null;
  const sentiment = selected ? aiSummaries[selected.theme.themeName]?.sentiment ?? null : null;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-0.5">
            {(["Today", "1W", "1M"] as Timeframe[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setTf(opt)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                  tf === opt
                    ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={growthOnly}
              onChange={(e) => setGrowthOnly(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-primary"
            />
            Growth Stocks Only
          </label>
        </div>
        <div className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
          {filtered.length} themes ranked by Money Flow Score
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.1fr_1fr]">
        {/* LEFT — Ranked list */}
        <div
          className="overflow-hidden rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-3 py-2">
            <h3 className="text-xs font-semibold text-foreground" style={{ fontFamily: SYNE }}>
              <TrendingUp size={12} className="inline mr-1.5 text-primary" />
              Top Themes by Money Flow Strength
            </h3>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2.5 py-2 text-left font-medium w-8">#</th>
                  <th className="px-2.5 py-2 text-left font-medium">Theme</th>
                  <th className="px-2.5 py-2 text-left font-medium">Score</th>
                  <th className="px-2.5 py-2 text-right font-medium">vs SPY</th>
                  <th className="px-2.5 py-2 text-right font-medium">Growth</th>
                  <th className="px-2.5 py-2 text-left font-medium">Key Signal</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td colSpan={6} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                      No themes match the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => {
                    const c = scoreColors(s.score, s.band);
                    const isSel = selected?.theme.themeId === s.theme.themeId;
                    return (
                      <tr
                        key={s.theme.themeId}
                        onClick={() => setSelectedId(s.theme.themeId)}
                        className={`cursor-pointer border-b border-[rgba(255,255,255,0.04)] transition-colors ${
                          isSel ? "bg-[rgba(0,245,196,0.06)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                        style={{ borderLeft: isSel ? `2px solid ${c.fg}` : "2px solid transparent" }}
                      >
                        <td
                          className="px-2.5 py-2 text-[11px] text-muted-foreground"
                          style={{ fontFamily: DM_MONO }}
                        >
                          {i + 1}
                        </td>
                        <td className="px-2.5 py-2">
                          <div
                            className="text-[12px] font-semibold leading-tight text-foreground"
                            style={{ fontFamily: SYNE }}
                          >
                            {s.theme.themeName}
                          </div>
                          <div
                            className="mt-0.5 text-[9px] text-muted-foreground"
                            style={{ fontFamily: DM_MONO }}
                          >
                            {s.theme.symbols.length} tickers · {s.theme.breadthUp}/{s.theme.breadthTotal} adv
                          </div>
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-base font-bold tabular-nums"
                              style={{ fontFamily: DM_MONO, color: c.fg }}
                            >
                              {s.score}
                            </span>
                            <div
                              className="h-1.5 w-14 overflow-hidden rounded-full"
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${s.score}%`, background: c.fg }}
                              />
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{bandLabel(s.band)}</div>
                        </td>
                        <td
                          className="px-2.5 py-2 text-right text-[12px] tabular-nums"
                          style={{
                            fontFamily: DM_MONO,
                            color:
                              s.rsVsSpy === null
                                ? "hsl(var(--muted-foreground))"
                                : s.rsVsSpy >= 0
                                ? "hsl(170, 80%, 50%)"
                                : "hsl(0, 70%, 60%)",
                          }}
                        >
                          {s.rsVsSpy === null
                            ? "—"
                            : `${s.rsVsSpy >= 0 ? "+" : ""}${s.rsVsSpy.toFixed(2)}%`}
                        </td>
                        <td
                          className="px-2.5 py-2 text-right text-[12px] tabular-nums text-foreground"
                          style={{ fontFamily: DM_MONO }}
                        >
                          {s.growthPct === null ? "—" : `${Math.round(s.growthPct)}%`}
                        </td>
                        <td className="px-2.5 py-2 text-[10.5px] text-muted-foreground leading-snug max-w-[260px]">
                          {s.signal}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT — Context & narrative */}
        <div className="space-y-3">
          {!selected ? (
            <div
              className="rounded-lg p-8 text-center text-xs text-muted-foreground"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Select a theme on the left to see its narrative.
            </div>
          ) : (
            <>
              {/* Header card */}
              <div
                className="rounded-lg px-4 py-3"
                style={{
                  background: scoreColors(selected.score, selected.band).bg,
                  border: `1px solid ${scoreColors(selected.score, selected.band).border}`,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Money Flow Score
                    </div>
                    <h2
                      className="mt-0.5 text-base font-bold text-foreground truncate"
                      style={{ fontFamily: SYNE }}
                    >
                      {selected.theme.themeName}
                    </h2>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-3xl font-bold leading-none tabular-nums"
                      style={{ fontFamily: DM_MONO, color: scoreColors(selected.score, selected.band).fg }}
                    >
                      {selected.score}
                      <span className="text-xs text-muted-foreground font-medium ml-1">/100</span>
                    </div>
                    <div
                      className="mt-1 text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: scoreColors(selected.score, selected.band).fg }}
                    >
                      {bandLabel(selected.band)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Why money is flowing */}
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Activity size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                    Why Money is Flowing
                  </span>
                </div>
                <p className="text-xs text-foreground leading-relaxed">
                  {buildWhyParagraph(selected)}
                </p>
              </div>

              {/* AI Summary */}
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(0, 245, 196, 0.06)", border: "1px solid rgba(0, 245, 196, 0.18)" }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Bot size={12} className="text-primary" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      AI Summary
                    </span>
                  </div>
                  {sentiment && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{ background: "rgba(0,0,0,0.25)", color: "hsl(var(--foreground))" }}
                    >
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
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">
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

              {/* News */}
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <Newspaper size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                    Recent News
                  </span>
                </div>
                {loadingNews && articles.length === 0 ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : articles.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No recent news for this theme's tickers.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {articles.slice(0, 5).map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-md p-2 transition-colors hover:bg-accent/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-xs font-medium text-foreground leading-snug group-hover:text-primary transition-colors">
                            {a.headline}
                          </p>
                          <ExternalLink
                            size={10}
                            className="shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          {a.symbol && (
                            <span
                              className="rounded bg-secondary px-1 py-0.5 font-bold text-foreground"
                              style={{ fontFamily: DM_MONO }}
                            >
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

              {/* Footer note */}
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                <Sparkles size={10} className="text-primary" />
                Score combines vs-SPY, relative volume, momentum, breadth & growth quality.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
