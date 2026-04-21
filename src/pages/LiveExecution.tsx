import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Star,
  StarOff,
  Activity,
  Zap,
  AlertTriangle,
  Info,
  X,
  CheckCircle2,
  XCircle,
  ShieldAlert,
} from "lucide-react";
import { useRsAlpha, type RsStock } from "@/hooks/useRsAlpha";
import { useLiveSnapshot, useLiveWatchlist, type LiveSnapshot, type BenchmarkSymbol } from "@/hooks/useLiveSnapshot";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import HelpButton from "@/components/HelpButton";

// ───────────────────────── helpers ─────────────────────────

function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}
function compactNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
function pctClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground";
  if (v > 0) return "text-[hsl(160,75%,45%)]";
  if (v < 0) return "text-destructive";
  return "text-muted-foreground";
}
function ratingClass(r: number | null): string {
  if (r === null) return "text-muted-foreground";
  if (r >= 80) return "text-[hsl(160,80%,45%)]";
  if (r >= 60) return "text-[hsl(160,70%,55%)]";
  if (r >= 40) return "text-[hsl(40,85%,55%)]";
  return "text-destructive";
}

interface VerdictFactor {
  label: string;
  status: "pos" | "neg" | "neu" | "na";
  note: string;
}
interface Verdict {
  label:
    | "Constructive Setup"
    | "Mixed — Watch & Wait"
    | "Weak Setup"
    | "Insufficient Data";
  color: string;
  bg: string;
  border: string;
  icon: typeof CheckCircle2;
  reason: string;
  factors: VerdictFactor[];
}

function buildVerdict(
  rating: number | null,
  accel: number | null,
  relVol: number | null,
  return1w: number | null,
): Verdict {
  // Multi-factor, explainable verdict. Each factor is scored independently and
  // shown to the user so the verdict isn't a black-box.
  const factors: VerdictFactor[] = [];

  if (rating === null) factors.push({ label: "RS Rating", status: "na", note: "Not in qualified universe" });
  else if (rating >= 70) factors.push({ label: "RS Rating", status: "pos", note: `Leader (RS ${rating})` });
  else if (rating < 40) factors.push({ label: "RS Rating", status: "neg", note: `Lagging (RS ${rating})` });
  else factors.push({ label: "RS Rating", status: "neu", note: `Average (RS ${rating})` });

  if (accel === null) factors.push({ label: "Acceleration", status: "na", note: "Insufficient history" });
  else if (accel >= 5) factors.push({ label: "Acceleration", status: "pos", note: `Improving (+${accel.toFixed(1)} pts)` });
  else if (accel <= -10) factors.push({ label: "Acceleration", status: "neg", note: `Decelerating (${accel.toFixed(1)} pts)` });
  else factors.push({ label: "Acceleration", status: "neu", note: `Stable (${accel >= 0 ? "+" : ""}${accel.toFixed(1)} pts)` });

  if (relVol === null) factors.push({ label: "Volume", status: "na", note: "No live volume" });
  else if (relVol >= 1.3) factors.push({ label: "Volume", status: "pos", note: `Above avg (${relVol.toFixed(2)}×)` });
  else if (relVol < 0.7) factors.push({ label: "Volume", status: "neg", note: `Below avg (${relVol.toFixed(2)}×)` });
  else factors.push({ label: "Volume", status: "neu", note: `Normal (${relVol.toFixed(2)}×)` });

  if (return1w === null) factors.push({ label: "Recent Action", status: "na", note: "—" });
  else if (return1w >= 15) factors.push({ label: "Recent Action", status: "neu", note: `Extended (+${return1w.toFixed(1)}% / 1W)` });
  else if (return1w <= -10) factors.push({ label: "Recent Action", status: "neg", note: `Sharp drop (${return1w.toFixed(1)}% / 1W)` });
  else factors.push({ label: "Recent Action", status: "neu", note: `${return1w >= 0 ? "+" : ""}${return1w.toFixed(1)}% / 1W` });

  if (rating === null) {
    return {
      label: "Insufficient Data",
      color: "text-muted-foreground",
      bg: "bg-muted/20",
      border: "border-border/40",
      icon: Info,
      reason:
        "This ticker isn't in the qualified RS universe, so we can't generate a confident multi-factor read. Treat anything shown here as preliminary context, not a recommendation.",
      factors,
    };
  }

  const posCount = factors.filter((f) => f.status === "pos").length;
  const negCount = factors.filter((f) => f.status === "neg").length;

  if (rating >= 70 && posCount >= 2 && negCount === 0) {
    return {
      label: "Constructive Setup",
      color: "text-[hsl(160,80%,45%)]",
      bg: "bg-[hsl(160,80%,45%)]/10",
      border: "border-[hsl(160,80%,45%)]/30",
      icon: CheckCircle2,
      reason:
        "Multiple factors line up favourably (relative strength, momentum, and volume). Worth deeper review — not an automatic buy. Confirm with your own entry rules.",
      factors,
    };
  }

  if (rating < 40 || negCount >= 2 || (accel !== null && accel <= -15)) {
    return {
      label: "Weak Setup",
      color: "text-destructive",
      bg: "bg-destructive/10",
      border: "border-destructive/30",
      icon: XCircle,
      reason:
        "Several factors are working against this name right now (lagging RS, fading momentum, or weak volume). Stronger setups usually exist elsewhere.",
      factors,
    };
  }

  return {
    label: "Mixed — Watch & Wait",
    color: "text-[hsl(40,85%,55%)]",
    bg: "bg-[hsl(40,85%,55%)]/10",
    border: "border-[hsl(40,85%,55%)]/30",
    icon: ShieldAlert,
    reason:
      "Signals are mixed — some constructive, some not. Wait for clearer confirmation (e.g. RS line breakout on rising volume) before committing.",
    factors,
  };
}

