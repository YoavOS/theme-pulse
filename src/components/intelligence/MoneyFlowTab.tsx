// ─────────────────────────────────────────────────────────────────────────────
// MoneyFlowTab — "smart money radar"
//
// Left  – ranked themes with: Score, Rotation Strength (1W vs 3M RS),
//         Growth %, Volume Confirmation, Catalyst Strength
// Right – deep context panel: Score + verdict, Key Drivers, sharp AI Summary,
//         Catalyst Breakdown, Top Stocks to Watch, analytical "Why" section,
//         and a small legend.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bot, Newspaper, ExternalLink, Sparkles, TrendingUp, Activity,
  Flame, Zap, Info, Target, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import type { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useStockFundamentalsMap } from "@/hooks/useStockFundamentalsMap";
import { useQualifiedRsMap } from "@/hooks/useQualifiedRsMap";
import { passesGrowth } from "@/lib/growthFilters";
import {
  useThemeNews,
  type NewsArticle,
  POSITIVE_KEYWORDS,
  NEGATIVE_HEADLINE_KEYWORDS,
} from "@/hooks/useThemeNews";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

type Timeframe = "Today" | "1W" | "1M";

interface VolumeConfirm {
  label: "Strong" | "Confirming" | "Neutral" | "Thin";
  detail: string;
  color: string;
  score: number; // 0-100 (just for scaling bar)
}

interface CatalystSummary {
  label: "Hot" | "Active" | "Quiet" | "—";
  detail: string;
  color: string;
  count: number;
}

interface ScoredTheme {
  theme: ThemeIntelData;
  score: number;            // 0-100 Money Flow Score
  band: "strong" | "building" | "weakening";
  rsVsSpy: number | null;   // perf - SPY for selected timeframe
  growthPct: number | null;
  growthPass: number;
  growthEval: number;
  avgRs: number | null;            // avg rs_overall (1-99)
  rotation: number | null;         // avg(rs_1w - rs_3m)
  volume: VolumeConfirm;
  catalyst: CatalystSummary;
  topStocks: TopStock[];
  signal: string;
}

interface TopStock {
  symbol: string;
  rs: number | null;
  perf_1d: number;
  perf_1w: number;
  isGrowth: boolean;
}

const HIGH_RELEVANCE_KW = [
  "hormuz", "iran", "russia", "ukraine", "opec", "sanction", "tariff", "war", "conflict",
  "fed", "rate", "inflation", "earnings", "guidance", "contract", "deal", "merger",
  "acquisition", "fda", "approval", "lawsuit", "investigation", "downgrade", "upgrade",
  "beat", "miss", "capex", "billion", "ai ", "chip", "supply", "shortage", "ban", "export",
];

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

function verdict(s: ScoredTheme): string {
  if (s.band === "strong") {
    if (s.rotation !== null && s.rotation >= 5) return "Smart money rotating in — accelerating leadership.";
    return "Strong inflow with broad confirmation.";
  }
  if (s.band === "building") {
    if (s.rotation !== null && s.rotation >= 3) return "Building momentum — early-stage rotation in.";
    return "Mixed but constructive — watch for a confirming push.";
  }
  if (s.rotation !== null && s.rotation <= -3) return "Rotation OUT — capital leaving the theme.";
  return "Weak flow — capital is sitting out.";
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
  return clamp(50 + delta * 10);
}

function relVolToScore(rv: number | null): number | null {
  if (rv === null || !Number.isFinite(rv)) return null;
  return clamp(rv * 50);
}

function rotationToScore(r: number | null): number | null {
  if (r === null || !Number.isFinite(r)) return null;
  // ±15 RS pts → ±50 around midpoint
  return clamp(50 + (r / 15) * 50);
}

function classifyVolume(t: ThemeIntelData): VolumeConfirm {
  const rv = t.avgRelVol;
  const up = t.volumeSpikingUp;
  if (rv === null) {
    return { label: "Neutral", detail: "no volume data", color: "hsl(var(--muted-foreground))", score: 50 };
  }
  if (rv >= 1.6 || up >= 4) {
    return { label: "Strong", detail: `${rv.toFixed(2)}× · ${up} spikes`, color: "hsl(170, 80%, 50%)", score: 85 };
  }
  if (rv >= 1.2) {
    return { label: "Confirming", detail: `${rv.toFixed(2)}×`, color: "hsl(170, 65%, 55%)", score: 65 };
  }
  if (rv < 0.85) {
    return { label: "Thin", detail: `${rv.toFixed(2)}×`, color: "hsl(0, 70%, 60%)", score: 30 };
  }
  return { label: "Neutral", detail: `${rv.toFixed(2)}×`, color: "hsl(var(--muted-foreground))", score: 50 };
}