function buildEntrySignals(
  stock: RsStock | null,
  snapshot: LiveSnapshot | null,
  liveRs: { rs1d: number | null; rs1w: number | null; rs1m: number | null },
  benchmarkLabel: string,
): string[] {
  const out: string[] = [];
  const accel =
    liveRs.rs1w !== null && liveRs.rs1m !== null ? liveRs.rs1w - liveRs.rs1m : null;
  if (accel !== null && accel > 5) out.push("📈 RS accelerating — 1W relative strength stronger than 1M.");
  if (accel !== null && accel < -5) out.push("⚠️ RS decelerating — short-term weaker than longer-term.");
  if (liveRs.rs1d !== null && liveRs.rs1d > 1) out.push(`⚡ Outperforming ${benchmarkLabel} today (positive intraday RS).`);
  if (liveRs.rs1d !== null && liveRs.rs1d < -1) out.push(`🔻 Underperforming ${benchmarkLabel} today.`);
  if (stock?.adrPercent !== null && stock?.adrPercent !== undefined && stock.adrPercent >= 5)
    out.push(`🎯 High range stock (ADR ${stock.adrPercent.toFixed(1)}%) — expect larger daily swings.`);
  if (snapshot?.quote.volume && snapshot.quote.avgVolume) {
    const rv = snapshot.quote.volume / snapshot.quote.avgVolume;
    if (rv >= 1.5) out.push(`🔊 Volume confirming move — ${rv.toFixed(1)}× the 3-month average.`);
    else if (rv < 0.6) out.push("🔉 Volume below average — move lacks conviction.");
  }
  if (liveRs.rs1d !== null && liveRs.rs1d > 0 && (accel ?? 0) >= 0 && stock?.rsOverall !== null && (stock?.rsOverall ?? 0) > 5)
    out.push(`🚀 Trending leader holding above ${benchmarkLabel} — RS line near new highs.`);
  if (stock?.return1w !== null && stock?.return1w !== undefined && stock.return1w < -3 && stock.rsOverall !== null && (stock.rsOverall ?? 0) > 5)
    out.push("🟢 Pullback within a strong RS name — possible entry zone, confirm with price action.");
  return out;
}

// ───────────────────────── component ─────────────────────────

export default function LiveExecution() {
  const { stocks, isLoading: rsLoading } = useRsAlpha();
  const { snapshot, isLoading: snapLoading, error: snapError, fetchSnapshot, clear } = useLiveSnapshot();
  const { tickers: watchTickers, add: addWatch, remove: removeWatch, has: hasWatch } = useLiveWatchlist();

  const [input, setInput] = useState("");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkSymbol>("SPY");
  const debounceRef = useRef<number | null>(null);

  // Build a per-symbol map of RS data + a per-timeframe rating using the qualified universe.
  const { stockMap, ratingOverall, rating1w, rating1m } = useMemo(() => {
    const map = new Map<string, RsStock>();
    for (const s of stocks) map.set(s.symbol.toUpperCase(), s);
    const rOverall = computeRsRatings(stocks.map((s) => s.rsOverall));
    const r1w = computeRsRatings(stocks.map((s) => s.rs1w));
    const r1m = computeRsRatings(stocks.map((s) => s.rs1m));
    const ratingByOverall = new Map<string, number | null>();
    const ratingBy1w = new Map<string, number | null>();
    const ratingBy1m = new Map<string, number | null>();
    stocks.forEach((s, i) => {
      ratingByOverall.set(s.symbol.toUpperCase(), rOverall[i]);
      ratingBy1w.set(s.symbol.toUpperCase(), r1w[i]);
      ratingBy1m.set(s.symbol.toUpperCase(), r1m[i]);
    });
    return { stockMap: map, ratingOverall: ratingByOverall, rating1w: ratingBy1w, rating1m: ratingBy1m };
  }, [stocks]);

  const submit = (raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setActiveSymbol(sym);
    const sector = stockMap.get(sym)?.sector ?? null;
    fetchSnapshot(sym, benchmark, sector);
  };

  // Debounce input → auto-submit after 600ms when length >= 1
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (input.trim().length === 0) return;
    debounceRef.current = window.setTimeout(() => submit(input), 600);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Re-fetch snapshot when benchmark toggle changes (so RS values use the new baseline).
  useEffect(() => {
    if (activeSymbol) {
      const sector = stockMap.get(activeSymbol)?.sector ?? null;
      fetchSnapshot(activeSymbol, benchmark, sector);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchmark]);

  const activeStock = activeSymbol ? stockMap.get(activeSymbol) ?? null : null;
  const universeRank = useMemo(() => {
    if (!activeStock || activeStock.rsOverall === null) return null;
    const better = stocks.filter(
      (s) => s.rsOverall !== null && (s.rsOverall ?? -Infinity) > (activeStock.rsOverall ?? -Infinity),
    ).length;
    return { rank: better + 1, total: stocks.filter((s) => s.rsOverall !== null).length };
  }, [activeStock, stocks]);

  // ── Fresh, benchmark-aware RS values computed live from the snapshot ──
  // Replaces the (often stale) rs_1d/rs_1w/rs_1m stored against SPY in qualified_rs_universe.
  const liveRs = useMemo(() => {
    const empty = { rs1d: null as number | null, rs1w: null as number | null, rs1m: null as number | null, rs3m: null as number | null };
    if (!snapshot || !snapshot.quote || !snapshot.benchmark) return empty;
    const th = snapshot.tickerHistory ?? { return1w: null, return1m: null, return3m: null };
    const bh = snapshot.benchmark;
    const round = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
    const sub = (a: number | null | undefined, b: number | null | undefined) =>
      a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? null : (a as number) - (b as number);
    return {
      rs1d: round(sub(snapshot.quote.changePct, bh.changePct)),
      rs1w: round(sub(th.return1w, bh.return1w)),
      rs1m: round(sub(th.return1m, bh.return1m)),
      rs3m: round(sub(th.return3m, bh.return3m)),
    };
  }, [snapshot]);

  // RS acceleration: 1W rating vs 1M rating (universe-based, benchmark-agnostic ordinal rank).
  const accelDelta = useMemo(() => {
    if (!activeSymbol) return null;
    const r1w = rating1w.get(activeSymbol);
    const r1m = rating1m.get(activeSymbol);
    if (r1w === null || r1w === undefined || r1m === null || r1m === undefined) return null;
    return r1w - r1m;
  }, [activeSymbol, rating1w, rating1m]);

  const relVol =
    snapshot?.quote.volume && snapshot.quote.avgVolume
      ? snapshot.quote.volume / snapshot.quote.avgVolume
      : null;

  const overallRating = activeSymbol ? ratingOverall.get(activeSymbol) ?? null : null;

  // ── O'Neil weighted Conviction Score (0-100): 50% Market + 37% Industry + 13% Stock ──
  const conviction = useMemo(() => {
    const bh = snapshot?.benchmark;
    const scoreReturn = (r: number | null | undefined, perPctPoint = 5) => {
      if (r === null || r === undefined || !Number.isFinite(r)) return null;
      return Math.max(0, Math.min(100, 50 + (r as number) * perPctPoint));
    };
    const mDay = scoreReturn(bh?.changePct, 10);
    const mWeek = scoreReturn(bh?.return1w, 5);
    const mMonth = scoreReturn(bh?.return1m, 3);
    const mParts = [mDay, mWeek, mMonth].filter((v): v is number => v !== null);
    const marketScore = mParts.length > 0 ? mParts.reduce((a, b) => a + b, 0) / mParts.length : 50;

    const ih = snapshot?.industry;
    const iDay = scoreReturn(ih?.changePct, 10);
    const iWeek = scoreReturn(ih?.return1w, 5);
    const iMonth = scoreReturn(ih?.return1m, 3);
    const iParts = [iDay, iWeek, iMonth].filter((v): v is number => v !== null);
    const industryScore = iParts.length > 0
      ? iParts.reduce((a, b) => a + b, 0) / iParts.length
      : (ih?.available ? 50 : marketScore);

    let rsPart: number | null = overallRating;
    const accelPart = accelDelta === null ? null : Math.max(0, Math.min(100, 50 + accelDelta * 2));
    const volPart = relVol === null ? null : Math.max(0, Math.min(100, relVol * 50));
    const fd = snapshot?.fundamentals;
    let fundPart: number | null = null;
    if (fd?.available) {
      const pe = fd.forwardPe ?? fd.pe;
      let peScore: number | null = null;
      if (pe !== null && pe > 0) {
        if (pe < 15) peScore = 90;
        else if (pe < 25) peScore = 75;
        else if (pe < 40) peScore = 60;
        else if (pe < 60) peScore = 45;
        else peScore = 30;
      }
      let epsScore: number | null = null;
      const eg = fd.epsGrowth;
      if (eg !== null) {
        if (eg >= 0.5) epsScore = 95;
        else if (eg >= 0.25) epsScore = 80;
        else if (eg >= 0.10) epsScore = 65;
        else if (eg >= 0) epsScore = 55;
        else if (eg >= -0.15) epsScore = 40;
        else epsScore = 25;
      }
      let revScore: number | null = null;
      const rg = fd.revenueGrowth;
      if (rg !== null) {
        if (rg >= 0.30) revScore = 90;
        else if (rg >= 0.15) revScore = 75;
        else if (rg >= 0.05) revScore = 60;
        else if (rg >= 0) revScore = 50;
        else revScore = 30;
      }
      const parts = [peScore, epsScore, revScore].filter((v): v is number => v !== null);
      if (parts.length > 0) fundPart = parts.reduce((a, b) => a + b, 0) / parts.length;
    }

    const techParts = [rsPart, accelPart, volPart].filter((v): v is number => v !== null);
    const techScore = techParts.length > 0 ? techParts.reduce((a, b) => a + b, 0) / techParts.length : null;
    const stockScore =
      techScore === null && fundPart === null
        ? null
        : fundPart === null
        ? techScore!
        : techScore === null
        ? fundPart
        : techScore * 0.6 + fundPart * 0.4;

    if (stockScore === null) return null;

    const final = marketScore * 0.50 + industryScore * 0.37 + stockScore * 0.13;
    return {
      total: Math.round(final),
      market: Math.round(marketScore),
      industry: Math.round(industryScore),
      stock: Math.round(stockScore),
      hasFund: fundPart !== null,
      hasIndustry: ih?.available ?? false,
    };
  }, [snapshot, overallRating, accelDelta, relVol]);

  // ── Setup Quality Score (0-100) ──
  const setupQuality = useMemo(() => {
    if (overallRating === null) return null;
    let score = 0;
    let weight = 0;
    if (accelDelta !== null) {
      score += Math.max(0, Math.min(100, 50 + accelDelta * 4)) * 0.30;
      weight += 0.30;
    }
    if (relVol !== null) {
      score += Math.max(0, Math.min(100, relVol * 55)) * 0.25;
      weight += 0.25;
    }
    const r1w = activeStock?.return1w ?? null;
    if (r1w !== null && overallRating >= 70) {
      let pullScore = 50;
      if (r1w >= -8 && r1w <= -2) pullScore = 90;
      else if (r1w > -2 && r1w <= 5) pullScore = 70;
      else if (r1w > 5 && r1w <= 15) pullScore = 55;
      else if (r1w < -8 && r1w >= -15) pullScore = 45;
      else pullScore = 25;
      score += pullScore * 0.25;
      weight += 0.25;
    } else if (r1w !== null) {
      score += 50 * 0.20;
      weight += 0.20;
    }
    const ih = snapshot?.industry;
    if (ih?.available && ih.return1m !== null) {
      const align = ih.return1m >= 0 ? 80 : 35;
      score += align * 0.20;
      weight += 0.20;
    }
    if (weight === 0) return null;
    return Math.round(score / weight);
  }, [overallRating, accelDelta, relVol, activeStock, snapshot]);

  // ── Pullback Quality Detector ──
  const pullback = useMemo(() => {
    if (overallRating === null) return null;
    const r1w = activeStock?.return1w ?? null;
    const r1m = activeStock?.return1m ?? null;
    if (r1w === null) return null;
    const inUptrend = overallRating >= 65 && (r1m === null || r1m > 0);
    const isPullback = r1w <= -1 && r1w >= -10;
    const isBreakdown = r1w < -10 || (r1w < -3 && accelDelta !== null && accelDelta <= -10);
    if (isBreakdown && overallRating < 70) {
      return {
        kind: "breakdown" as const,
        label: "Unhealthy breakdown — momentum failing",
        note: `1W ${r1w.toFixed(1)}%, RS ${overallRating}${accelDelta !== null ? `, accel ${accelDelta.toFixed(0)} pts` : ""}. Wait for the structure to repair.`,
      };
    }
    if (inUptrend && isPullback && (relVol === null || relVol < 1.2)) {
      return {
        kind: "healthy" as const,
        label: "Healthy pullback in a strong trend — potential dip-buy",
        note: `1W ${r1w.toFixed(1)}% inside an RS ${overallRating} uptrend on quiet volume (${relVol !== null ? `${relVol.toFixed(2)}× avg` : "n/a"}). Confirm with a reversal candle on rising volume.`,
      };
    }
    return null;
  }, [overallRating, accelDelta, relVol, activeStock]);

  // ── Rotation Risk: strong stock inside a fading sector ──
  const rotationRisk = useMemo(() => {
    if (overallRating === null) return null;
    const ih = snapshot?.industry;
    if (!ih?.available) return null;
    if (ih.return1w === null || ih.return1m === null) return null;
    const sectorWeak = ih.return1w < -1 && ih.return1w < ih.return1m;
    if (overallRating >= 75 && sectorWeak) {
      return {
        sector: ih.sectorName ?? "sector",
        etf: ih.etfSymbol,
        sectorR1w: ih.return1w,
        sectorR1m: ih.return1m,
      };
    }
    return null;
  }, [overallRating, snapshot]);

  const verdict = buildVerdict(overallRating, accelDelta, relVol, activeStock?.return1w ?? null);
  const VerdictIcon = verdict.icon;
  const signals = buildEntrySignals(activeStock, snapshot, liveRs, benchmark);

  // Peers: same sector, top 5 by overall RS, excluding active
  const peers = useMemo(() => {
    if (!activeStock?.sector) return [];
    return stocks
      .filter(
        (s) =>
          s.sector === activeStock.sector &&
          s.symbol !== activeStock.symbol &&
          s.rsOverall !== null,
      )
      .sort((a, b) => (b.rsOverall ?? -Infinity) - (a.rsOverall ?? -Infinity))
      .slice(0, 5);
  }, [activeStock, stocks]);

  // Watchlist split-view mode
  const [watchMode, setWatchMode] = useState<"all" | "leaders" | "rotation">("all");
  const watchRows = useMemo(() => {
    const rows = watchTickers.map((sym) => {
      const s = stockMap.get(sym);
      return {
        sym,
        s,
        rating: ratingOverall.get(sym) ?? null,
        r1w: s?.return1w ?? null,
        r1m: s?.return1m ?? null,
      };
    });
    if (watchMode === "leaders") {
      return rows.filter((r) => r.rating !== null && r.rating >= 80);
    }
    if (watchMode === "rotation") {
      return rows.filter((r) => {
        if (r.rating === null || r.rating >= 80 || r.rating < 50) return false;
        if (r.r1w === null || r.r1m === null) return false;
        return r.r1w > r.r1m;
      });
    }
    return rows;
  }, [watchTickers, stockMap, ratingOverall, watchMode]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="container flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft size={16} />
              </Link>
              <div>
                <h1 className="font-['Syne',sans-serif] text-xl font-bold tracking-tight text-foreground">
                  Live Execution
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  Real-time trade decision tool · {stocks.length.toLocaleString()} qualified RS universe
                </p>
              </div>
            </div>
            <HelpButton />
          </div>
        </header>

        <main className="container py-5 space-y-5">
          {/* ── Quick Trade Check ── */}
          <section
            className="rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur-sm"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <h2 className="font-['Syne',sans-serif] text-sm font-semibold uppercase tracking-wider text-foreground">
                Quick Trade Check
              </h2>
              {rsLoading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Benchmark</span>
                <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5">
                  {(["SPY", "QQQ"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBenchmark(b)}
                      className={`rounded-sm px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
                        benchmark === b
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={11} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Switch the benchmark used for relative strength (RS) comparisons. SPY tracks the S&amp;P 500 (broad market); QQQ tracks the Nasdaq-100 (tech-heavy). RS values below recompute live.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="relative"
            >
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="Type or paste a ticker (e.g. AAPL, NVDA, TSLA)…"
                autoFocus
                spellCheck={false}
                maxLength={10}
                className="h-12 w-full rounded-lg border border-border bg-background/60 pl-10 pr-24 font-mono text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => {
                    setInput("");
                    setActiveSymbol(null);
                    clear();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </form>

            {snapError && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                {snapError}
              </div>
            )}

            {snapLoading && !snapshot && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Fetching live snapshot for {activeSymbol}…
              </div>
            )}

            {/* Verdict + overview card */}
            {activeSymbol && snapshot && (
              <div className="mt-4 space-y-3">
                {/* Top row: name + price + watchlist toggle */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-mono text-2xl font-bold text-foreground">{snapshot.symbol}</span>
                    <span className="text-sm text-muted-foreground">{snapshot.quote.shortName ?? "—"}</span>
                    {activeStock?.sector && (
                      <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {activeStock.sector}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-bold text-foreground">
                      ${num(snapshot.quote.price)}
                    </div>
                    <div className={`font-mono text-sm ${pctClass(snapshot.quote.changePct)}`}>
                      {pct(snapshot.quote.changePct)}
                    </div>
                  </div>
                </div>

                {/* Verdict badge */}
                <div
                  className={`flex items-start gap-3 rounded-lg border ${verdict.border} ${verdict.bg} p-3`}
                >
                  <VerdictIcon size={22} className={`shrink-0 ${verdict.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className={`font-['Syne',sans-serif] text-base font-bold ${verdict.color}`}>
                        {verdict.label}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help"><Info size={11} className="text-muted-foreground" /></span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          A descriptive read of the current setup based on multiple factors. This is context, not a buy/sell recommendation — always confirm with your own rules.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-foreground/80">{verdict.reason}</p>
                    {/* Factor breakdown chips */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {verdict.factors.map((f) => {
                        const cls =
                          f.status === "pos"
                            ? "border-[hsl(160,80%,45%)]/40 bg-[hsl(160,80%,45%)]/10 text-[hsl(160,80%,45%)]"
                            : f.status === "neg"
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : f.status === "na"
                            ? "border-border/40 bg-muted/20 text-muted-foreground"
                            : "border-border/40 bg-background/40 text-foreground/80";
                        return (
                          <span
                            key={f.label}
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}
                          >
                            <span className="font-semibold">{f.label}:</span> {f.note}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      hasWatch(snapshot.symbol)
                        ? removeWatch(snapshot.symbol)
                        : addWatch(snapshot.symbol)
                    }
                    className="shrink-0 rounded-md border border-border bg-background/60 p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={hasWatch(snapshot.symbol) ? "Remove from live watchlist" : "Pin to live watchlist"}
                  >
                    {hasWatch(snapshot.symbol) ? (
                      <Star size={14} className="fill-[hsl(40,85%,55%)] text-[hsl(40,85%,55%)]" />
                    ) : (
                      <StarOff size={14} />
                    )}
                  </button>
                </div>

                {/* Metric grid */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <MetricCard
                    label="RS Rating"
                    tooltip="Relative Strength rank from 1–99 within the qualified universe. 80+ = leader, 40-79 = average, <40 = laggard."
                    value={overallRating !== null ? `${overallRating}` : "N/A"}
                    sub={
                      universeRank
                        ? `Rank ${universeRank.rank.toLocaleString()} / ${universeRank.total.toLocaleString()}`
                        : "Not in universe"
                    }
                    valueClass={ratingClass(overallRating)}
                  />
                  <MetricCard
                    label="Conviction"
                    tooltip="O'Neil-weighted score (0-100): 50% Market strength + 37% Industry/sector strength + 13% Individual stock (RS, accel, volume, P/E and growth)."
                    value={conviction !== null ? `${conviction.total}` : "—"}
                    sub={
                      conviction === null
                        ? "Need RS data"
                        : conviction.total >= 70
                        ? "High conviction"
                        : conviction.total >= 50
                        ? "Medium"
                        : "Low conviction"
                    }
                    valueClass={ratingClass(conviction?.total ?? null)}
                  />
                  <MetricCard
                    label="Setup Quality"
                    tooltip="0-100 score for how clean the entry is RIGHT NOW: RS acceleration, volume confirmation, pullback depth in a strong trend, and theme alignment."
                    value={setupQuality !== null ? `${setupQuality}` : "—"}
                    sub={
                      setupQuality === null
                        ? "Need RS data"
                        : setupQuality >= 70
                        ? "Clean setup"
                        : setupQuality >= 50
                        ? "Acceptable"
                        : "Poor setup"
                    }
                    valueClass={ratingClass(setupQuality)}
                  />
                  <MetricCard
                    label="Rel Volume"
                    tooltip="Today's volume vs 3-month average. >1.5× signals confirmation; <0.6× signals weak conviction."
                    value={relVol !== null ? `${relVol.toFixed(2)}×` : "—"}
                    sub={
                      relVol === null
                        ? "—"
                        : relVol >= 1.5
                        ? "Above average"
                        : relVol < 0.6
                        ? "Below average"
                        : "Normal"
                    }
                    valueClass={
                      relVol === null
                        ? "text-muted-foreground"
                        : relVol >= 1.5
                        ? "text-[hsl(160,80%,45%)]"
                        : relVol < 0.6
                        ? "text-destructive"
                        : "text-foreground"
                    }
                  />
                  <MetricCard
                    label="ADR%"
                    tooltip="Average Daily Range — typical % move per day. Higher ADR = bigger swings, requires wider stops."
                    value={activeStock?.adrPercent !== null && activeStock?.adrPercent !== undefined ? `${activeStock.adrPercent.toFixed(1)}%` : "—"}
                    sub={
                      activeStock?.adrPercent && activeStock.adrPercent >= 5
                        ? "High volatility"
                        : "Normal"
                    }
                    valueClass="text-foreground"
                  />
                </div>

                {/* Conviction Breakdown */}
                {conviction && (
                  <ConvictionBreakdown
                    total={conviction.total}
                    market={conviction.market}
                    industry={conviction.industry}
                    stock={conviction.stock}
                    benchmarkLabel={benchmark}
                    sectorName={snapshot?.industry?.sectorName ?? null}
                    sectorEtf={snapshot?.industry?.etfSymbol ?? null}
                    fundamentals={snapshot?.fundamentals ?? null}
                    hasIndustry={conviction.hasIndustry}
                    hasFund={conviction.hasFund}
                  />
                )}

                {/* Pullback / Breakdown callout */}
                {pullback && (
                  <div
                    className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                      pullback.kind === "healthy"
                        ? "border-[hsl(160,80%,45%)]/30 bg-[hsl(160,80%,45%)]/10"
                        : "border-destructive/30 bg-destructive/10"
                    }`}
                  >
                    {pullback.kind === "healthy" ? (
                      <TrendingDown size={14} className="mt-0.5 shrink-0 text-[hsl(160,80%,45%)]" />
                    ) : (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
                    )}
                    <div>
                      <div className={`font-semibold ${pullback.kind === "healthy" ? "text-[hsl(160,80%,45%)]" : "text-destructive"}`}>
                        {pullback.label}
                      </div>
                      <div className="mt-0.5 text-foreground/80">{pullback.note}</div>
                    </div>
                  </div>
                )}

                {/* Rotation Risk warning */}
                {rotationRisk && (
                  <div className="flex items-start gap-2 rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/10 p-3 text-xs">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[hsl(40,85%,55%)]" />
                    <div>
                      <div className="font-semibold text-[hsl(40,85%,55%)]">
                        Rotation Risk — strong stock, weakening sector
                      </div>
                      <div className="mt-0.5 text-foreground/80">
                        {rotationRisk.sector} ({rotationRisk.etf}) is fading: 1W {pct(rotationRisk.sectorR1w)} vs 1M {pct(rotationRisk.sectorR1m)}.
                        Leaders inside fading sectors often roll over next. Tighten stops or wait for sector to stabilise.
                      </div>
                    </div>
                  </div>
                )}

                {/* RS trend across timeframes — recomputed live against the chosen benchmark */}
                {snapshot && (
                  <div>
                    <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>RS vs {benchmark} (% outperformance)</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help"><Info size={10} /></span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          How much the stock outperformed (or underperformed) {benchmark} over each window. 1D uses live intraday change vs {benchmark}'s intraday change; 1W/1M/3M use Yahoo historical closes. Positive = stronger than {benchmark}; negative = weaker.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <RsTrendCell label="1D" value={liveRs.rs1d} />
                      <RsTrendCell label="1W" value={liveRs.rs1w} />
                      <RsTrendCell label="1M" value={liveRs.rs1m} />
                      <RsTrendCell label="3M" value={liveRs.rs3m} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {benchmark} today: <span className={pctClass(snapshot.benchmark.changePct)}>{pct(snapshot.benchmark.changePct)}</span>
                      {snapshot.benchmark.return1w !== null && (<>{" · 1W "}<span className={pctClass(snapshot.benchmark.return1w)}>{pct(snapshot.benchmark.return1w)}</span></>)}
                      {snapshot.benchmark.return1m !== null && (<>{" · 1M "}<span className={pctClass(snapshot.benchmark.return1m)}>{pct(snapshot.benchmark.return1m)}</span></>)}
                    </div>
                  </div>
                )}

                {/* Acceleration callout */}
                {accelDelta !== null && (
                  <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs">
                    {accelDelta > 0 ? (
                      <TrendingUp size={13} className="text-[hsl(160,80%,45%)]" />
                    ) : accelDelta < 0 ? (
                      <TrendingDown size={13} className="text-destructive" />
                    ) : (
                      <Minus size={13} className="text-muted-foreground" />
                    )}
                    <span className="text-foreground">
                      RS Acceleration: <span className={pctClass(accelDelta)}>{accelDelta > 0 ? "+" : ""}{accelDelta.toFixed(1)} pts</span>{" "}
                      <span className="text-muted-foreground">(1W rating vs 1M rating)</span>
                    </span>
                  </div>
                )}

                {/* Entry signals */}
                {signals.length > 0 && (
                  <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Activity size={11} /> Entry & Rotation Signals
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help"><Info size={10} /></span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Pattern flags derived from RS, volume, and recent price action. They highlight conditions historically associated with good (or risky) entries — they are not buy/sell signals on their own.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <ul className="space-y-1 text-xs text-foreground/85">
                      {signals.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!activeSymbol && !snapLoading && (
              <p className="mt-4 text-xs text-muted-foreground">
                Type a ticker symbol above to instantly evaluate it. The verdict combines RS Rating, momentum acceleration, and volume to tell you whether it's worth entering right now.
              </p>
            )}
          </section>

          {/* ── Options Activity ── */}
          {snapshot && (
            <section
              className="rounded-xl border border-border/60 p-4"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-['Syne',sans-serif] text-sm font-semibold uppercase tracking-wider text-foreground">
                  Options Activity
                </h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={12} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Options are contracts traders use to bet on a stock's direction. This panel translates the most recent options activity into plain English.
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Source: Yahoo Finance · Nearest expiration
                </span>
              </div>

              {!snapshot.options.available ? (
                <p className="text-xs text-muted-foreground">No options data available for this ticker.</p>
              ) : (
                <div className="space-y-3">
                  {/* Sentiment */}
                  <div
                    className={`rounded-lg border p-3 ${
                      snapshot.options.sentiment === "Bullish"
                        ? "border-[hsl(160,80%,45%)]/30 bg-[hsl(160,80%,45%)]/10"
                        : snapshot.options.sentiment === "Bearish"
                        ? "border-destructive/30 bg-destructive/10"
                        : "border-border/40 bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Overall Sentiment
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help"><Info size={11} className="text-muted-foreground" /></span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Based on the ratio of put-buying vs call-buying. Calls = bullish bets, Puts = bearish bets.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span
                        className={`font-['Syne',sans-serif] text-base font-bold ${
                          snapshot.options.sentiment === "Bullish"
                            ? "text-[hsl(160,80%,45%)]"
                            : snapshot.options.sentiment === "Bearish"
                            ? "text-destructive"
                            : "text-foreground"
                        }`}
                      >
                        {snapshot.options.sentiment}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-foreground/80">{snapshot.options.sentiment_explanation}</p>
                  </div>

                  {/* Three quick metric tiles */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <OptionsTile
                      label="Put / Call Ratio"
                      tooltip="Total put-contract volume divided by total call-contract volume on the nearest expiration. Below ~0.7 leans bullish, above ~1.3 leans bearish, in between is balanced."
                      value={snapshot.options.put_call_ratio !== null ? snapshot.options.put_call_ratio.toFixed(2) : "—"}
                      explain={
                        snapshot.options.put_call_ratio === null
                          ? "Not enough volume to calculate reliably."
                          : snapshot.options.put_call_ratio < 0.7
                          ? `${snapshot.options.put_call_ratio.toFixed(2)} → More calls than puts being traded (mild bullish lean).`
                          : snapshot.options.put_call_ratio > 1.3
                          ? `${snapshot.options.put_call_ratio.toFixed(2)} → More puts than calls (mild bearish / hedging lean).`
                          : `${snapshot.options.put_call_ratio.toFixed(2)} → Calls and puts roughly balanced.`
                      }
                    />
                    <OptionsTile
                      label="Implied Volatility"
                      tooltip="The market's expectation of future price swings, priced into options. Higher IV = more expensive options and bigger expected moves. Above ~60% is elevated."
                      value={snapshot.options.avg_iv !== null ? `${(snapshot.options.avg_iv * 100).toFixed(0)}%` : "—"}
                      explain={snapshot.options.iv_explanation || "Not enough data to estimate expected movement."}
                      highlight={snapshot.options.high_iv_alert}
                    />
                    <OptionsTile
                      label="Calls / Puts Volume"
                      tooltip="Total contracts traded today on the nearest expiration. Higher activity generally means stronger directional interest from options traders."
                      value={`${compactNum(snapshot.options.total_call_volume)} / ${compactNum(snapshot.options.total_put_volume)}`}
                      explain={`${compactNum(snapshot.options.total_call_volume)} call contracts vs ${compactNum(snapshot.options.total_put_volume)} put contracts traded today.`}
                    />
                  </div>

                  {/* Unusual activity */}
                  {snapshot.options.unusual_activity.length > 0 ? (
                    <div className="rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/10 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(40,85%,55%)]">
                        <AlertTriangle size={11} /> Unusual Options Activity
                      </div>
                      <ul className="space-y-1 text-xs text-foreground/85">
                        {snapshot.options.unusual_activity.map((u, i) => (
                          <li key={i}>• {u}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Unusual = today's contract volume more than 3× the existing open interest at that strike.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
                      No significant unusual options activity detected today.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Peers ── */}
          {peers.length > 0 && (
            <section
              className="rounded-xl border border-border/60 p-4"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-['Syne',sans-serif] text-sm font-semibold uppercase tracking-wider text-foreground">
                  Peers in {activeStock?.sector}
                </h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={12} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Top names in the same sector by RS Overall. Useful to compare relative strength against direct competitors and spot the actual sector leader.
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto text-[10px] text-muted-foreground">Click a symbol to evaluate it</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 text-left">Symbol</th>
                      <th className="py-2 text-left">Company</th>
                      <th className="py-2 text-right" title="1–99 rank within the qualified universe (higher = stronger)">RS Rating</th>
                      <th className="py-2 text-right" title="Raw composite RS score (used to derive RS Rating)">RS Overall</th>
                      <th className="py-2 text-right">1M Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peers.map((p) => {
                      const r = ratingOverall.get(p.symbol.toUpperCase()) ?? null;
                      return (
                        <tr key={p.symbol} className="border-b border-border/20 hover:bg-muted/20">
                          <td className="py-2">
                            <button
                              onClick={() => {
                                setInput(p.symbol);
                                submit(p.symbol);
                              }}
                              className="font-mono font-semibold text-primary hover:underline"
                            >
                              {p.symbol}
                            </button>
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[200px]">
                            {p.companyName ?? "—"}
                          </td>
                          <td className={`py-2 text-right font-mono font-semibold ${ratingClass(r)}`}>
                            {r ?? "—"}
                          </td>
                          <td className="py-2 text-right font-mono text-foreground">
                            {num(p.rsOverall)}
                          </td>
                          <td className={`py-2 text-right font-mono ${pctClass(p.return1m)}`}>
                            {pct(p.return1m)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Live Watchlist ── */}
          <section
            className="rounded-xl border border-border/60 p-4"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h2 className="font-['Syne',sans-serif] text-sm font-semibold uppercase tracking-wider text-foreground">
                  Live Watchlist
                </h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={12} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Tickers you've pinned for quick re-evaluation. Use the toggle to focus on outright Leaders (RS ≥ 80) or Rotation Watch candidates (improving RS but still lagging).
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5 text-[10px]">
                  {([
                    { v: "all", label: "All" },
                    { v: "leaders", label: "Leaders" },
                    { v: "rotation", label: "Rotation Watch" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setWatchMode(opt.v)}
                      className={`rounded-sm px-2 py-0.5 font-mono font-semibold transition-colors ${
                        watchMode === opt.v
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {watchRows.length} / {watchTickers.length} shown
                </span>
              </div>
            </div>
            {watchTickers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Pin tickers from the verdict card above to track their RS, conviction, and momentum here.
              </p>
            ) : watchRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {watchMode === "leaders"
                  ? "No pinned tickers currently rate as outright leaders (RS ≥ 80)."
                  : "No pinned tickers fit the rotation profile right now (RS 50–79 with 1W stronger than 1M)."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 text-left">Symbol</th>
                      <th className="py-2 text-right">RS Rating</th>
                      <th className="py-2 text-right">RS Overall</th>
                      <th className="py-2 text-right">1W Return</th>
                      <th className="py-2 text-right">1M Return</th>
                      <th className="py-2 text-right">ADR%</th>
                      <th className="py-2 text-right w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchRows.map(({ sym, s, rating, r1w, r1m }) => (
                      <tr key={sym} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="py-2">
                          <button
                            onClick={() => {
                              setInput(sym);
                              submit(sym);
                            }}
                            className="font-mono font-semibold text-primary hover:underline"
                          >
                            {sym}
                          </button>
                        </td>
                        <td className={`py-2 text-right font-mono font-semibold ${ratingClass(rating)}`}>
                          {rating ?? "—"}
                        </td>
                        <td className="py-2 text-right font-mono text-foreground">
                          {s ? num(s.rsOverall) : "—"}
                        </td>
                        <td className={`py-2 text-right font-mono ${pctClass(r1w)}`}>
                          {pct(r1w)}
                        </td>
                        <td className={`py-2 text-right font-mono ${pctClass(r1m)}`}>
                          {pct(r1m)}
                        </td>
                        <td className="py-2 text-right font-mono text-foreground">
                          {s?.adrPercent !== null && s?.adrPercent !== undefined ? `${s.adrPercent.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => removeWatch(sym)}
                            className="text-muted-foreground hover:text-destructive"
                            title="Remove"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </TooltipProvider>
  );
}

// ───────────────────────── small components ─────────────────────────

function MetricCard({
  label,
  value,
  sub,
  tooltip,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string;
  sub?: string;
  tooltip?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help"><Info size={10} className="text-muted-foreground" /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={`font-mono text-xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function RsTrendCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-border/30 bg-background/30 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">RS {label}</div>
      <div className={`font-mono text-base font-semibold ${pctClass(value)}`}>{pct(value, 2)}</div>
    </div>
  );
}

function OptionsTile({
  label,
  value,
  explain,
  tooltip,
  highlight = false,
}: {
  label: string;
  value: string;
  explain: string;
  tooltip?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-[hsl(40,85%,55%)]/40 bg-[hsl(40,85%,55%)]/5" : "border-border/40 bg-background/40"
      }`}
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help"><Info size={10} /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={`font-mono text-lg font-bold ${highlight ? "text-[hsl(40,85%,55%)]" : "text-foreground"}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-foreground/75">{explain}</div>
    </div>
  );
}