function scoreArticle(a: NewsArticle): number {
  const text = `${a.headline} ${a.summary || ""}`.toLowerCase();
  let s = 0;
  for (const k of HIGH_RELEVANCE_KW) if (text.includes(k)) s += 12;
  for (const k of POSITIVE_KEYWORDS) if (text.includes(k)) s += 6;
  for (const k of NEGATIVE_HEADLINE_KEYWORDS) if (text.includes(k)) s += 6;
  if (a.published_at) {
    const ageH = (Date.now() - new Date(a.published_at).getTime()) / 3_600_000;
    s += Math.max(0, 30 - ageH); // recency boost (0–30)
  }
  return s;
}

function classifyCatalyst(articles: NewsArticle[]): CatalystSummary {
  if (!articles || articles.length === 0) {
    return { label: "—", detail: "no news fetched", color: "hsl(var(--muted-foreground))", count: 0 };
  }
  const since = Date.now() - 48 * 3_600_000;
  const recent = articles.filter(
    a => a.published_at && new Date(a.published_at).getTime() >= since
  );
  let high = 0;
  for (const a of recent) {
    const text = `${a.headline} ${a.summary || ""}`.toLowerCase();
    if (HIGH_RELEVANCE_KW.some(k => text.includes(k))) high++;
  }
  if (high >= 4) return { label: "Hot", detail: `${high} catalysts · 48h`, color: "hsl(0, 80%, 62%)", count: high };
  if (high >= 1) return { label: "Active", detail: `${high} catalyst${high > 1 ? "s" : ""}`, color: "hsl(40, 90%, 55%)", count: high };
  return { label: "Quiet", detail: `${recent.length} headlines`, color: "hsl(var(--muted-foreground))", count: 0 };
}

function buildSignal(s: Omit<ScoredTheme, "signal">): string {
  const drivers: string[] = [];
  if (s.rsVsSpy !== null && s.rsVsSpy >= 0.5) drivers.push(`+${s.rsVsSpy.toFixed(1)}% vs SPY`);
  else if (s.rsVsSpy !== null && s.rsVsSpy <= -0.5) drivers.push(`${s.rsVsSpy.toFixed(1)}% vs SPY`);
  if (s.rotation !== null && Math.abs(s.rotation) >= 3) {
    drivers.push(`${s.rotation > 0 ? "+" : ""}${s.rotation.toFixed(1)} RS rotation`);
  }
  if (s.theme.avgRelVol !== null && s.theme.avgRelVol >= 1.4) drivers.push(`${s.theme.avgRelVol.toFixed(1)}× vol`);
  if (s.growthPct !== null && s.growthPct >= 60) drivers.push(`${Math.round(s.growthPct)}% growth`);
  if (drivers.length === 0) return "Mixed signals";
  return drivers.slice(0, 3).join(" · ");
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
  const { rsMap } = useQualifiedRsMap();
  const {
    fetchThemeNews, getThemeArticles, getAiSummary, aiSummaries, getThemeSentiment,
  } = useThemeNews();

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Cached articles per theme (for catalyst column on left). We fetch on selection,
  // so themes the user has viewed get a real catalyst badge; others fall back to "—".
  const cachedArticlesByTheme = useMemo(() => {
    const map = new Map<string, NewsArticle[]>();
    for (const t of themes) {
      const arts = getThemeArticles(t.symbols.slice(0, 8));
      if (arts.length > 0) map.set(t.themeId, arts);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes, articles]);

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

      // ── per-symbol RS aggregation
      const rsOveralls: number[] = [];
      const rotations: number[] = [];
      for (const s of t.symbols) {
        const r = rsMap.get(s);
        if (!r) continue;
        if (r.rs_overall !== null && Number.isFinite(r.rs_overall)) rsOveralls.push(r.rs_overall);
        if (r.rs_1w !== null && r.rs_3m !== null && Number.isFinite(r.rs_1w) && Number.isFinite(r.rs_3m)) {
          rotations.push(r.rs_1w - r.rs_3m);
        }
      }
      const avgRs = rsOveralls.length > 0
        ? Math.round(rsOveralls.reduce((a, b) => a + b, 0) / rsOveralls.length)
        : null;
      const rotation = rotations.length > 0
        ? Math.round((rotations.reduce((a, b) => a + b, 0) / rotations.length) * 10) / 10
        : null;

      // ── Growth %
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

      // ── volume + catalyst
      const volume = classifyVolume(t);
      const arts = cachedArticlesByTheme.get(t.themeId) || [];
      const catalyst = classifyCatalyst(arts);

      // ── Money Flow Score (weights tilted to flow evidence + rotation)
      const cRel = relSpyToScore(rsVsSpy);
      const cVol = relVolToScore(t.avgRelVol);
      const cMomentum = clamp(t.momentumScore);
      const cBreadth = t.breadthTotal > 0 ? clamp((t.breadthUp / t.breadthTotal) * 100) : null;
      const cGrowth = growthPct;
      const cRot = rotationToScore(rotation);

      const weights = { rel: 0.26, rot: 0.20, vol: 0.18, momentum: 0.14, breadth: 0.14, growth: 0.08 };
      const parts: { v: number; w: number }[] = [];
      if (cRel !== null) parts.push({ v: cRel, w: weights.rel });
      if (cRot !== null) parts.push({ v: cRot, w: weights.rot });
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

      // ── top stocks: highest RS, ties broken by 1W perf; mark growth
      const stocks: TopStock[] = t.tickers
        .filter(tk => tk.status === "done")
        .map(tk => {
          const r = rsMap.get(tk.symbol);
          const f = fundamentalsMap.get(tk.symbol);
          return {
            symbol: tk.symbol,
            rs: r?.rs_overall ?? null,
            perf_1d: tk.perf_1d,
            perf_1w: tk.perf_1w,
            isGrowth: f ? passesGrowth(f) : false,
          };
        })
        .sort((a, b) => {
          const ra = a.rs ?? -1;
          const rb = b.rs ?? -1;
          if (rb !== ra) return rb - ra;
          return b.perf_1w - a.perf_1w;
        })
        .slice(0, 5);

      const partial: Omit<ScoredTheme, "signal"> = {
        theme: t, score, band, rsVsSpy, growthPct, growthPass, growthEval,
        avgRs, rotation, volume, catalyst, topStocks: stocks,
      };
      return { ...partial, signal: buildSignal(partial) };
    });

    out.sort((a, b) => b.score - a.score);
    return out;
  }, [themes, tf, spy, fundamentalsMap, rsMap, cachedArticlesByTheme]);

  const filtered = useMemo(() => {
    if (!growthOnly) return scored;
    return scored.filter((s) => s.growthPct !== null && s.growthPct >= 50);
  }, [scored, growthOnly]);

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

  // Top catalyst articles for selected theme (max 3)
  const topCatalysts: NewsArticle[] = useMemo(() => {
    if (!articles.length) return [];
    return [...articles]
      .map(a => ({ a, s: scoreArticle(a) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 3)
      .map(x => x.a);
  }, [articles]);

  // Build Key Drivers bullet list
  const keyDrivers: { icon: JSX.Element; text: string; tone: "pos" | "neg" | "neu" }[] = useMemo(() => {
    if (!selected) return [];
    const out: { icon: JSX.Element; text: string; tone: "pos" | "neg" | "neu" }[] = [];
    const t = selected.theme;
    if (selected.rsVsSpy !== null) {
      if (selected.rsVsSpy >= 0.3)
        out.push({ icon: <ArrowUpRight size={12} />, tone: "pos",
          text: `RS vs SPY +${selected.rsVsSpy.toFixed(2)}% (${tf}) — outperforming the market.` });
      else if (selected.rsVsSpy <= -0.3)
        out.push({ icon: <ArrowDownRight size={12} />, tone: "neg",
          text: `RS vs SPY ${selected.rsVsSpy.toFixed(2)}% (${tf}) — underperforming.` });
    }
    if (selected.rotation !== null) {
      if (selected.rotation >= 3)
        out.push({ icon: <TrendingUp size={12} />, tone: "pos",
          text: `Rotation +${selected.rotation.toFixed(1)} RS (1W vs 3M) — leadership accelerating.` });
      else if (selected.rotation <= -3)
        out.push({ icon: <ArrowDownRight size={12} />, tone: "neg",
          text: `Rotation ${selected.rotation.toFixed(1)} RS (1W vs 3M) — momentum fading.` });
      else
        out.push({ icon: <Activity size={12} />, tone: "neu",
          text: `Stable rotation (${selected.rotation > 0 ? "+" : ""}${selected.rotation.toFixed(1)} RS) — no major shift.` });
    }
    if (t.avgRelVol !== null) {
      if (t.avgRelVol >= 1.4)
        out.push({ icon: <Zap size={12} />, tone: "pos",
          text: `Volume ${t.avgRelVol.toFixed(2)}× avg with ${t.volumeSpikingUp} ticker spike${t.volumeSpikingUp === 1 ? "" : "s"} — institutional confirmation.` });
      else if (t.avgRelVol < 0.85)
        out.push({ icon: <ArrowDownRight size={12} />, tone: "neg",
          text: `Volume only ${t.avgRelVol.toFixed(2)}× avg — flow is thin.` });
    }
    if (selected.growthPct !== null && selected.growthEval >= 3) {
      const tone: "pos" | "neg" | "neu" =
        selected.growthPct >= 60 ? "pos" : selected.growthPct >= 35 ? "neu" : "neg";
      out.push({ icon: <Target size={12} />, tone,
        text: `${selected.growthPass}/${selected.growthEval} stocks pass Growth filter (${Math.round(selected.growthPct)}%).` });
    }
    if (t.breadthTotal > 0) {
      const bp = Math.round((t.breadthUp / t.breadthTotal) * 100);
      const tone: "pos" | "neg" | "neu" = bp >= 60 ? "pos" : bp <= 35 ? "neg" : "neu";
      out.push({ icon: <Activity size={12} />, tone,
        text: `Breadth ${t.breadthUp}/${t.breadthTotal} advancing (${bp}%) — ${bp >= 60 ? "broad participation" : bp <= 35 ? "narrow move" : "mixed participation"}.` });
    }
    if (selected.avgRs !== null) {
      const tone: "pos" | "neg" | "neu" =
        selected.avgRs >= 70 ? "pos" : selected.avgRs <= 40 ? "neg" : "neu";
      out.push({ icon: <Sparkles size={12} />, tone,
        text: `Average RS rating ${selected.avgRs}/99 — ${selected.avgRs >= 70 ? "leadership group" : selected.avgRs <= 40 ? "laggard group" : "mid-pack"}.` });
    }
    return out.slice(0, 6);
  }, [selected, tf]);

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
          {filtered.length} themes · smart-money radar
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        {/* LEFT — Ranked list */}
        <div
          className="overflow-hidden rounded-lg"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-3 py-2">
            <h3 className="text-xs font-semibold text-foreground" style={{ fontFamily: SYNE }}>
              <TrendingUp size={12} className="inline mr-1.5 text-primary" />
              Themes Ranked by Money Flow
            </h3>
          </div>
          <div className="max-h-[72vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium w-7">#</th>
                  <th className="px-2 py-2 text-left font-medium">Theme</th>
                  <th className="px-2 py-2 text-left font-medium">Score</th>
                  <th className="px-2 py-2 text-right font-medium" title="1W RS minus 3M RS — positive = accelerating into leadership">Rotation</th>
                  <th className="px-2 py-2 text-right font-medium" title="% of theme stocks passing the Growth filter">Growth</th>
                  <th className="px-2 py-2 text-left font-medium" title="Volume confirmation from relative volume + spike count">Volume</th>
                  <th className="px-2 py-2 text-left font-medium" title="High-relevance catalysts in news (last 48h)">Catalyst</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-[rgba(255,255,255,0.04)]">
                      <td colSpan={7} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-xs text-muted-foreground">
                      No themes match the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s, i) => {
                    const c = scoreColors(s.score, s.band);
                    const isSel = selected?.theme.themeId === s.theme.themeId;
                    const rotColor = s.rotation === null
                      ? "hsl(var(--muted-foreground))"
                      : s.rotation >= 3
                      ? "hsl(170, 80%, 50%)"
                      : s.rotation <= -3
                      ? "hsl(0, 70%, 60%)"
                      : "hsl(var(--foreground))";
                    return (
                      <tr
                        key={s.theme.themeId}
                        onClick={() => setSelectedId(s.theme.themeId)}
                        className={`cursor-pointer border-b border-[rgba(255,255,255,0.04)] transition-colors ${
                          isSel ? "bg-[rgba(0,245,196,0.06)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                        }`}
                        style={{ borderLeft: isSel ? `2px solid ${c.fg}` : "2px solid transparent" }}
                      >
                        <td className="px-2 py-2 text-[11px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                          {i + 1}
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-[12px] font-semibold leading-tight text-foreground" style={{ fontFamily: SYNE }}>
                            {s.theme.themeName}
                          </div>
                          <div className="mt-0.5 text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                            {s.theme.symbols.length} tickers
                            {s.avgRs !== null ? ` · avg RS ${s.avgRs}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: c.fg }}>
                              {s.score}
                            </span>
                            <div className="h-1.5 w-10 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${s.score}%`, background: c.fg }} />
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{bandLabel(s.band)}</div>
                        </td>
                        <td className="px-2 py-2 text-right text-[11.5px] tabular-nums" style={{ fontFamily: DM_MONO, color: rotColor }}>
                          {s.rotation === null ? "—" : `${s.rotation >= 0 ? "+" : ""}${s.rotation.toFixed(1)}`}
                        </td>
                        <td className="px-2 py-2 text-right text-[11.5px] tabular-nums text-foreground" style={{ fontFamily: DM_MONO }}>
                          {s.growthPct === null ? "—" : `${Math.round(s.growthPct)}%`}
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-[10.5px] font-semibold" style={{ color: s.volume.color }}>{s.volume.label}</div>
                          <div className="text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{s.volume.detail}</div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-[10.5px] font-semibold" style={{ color: s.catalyst.color }}>
                            {s.catalyst.label === "Hot" && <Flame size={9} className="inline mr-0.5" />}
                            {s.catalyst.label}
                          </div>
                          <div className="text-[9px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{s.catalyst.detail}</div>
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
              <span><span className="font-semibold" style={{ color: "hsl(170, 90%, 50%)" }}>65+</span> Strong inflow</span>
              <span><span className="font-semibold" style={{ color: "hsl(40, 90%, 55%)" }}>45–64</span> Building</span>
              <span><span className="font-semibold" style={{ color: "hsl(0, 75%, 60%)" }}>&lt;45</span> Weakening</span>
              <span className="opacity-60">|</span>
              <span><b>Rotation</b> = avg(1W RS − 3M RS), &gt;+3 accelerating</span>
              <span><b>Catalyst</b> = high-relevance news in last 48h</span>
            </div>
          </div>
        </div>

        {/* RIGHT — Deep context */}
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
              {/* Header — Score + verdict */}
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
                      Money Flow Score · {tf}
                    </div>
                    <h2 className="mt-0.5 text-base font-bold text-foreground truncate" style={{ fontFamily: SYNE }}>
                      {selected.theme.themeName}
                    </h2>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-3xl font-bold leading-none tabular-nums" style={{ fontFamily: DM_MONO, color: scoreColors(selected.score, selected.band).fg }}>
                      {selected.score}
                      <span className="text-xs text-muted-foreground font-medium ml-1">/100</span>
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: scoreColors(selected.score, selected.band).fg }}>
                      {bandLabel(selected.band)}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11.5px] text-foreground/90 leading-snug">{verdict(selected)}</p>
                {/* Quick stats strip */}
                <div className="mt-2 grid grid-cols-4 gap-2 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  <Stat label="vs SPY" value={selected.rsVsSpy === null ? "—" : `${selected.rsVsSpy >= 0 ? "+" : ""}${selected.rsVsSpy.toFixed(2)}%`} pos={selected.rsVsSpy !== null && selected.rsVsSpy >= 0} neg={selected.rsVsSpy !== null && selected.rsVsSpy < 0} />
                  <Stat label="Rotation" value={selected.rotation === null ? "—" : `${selected.rotation >= 0 ? "+" : ""}${selected.rotation.toFixed(1)}`} pos={selected.rotation !== null && selected.rotation >= 3} neg={selected.rotation !== null && selected.rotation <= -3} />
                  <Stat label="Avg RS" value={selected.avgRs === null ? "—" : `${selected.avgRs}`} pos={selected.avgRs !== null && selected.avgRs >= 70} neg={selected.avgRs !== null && selected.avgRs <= 40} />
                  <Stat label="Rel Vol" value={selected.theme.avgRelVol === null ? "—" : `${selected.theme.avgRelVol.toFixed(2)}×`} pos={selected.theme.avgRelVol !== null && selected.theme.avgRelVol >= 1.4} neg={selected.theme.avgRelVol !== null && selected.theme.avgRelVol < 0.85} />
                </div>
              </div>

              {/* Key Drivers */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Zap size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Key Drivers</span>
                </div>
                {keyDrivers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Not enough signal data yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {keyDrivers.map((d, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-foreground/90">
                        <span style={{ color: d.tone === "pos" ? "hsl(170, 80%, 50%)" : d.tone === "neg" ? "hsl(0, 70%, 60%)" : "hsl(var(--muted-foreground))" }} className="mt-0.5 shrink-0">
                          {d.icon}
                        </span>
                        <span>{d.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
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

              {/* Catalyst Breakdown */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Flame size={12} style={{ color: "hsl(0, 80%, 62%)" }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Catalyst Breakdown</span>
                  </div>
                  <span className="text-[9.5px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                    {selected.catalyst.label} · {selected.catalyst.detail}
                  </span>
                </div>
                {loadingNews && topCatalysts.length === 0 ? (
                  <Skeleton className="h-12 w-full" />
                ) : topCatalysts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No notable catalysts detected.</p>
                ) : (
                  <div className="space-y-1.5">
                    {topCatalysts.map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block rounded-md p-2 transition-colors hover:bg-accent/40"
                        style={{ background: i === 0 ? "rgba(245, 166, 35, 0.06)" : "transparent", border: i === 0 ? "1px solid rgba(245, 166, 35, 0.18)" : "1px solid transparent" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-[12px] font-medium text-foreground leading-snug group-hover:text-primary transition-colors">
                            {i === 0 && <Flame size={10} className="inline mr-1" style={{ color: "hsl(40, 90%, 55%)" }} />}
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

              {/* Top Stocks to Watch */}
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Target size={12} className="text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Top Stocks to Watch</span>
                  <span className="text-[9px] text-muted-foreground ml-auto">RS-ranked</span>
                </div>
                {selected.topStocks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No qualified stocks in this theme.</p>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-[9px] uppercase tracking-wider text-muted-foreground border-b border-[rgba(255,255,255,0.06)]">
                        <th className="text-left py-1 font-medium">Ticker</th>
                        <th className="text-right py-1 font-medium">RS</th>
                        <th className="text-right py-1 font-medium">1D %</th>
                        <th className="text-right py-1 font-medium">1W %</th>
                        <th className="text-right py-1 font-medium">Tag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.topStocks.map((st) => (
                        <tr key={st.symbol} className="border-b border-[rgba(255,255,255,0.04)]">
                          <td className="py-1.5 font-bold text-foreground" style={{ fontFamily: DM_MONO }}>{st.symbol}</td>
                          <td className="py-1.5 text-right tabular-nums" style={{ fontFamily: DM_MONO, color: st.rs === null ? "hsl(var(--muted-foreground))" : st.rs >= 70 ? "hsl(170, 80%, 50%)" : st.rs <= 40 ? "hsl(0, 70%, 60%)" : "hsl(var(--foreground))" }}>
                            {st.rs === null ? "—" : st.rs}
                          </td>
                          <td className="py-1.5 text-right tabular-nums" style={{ fontFamily: DM_MONO, color: st.perf_1d >= 0 ? "hsl(170, 80%, 50%)" : "hsl(0, 70%, 60%)" }}>
                            {st.perf_1d >= 0 ? "+" : ""}{st.perf_1d.toFixed(2)}%
                          </td>
                          <td className="py-1.5 text-right tabular-nums" style={{ fontFamily: DM_MONO, color: st.perf_1w >= 0 ? "hsl(170, 80%, 50%)" : "hsl(0, 70%, 60%)" }}>
                            {st.perf_1w >= 0 ? "+" : ""}{st.perf_1w.toFixed(2)}%
                          </td>
                          <td className="py-1.5 text-right">
                            {st.isGrowth ? (
                              <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: "rgba(0,245,196,0.12)", color: "hsl(170, 90%, 50%)", border: "1px solid rgba(0,245,196,0.28)" }}>
                                Growth
                              </span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer note + legend */}
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground px-1 leading-snug">
                <Info size={10} className="text-primary mt-0.5 shrink-0" />
                <span>
                  Score blends vs-SPY (26%), Rotation (20%), Volume (18%), Momentum (14%),
                  Breadth (14%), Growth (8%). "Catalyst" only populates after a theme's news
                  is loaded.
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
