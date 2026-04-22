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
  HelpCircle,
  RefreshCw,
} from "lucide-react";
import { useRsAlpha, type RsStock } from "@/hooks/useRsAlpha";
import { useLiveSnapshot, useLiveWatchlist, type LiveSnapshot, type BenchmarkSymbol } from "@/hooks/useLiveSnapshot";
import { supabase } from "@/integrations/supabase/client";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import HelpButton from "@/components/HelpButton";
import { gicsForIndustry } from "@/lib/sectorTaxonomy";

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
function clampScore(v: number): number {
  return Math.max(0, Math.min(100, v));
}
function scoreReturnTo100(v: number | null | undefined, perPctPoint = 5): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return clampScore(50 + v * perPctPoint);
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

// ───────────────────────── "Why?" explanation engine ─────────────────────────

type WhyTopic =
  | "verdict"
  | "conviction"
  | "setup"
  | "rs"
  | "relVol"
  | "fundamentals"
  | "pullback"
  | "rotation";

interface WhySection {
  heading: string;
  body: string;
  rows?: { label: string; value: string; tone?: "pos" | "neg" | "neu" | "na" }[];
}

interface WhyContent {
  title: string;
  subtitle: string;
  sections: WhySection[];
  footer?: string;
}

function toneClass(t?: "pos" | "neg" | "neu" | "na"): string {
  if (t === "pos") return "text-[hsl(160,80%,45%)]";
  if (t === "neg") return "text-destructive";
  if (t === "na") return "text-muted-foreground italic";
  return "text-foreground";
}

interface WhyArgs {
  topic: WhyTopic;
  symbol: string | null;
  benchmark: BenchmarkSymbol;
  verdict: ReturnType<typeof buildVerdict>;
  conviction: {
    total: number;
    rs: number | null;
    theme: number | null;
    fund: number | null;
    opt: number | null;
    hasFund: boolean;
    hasIndustry: boolean;
    hasOptions: boolean;
    themeDetail: {
      label: string | null;
      matchedCount: number;
      avgRating: number | null;
      leaderPct: number | null;
      etfBacked: boolean;
    };
    fundDetail: { peScore: number | null; epsScore: number | null; revScore: number | null; peJustified: boolean };
    effectiveWeights: { rs: number | null; theme: number | null; fund: number | null; opt: number | null };
    contributions: { rs: number | null; theme: number | null; fund: number | null; opt: number | null };
  } | null;
  setupQuality: number | null;
  overallRating: number | null;
  accelDelta: number | null;
  relVol: number | null;
  pullback: { kind: "healthy" | "breakdown"; label: string; note: string } | null;
  rotationRisk: { sector: string; etf: string | null; sectorR1w: number; sectorR1m: number } | null;
  snapshot: LiveSnapshot | null;
  activeStock: RsStock | null;
}

function buildWhyContent(args: WhyArgs): WhyContent {
  const { topic, symbol, benchmark, verdict, conviction, setupQuality, overallRating, accelDelta, relVol, pullback, rotationRisk, snapshot, activeStock } = args;
  const sym = symbol ?? "—";
  const fd = snapshot?.fundamentals;
  const ih = snapshot?.industry;

  if (topic === "verdict") {
    return {
      title: `Verdict: ${verdict.label}`,
      subtitle: `Multi-factor read for ${sym} — built from RS, momentum, volume and recent price action.`,
      sections: [
        {
          heading: "Why this verdict",
          body: verdict.reason,
          rows: verdict.factors.map((f) => ({ label: f.label, value: f.note, tone: f.status })),
        },
        {
          heading: "How it's decided",
          body:
            "• Constructive Setup → RS Rating ≥ 70, ≥ 2 positive factors, no negatives.\n" +
            "• Weak Setup → RS Rating < 40, OR ≥ 2 negative factors, OR RS acceleration ≤ −15 pts.\n" +
            "• Mixed — Watch & Wait → anything in between (some positives, some negatives).\n" +
            "• Insufficient Data → ticker is not in the qualified RS universe yet.",
        },
      ],
      footer: "This is descriptive context, not a buy/sell recommendation. Always confirm with your own entry rules.",
    };
  }

  if (topic === "conviction") {
    if (!conviction) {
      return {
        title: "Conviction Score — Not available",
        subtitle: `${sym} doesn't have enough data to compute a conviction score yet.`,
        sections: [
          {
            heading: "What's missing",
            body:
              overallRating === null
                ? "RS Rating is required (the stock isn't in the qualified universe). The score will appear once it qualifies."
                : "Live snapshot data is incomplete. Try refreshing the ticker.",
          },
        ],
      };
    }
    const desc = (s: number | null, name: string) =>
      s === null ? `${name} not available — weight redistributed to other pillars` :
      s >= 70 ? "strong" : s >= 50 ? "neutral" : "weak";

    const fundLines: { label: string; value: string; tone?: "pos" | "neg" | "neu" | "na" }[] = [];
    if (conviction.hasFund && fd) {
      const pe = fd.forwardPe ?? fd.pe;
      const sectorPe = (snapshot as any)?.sectorPeAvg as number | null | undefined;
      if (pe !== null && pe > 0) {
        const ratio = sectorPe ? pe / sectorPe : null;
        const tone = ratio === null ? "neu" : ratio < 1.1 ? "pos" : ratio < 1.7 ? "neu" : "neg";
        fundLines.push({
          label: pe === fd.forwardPe ? "Forward P/E" : "P/E",
          value: sectorPe ? `${pe.toFixed(1)} (sector avg ~${sectorPe.toFixed(0)})` : pe.toFixed(1),
          tone,
        });
      }
      if (fd.epsGrowth !== null) {
        const v = fd.epsGrowth * 100;
        const tone = v >= 25 ? "pos" : v >= 0 ? "neu" : "neg";
        fundLines.push({ label: "EPS growth (YoY)", value: `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, tone });
      }
      if (fd.revenueGrowth !== null) {
        const v = fd.revenueGrowth * 100;
        const tone = v >= 15 ? "pos" : v >= 0 ? "neu" : "neg";
        fundLines.push({ label: "Revenue growth (YoY)", value: `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, tone });
      }
      if (conviction.fundDetail.peJustified) {
        fundLines.push({ label: "Valuation note", value: "High P/E justified by strong growth — no penalty applied", tone: "pos" });
      }
    }

    return {
      title: `Overall Conviction: ${conviction.total} / 100`,
      subtitle: `Weighted blend — 40% RS · 30% Theme · 20% Fundamentals · 10% Options. Missing pillars are dropped (weight redistributed).`,
      sections: [
        {
          heading: `Pillar breakdown for ${sym}`,
          body: "Each pillar is scored 0–100 from real data and combined with the weights above.",
          rows: [
            { label: "RS Rating — 40%", value: conviction.rs !== null ? `${conviction.rs} (${desc(conviction.rs, "RS")})` : "n/a", tone: conviction.rs === null ? "na" : conviction.rs >= 70 ? "pos" : conviction.rs < 40 ? "neg" : "neu" },
            { label: `Theme${ih?.etfSymbol ? ` (${ih.etfSymbol})` : ""} — 30%`, value: conviction.theme !== null ? `${conviction.theme} (${desc(conviction.theme, "Theme")})` : "n/a (no sector mapping)", tone: conviction.theme === null ? "na" : conviction.theme >= 70 ? "pos" : conviction.theme < 50 ? "neg" : "neu" },
            { label: "Fundamentals — 20%", value: conviction.fund !== null ? `${conviction.fund} (${desc(conviction.fund, "Fundamentals")})` : "n/a (no fundamentals)", tone: conviction.fund === null ? "na" : conviction.fund >= 70 ? "pos" : conviction.fund < 50 ? "neg" : "neu" },
            { label: "Options activity — 10%", value: conviction.opt !== null ? `${conviction.opt} (${desc(conviction.opt, "Options")})` : "n/a", tone: conviction.opt === null ? "na" : conviction.opt >= 70 ? "pos" : conviction.opt < 50 ? "neg" : "neu" },
          ],
        },
        {
          heading: "RS pillar (40%)",
          body:
            "Built directly from the RS Rating (1–99 rank within the qualified universe), with a small boost/penalty from RS acceleration (1W rating vs 1M rating). RS is the single best predictor of future relative performance, so it carries the largest weight.",
        },
        {
          heading: "Theme pillar (30%)",
          body: ih?.available
            ? `Sector strength from ${ih.sectorName ?? "the sector"} (${ih.etfSymbol}) — averages 1D, 1W and 1M ETF returns. A leader inside a strong group has a structural tailwind.`
            : "No reliable sector ETF mapping — this pillar is dropped and its weight is redistributed to the others.",
        },
        {
          heading: "Fundamentals pillar (20%)",
          body:
            "Growth-focused, growth-adjusted. EPS growth and revenue growth carry equal weight with valuation. P/E is compared to the sector average; a high P/E is NOT penalised when EPS growth ≥ 25% or revenue growth ≥ 20%.",
          rows: fundLines,
        },
        {
          heading: "Options pillar (10%)",
          body: conviction.hasOptions
            ? "Based on the options-flow sentiment (Put/Call ratio) with a small adjustment for elevated implied volatility (premiums getting expensive = crowded entry)."
            : "No usable options data today — this pillar is dropped and weight redistributes.",
        },
      ],
      footer: `Weighted total = ${conviction.total} / 100. Missing pillars are dropped before weighting so the score isn't artificially deflated.`,
    };
  }

  if (topic === "setup") {
    if (setupQuality === null) {
      return {
        title: "Setup Quality — Not available",
        subtitle: `${sym} needs an RS Rating before a setup score can be computed.`,
        sections: [{ heading: "What's missing", body: "Stock isn't in the qualified RS universe, or RS data hasn't loaded yet." }],
      };
    }
    const r1w = activeStock?.return1w ?? null;
    return {
      title: `Setup Quality: ${setupQuality} / 100`,
      subtitle: "How clean the entry is RIGHT NOW (different from Conviction, which judges the regime).",
      sections: [
        {
          heading: "Inputs",
          body: "Each input is normalised 0–100 and weighted, then averaged across whatever data is available.",
          rows: [
            { label: "RS acceleration (30%)", value: accelDelta !== null ? `${accelDelta >= 0 ? "+" : ""}${accelDelta.toFixed(1)} pts` : "n/a", tone: accelDelta === null ? "na" : accelDelta >= 5 ? "pos" : accelDelta <= -5 ? "neg" : "neu" },
            { label: "Volume confirmation (25%)", value: relVol !== null ? `${relVol.toFixed(2)}× avg` : "n/a", tone: relVol === null ? "na" : relVol >= 1.3 ? "pos" : relVol < 0.7 ? "neg" : "neu" },
            { label: "Pullback depth in uptrend (25%)", value: r1w !== null ? `1W ${r1w >= 0 ? "+" : ""}${r1w.toFixed(1)}%` : "n/a", tone: r1w === null ? "na" : (r1w >= -8 && r1w <= -2) ? "pos" : (r1w > -2 && r1w <= 5) ? "neu" : "neg" },
            { label: "Sector alignment (20%)", value: ih?.available && ih.return1m !== null ? `${ih.etfSymbol} 1M ${pct(ih.return1m, 1)}` : "n/a", tone: !ih?.available || ih.return1m === null ? "na" : ih.return1m >= 0 ? "pos" : "neg" },
          ],
        },
        {
          heading: "How to read the score",
          body:
            "• 70+ → Clean setup: trend up, volume confirming, pullback shallow, sector aligned.\n" +
            "• 50–69 → Acceptable: some friction, manage size carefully.\n" +
            "• < 50 → Poor: signals are working against the entry, expect chop.",
        },
      ],
    };
  }

  if (topic === "rs") {
    return {
      title: `RS Rating: ${overallRating !== null ? overallRating : "N/A"}`,
      subtitle: "Relative Strength rank from 1–99 within the qualified universe.",
      sections: [
        {
          heading: "Reading the number",
          body:
            "RS is computed from a blended return across multiple timeframes vs the universe. 99 = strongest. 1 = weakest.",
          rows: [
            { label: "80+", value: "Leader — institutional accumulation candidate", tone: "pos" },
            { label: "60–79", value: "Above average — worth monitoring", tone: "neu" },
            { label: "40–59", value: "Average — usually not a buy candidate", tone: "neu" },
            { label: "< 40", value: "Laggard — avoid for long setups", tone: "neg" },
          ],
        },
        {
          heading: `Acceleration (1W RS − 1M RS)`,
          body:
            accelDelta === null
              ? "Not enough timeframe data yet to compute acceleration."
              : `Currently ${accelDelta >= 0 ? "+" : ""}${accelDelta.toFixed(1)} pts. Positive = recent strength is improving vs the longer trend (constructive). Strongly negative (≤ −10 pts) = momentum fading even if the headline RS is still high.`,
        },
      ],
    };
  }

  if (topic === "relVol") {
    return {
      title: `Relative Volume: ${relVol !== null ? `${relVol.toFixed(2)}×` : "—"}`,
      subtitle: "Today's trading volume vs the 3-month average.",
      sections: [
        {
          heading: "Why it matters",
          body:
            "Volume confirms (or rejects) price moves. A breakout on heavy volume is institutional. A breakout on light volume often fails.",
        },
        {
          heading: "Thresholds used here",
          body: "",
          rows: [
            { label: "≥ 1.5×", value: "Above average — move has conviction", tone: "pos" },
            { label: "0.7×–1.5×", value: "Normal range", tone: "neu" },
            { label: "< 0.7×", value: "Below average — move lacks conviction", tone: "neg" },
          ],
        },
        {
          heading: "Live numbers",
          body: "",
          rows: [
            { label: "Today's volume", value: snapshot?.quote.volume ? compactNum(snapshot.quote.volume) : "—" },
            { label: "3-month avg", value: snapshot?.quote.avgVolume ? compactNum(snapshot.quote.avgVolume) : "—" },
          ],
        },
      ],
    };
  }

  if (topic === "fundamentals") {
    if (!fd?.available) {
      return {
        title: "Fundamentals — Not available",
        subtitle: `Yahoo Finance didn't return clean fundamental data for ${sym}.`,
        sections: [
          {
            heading: "What this means",
            body:
              "The Conviction Score's stock component is using technicals only (RS, acceleration, volume). The score is still valid; it just leans more on the chart than the books.",
          },
        ],
      };
    }
    const pe = fd.forwardPe ?? fd.pe;
    return {
      title: "Fundamentals (Yahoo Finance)",
      subtitle: `Simple O'Neil-style sanity check for ${sym}: valuation + growth.`,
      sections: [
        {
          heading: "Valuation",
          body: pe === null ? "P/E not reported — likely no earnings or pre-revenue." :
            pe < 15 ? `P/E of ${pe.toFixed(1)} is low — value range.` :
            pe < 25 ? `P/E of ${pe.toFixed(1)} is reasonable.` :
            pe < 40 ? `P/E of ${pe.toFixed(1)} is elevated — needs growth to justify.` :
            `P/E of ${pe.toFixed(1)} is high — only justifiable with strong growth.`,
          rows: [
            { label: "Trailing P/E", value: fd.pe !== null ? fd.pe.toFixed(1) : "—" },
            { label: "Forward P/E", value: fd.forwardPe !== null ? fd.forwardPe.toFixed(1) : "—" },
            { label: "PEG", value: fd.pegRatio !== null ? fd.pegRatio.toFixed(2) : "—" },
          ],
        },
        {
          heading: "Growth",
          body: "O'Neil wants quarterly EPS up ≥ 25% and accelerating. Annual revenue growth ≥ 15% is constructive.",
          rows: [
            { label: "EPS growth (YoY)", value: fd.epsGrowth !== null ? `${fd.epsGrowth >= 0 ? "+" : ""}${(fd.epsGrowth * 100).toFixed(1)}%` : "—", tone: fd.epsGrowth === null ? "na" : fd.epsGrowth >= 0.25 ? "pos" : fd.epsGrowth >= 0 ? "neu" : "neg" },
            { label: "Revenue growth (YoY)", value: fd.revenueGrowth !== null ? `${fd.revenueGrowth >= 0 ? "+" : ""}${(fd.revenueGrowth * 100).toFixed(1)}%` : "—", tone: fd.revenueGrowth === null ? "na" : fd.revenueGrowth >= 0.15 ? "pos" : fd.revenueGrowth >= 0 ? "neu" : "neg" },
            { label: "Profit margin", value: fd.profitMargin !== null ? `${(fd.profitMargin * 100).toFixed(1)}%` : "—", tone: fd.profitMargin === null ? "na" : fd.profitMargin >= 0.10 ? "pos" : fd.profitMargin >= 0 ? "neu" : "neg" },
          ],
        },
      ],
      footer: `Source: Yahoo Finance quoteSummary (${fd.source}).`,
    };
  }

  if (topic === "pullback") {
    if (!pullback) return { title: "No pullback signal", subtitle: "", sections: [{ heading: "Status", body: "Stock is not in a recognised pullback or breakdown pattern right now." }] };
    return {
      title: pullback.label,
      subtitle: `Detected for ${sym}.`,
      sections: [
        { heading: "Why this fired", body: pullback.note },
        {
          heading: "Detection rules",
          body:
            "• Healthy pullback → RS ≥ 65, 1M return positive, 1W between −1% and −10%, on quiet volume (Rel Vol < 1.2×).\n" +
            "• Unhealthy breakdown → 1W < −10%, OR 1W < −3% with RS acceleration ≤ −10 pts, AND RS < 70.",
        },
      ],
    };
  }

  if (topic === "rotation") {
    if (!rotationRisk) return { title: "No rotation risk", subtitle: "", sections: [{ heading: "Status", body: "The stock's sector is not currently fading relative to its 1M trend." }] };
    return {
      title: "Rotation Risk — strong stock, weakening sector",
      subtitle: `${sym} is a leader, but ${rotationRisk.sector} (${rotationRisk.etf ?? "sector ETF"}) is rolling over.`,
      sections: [
        {
          heading: "Sector trend",
          body: "",
          rows: [
            { label: "Sector 1M return", value: pct(rotationRisk.sectorR1m, 2), tone: rotationRisk.sectorR1m >= 0 ? "pos" : "neg" },
            { label: "Sector 1W return", value: pct(rotationRisk.sectorR1w, 2), tone: rotationRisk.sectorR1w >= 0 ? "pos" : "neg" },
          ],
        },
        {
          heading: "Why it matters",
          body:
            "Leaders inside fading groups often get sold next as money rotates out of the theme. The stock can still work, but the tailwind is gone — tighten stops or wait for the sector to stabilise before adding.",
        },
        {
          heading: "Trigger rule",
          body: "RS Rating ≥ 75 AND sector 1W < −1% AND sector 1W < sector 1M (i.e. accelerating to the downside).",
        },
      ],
    };
  }

  return { title: "Details", subtitle: "", sections: [] };
}

function WhyDialog({
  open,
  onOpenChange,
  content,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  content: WhyContent | null;
}) {
  if (!content) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-['Syne',sans-serif] text-lg">{content.title}</DialogTitle>
          {content.subtitle && (
            <DialogDescription className="text-xs leading-relaxed">{content.subtitle}</DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {content.sections.map((s, i) => (
            <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                {s.heading}
              </div>
              {s.body && (
                <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-line">{s.body}</p>
              )}
              {s.rows && s.rows.length > 0 && (
                <div className="mt-2 space-y-1">
                  {s.rows.map((r, j) => (
                    <div key={j} className="flex items-baseline justify-between gap-3 text-xs border-b border-border/20 pb-1 last:border-0">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={`font-mono font-semibold text-right ${toneClass(r.tone)}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {content.footer && (
            <p className="text-[11px] italic text-muted-foreground border-t border-border/30 pt-2">{content.footer}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhyButton({ onClick, label = "Why?" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
    >
      <HelpCircle size={10} />
      {label}
    </button>
  );
}

// ───────────────────────── component ─────────────────────────

export default function LiveExecution() {
  const { stocks, isLoading: rsLoading } = useRsAlpha();
  const { snapshot, isLoading: snapLoading, error: snapError, fetchSnapshot, clear } = useLiveSnapshot();
  const { tickers: watchTickers, add: addWatch, remove: removeWatch, has: hasWatch } = useLiveWatchlist();

  const [input, setInput] = useState("");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkSymbol>("SPY");
  const [whyTopic, setWhyTopic] = useState<WhyTopic | null>(null);
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

  const submit = (raw: string, opts: { force?: boolean } = {}) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    setActiveSymbol(sym);
    const sector = stockMap.get(sym)?.sector ?? null;
    fetchSnapshot(sym, benchmark, sector, opts.force === true);
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

  // Auto-refresh the live snapshot every 10 s while a ticker is active.
  // Pauses while the tab is hidden so we don't burn API calls in the background.
  useEffect(() => {
    if (!activeSymbol) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const sector = stockMap.get(activeSymbol)?.sector ?? null;
      fetchSnapshot(activeSymbol, benchmark, sector);
    }, 7_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol, benchmark]);

  const activeStock = activeSymbol ? stockMap.get(activeSymbol) ?? null : null;
  const resolvedTheme = useMemo(() => {
    const rawLabel = activeStock?.sector ?? snapshot?.fundamentals?.industry ?? snapshot?.fundamentals?.sector ?? null;
    const broadLabel = gicsForIndustry(rawLabel) ?? snapshot?.industry?.sectorName ?? rawLabel;
    return {
      rawLabel,
      broadLabel,
      etfSymbol: snapshot?.industry?.etfSymbol ?? null,
    };
  }, [activeStock, snapshot]);

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

  const themeUniverseMembers = useMemo(() => {
    const rawMatch = resolvedTheme.rawLabel?.toLowerCase().trim() ?? null;
    const broadMatch = resolvedTheme.broadLabel?.toLowerCase().trim() ?? null;
    return stocks
      .filter((s) => {
        if (!s.sector || s.rsOverall === null) return false;
        const sector = s.sector.toLowerCase().trim();
        const broad = (gicsForIndustry(s.sector) ?? s.sector).toLowerCase().trim();
        return (rawMatch !== null && sector === rawMatch) || (broadMatch !== null && broad === broadMatch);
      })
      .sort((a, b) => (b.rsOverall ?? -Infinity) - (a.rsOverall ?? -Infinity));
  }, [stocks, resolvedTheme]);

  const themeStats = useMemo(() => {
    const ratings = themeUniverseMembers
      .map((stock) => ratingOverall.get(stock.symbol.toUpperCase()) ?? null)
      .filter((v): v is number => v !== null);
    const avgRating = ratings.length > 0 ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
    const leaderPct = ratings.length > 0 ? (ratings.filter((value) => value >= 80).length / ratings.length) * 100 : null;
    return {
      matchedCount: themeUniverseMembers.length,
      avgRating: avgRating === null ? null : Math.round(avgRating),
      leaderPct: leaderPct === null ? null : Math.round(leaderPct),
    };
  }, [themeUniverseMembers, ratingOverall]);

  const themeLeaders = useMemo(() => {
    const top = themeUniverseMembers.slice(0, 10);
    if (!activeStock || activeStock.rsOverall === null) return top;
    return top.some((stock) => stock.symbol === activeStock.symbol)
      ? top
      : [activeStock, ...top].slice(0, 10);
  }, [themeUniverseMembers, activeStock]);

  // ── New 4-Pillar Overall Conviction Score (0-100) ──
  // Weights: 40% RS · 30% Theme · 20% Fundamentals · 10% Options
  // If a pillar has no data its weight is redistributed proportionally to the others.
  const conviction = useMemo(() => {
    // 1) RS pillar (40%) — based on RS Rating, with a small acceleration boost.
    let rsScore: number | null = null;
    if (overallRating !== null) {
      let s = overallRating;
      if (accelDelta !== null) s += Math.max(-15, Math.min(15, accelDelta * 0.5));
      rsScore = clampScore(s);
    }

    // 2) Theme pillar (30%) — sector ETF strength plus the RS of the theme members.
    const ih = snapshot?.industry;
    let themeScore: number | null = null;
    const etfParts = ih?.available
      ? [
          scoreReturnTo100(ih.changePct, 10),
          scoreReturnTo100(ih.return1w, 5),
          scoreReturnTo100(ih.return1m, 3),
        ].filter((v): v is number => v !== null)
      : [];
    const etfScore = etfParts.length > 0 ? etfParts.reduce((a, b) => a + b, 0) / etfParts.length : null;
    const peerScore =
      themeStats.avgRating !== null || themeStats.leaderPct !== null
        ? clampScore((themeStats.avgRating ?? 50) * 0.7 + (themeStats.leaderPct ?? 50) * 0.3)
        : null;
    const themeParts = [etfScore, peerScore].filter((v): v is number => v !== null);
    if (themeParts.length > 0) {
      themeScore = themeParts.reduce((a, b) => a + b, 0) / themeParts.length;
    }

    // 3) Fundamentals pillar (20%) — growth-focused, growth-adjusted valuation.
    const fd = snapshot?.fundamentals;
    const sectorPeAvg = (snapshot as any)?.sectorPeAvg as number | null | undefined;
    let fundScore: number | null = null;
    let fundDetail: { peScore: number | null; epsScore: number | null; revScore: number | null; peJustified: boolean } = {
      peScore: null, epsScore: null, revScore: null, peJustified: false,
    };
    if (fd?.available) {
      const eg = fd.epsGrowth;
      const rg = fd.revenueGrowth;
      const strongGrowth = (eg !== null && eg >= 0.25) || (rg !== null && rg >= 0.20);

      // EPS growth score
      let epsScore: number | null = null;
      if (eg !== null) {
        if (eg >= 0.5) epsScore = 95;
        else if (eg >= 0.25) epsScore = 80;
        else if (eg >= 0.10) epsScore = 65;
        else if (eg >= 0) epsScore = 55;
        else if (eg >= -0.15) epsScore = 40;
        else epsScore = 25;
      }
      // Revenue growth score
      let revScore: number | null = null;
      if (rg !== null) {
        if (rg >= 0.30) revScore = 90;
        else if (rg >= 0.15) revScore = 75;
        else if (rg >= 0.05) revScore = 60;
        else if (rg >= 0) revScore = 50;
        else revScore = 30;
      }
      // Valuation score — compared to sector average if available, growth-adjusted.
      let peScore: number | null = null;
      const pe = fd.forwardPe ?? fd.pe;
      if (pe !== null && pe > 0) {
        const benchPe = sectorPeAvg ?? 22;
        const ratio = pe / benchPe;
        if (ratio < 0.7) peScore = 80;        // cheap vs sector
        else if (ratio < 1.0) peScore = 70;   // fair / slight discount
        else if (ratio < 1.3) peScore = 60;   // slight premium
        else if (ratio < 1.7) peScore = 50;   // notable premium
        else if (ratio < 2.5) peScore = 40;   // large premium
        else peScore = 30;                    // extreme premium
        if (strongGrowth) {
          peScore = Math.max(peScore, 60);    // don't penalise high P/E if growth is strong
          fundDetail.peJustified = true;
        }
      }
      fundDetail = { peScore, epsScore, revScore, peJustified: fundDetail.peJustified };
      const parts = [peScore, epsScore, revScore].filter((v): v is number => v !== null);
      if (parts.length > 0) fundScore = parts.reduce((a, b) => a + b, 0) / parts.length;
    }

    // 4) Options pillar (10%) — sentiment + IV reasonableness.
    const opt = snapshot?.options;
    let optScore: number | null = null;
    if (opt?.available) {
      let s = 50;
      if (opt.sentiment === "Bullish") s = 70;
      else if (opt.sentiment === "Bearish") s = 35;
      // Mild penalty for very high IV (expensive premiums = crowded / risky entry).
      if (opt.avg_iv !== null) {
        if (opt.avg_iv > 0.8) s -= 10;
        else if (opt.avg_iv > 0.6) s -= 5;
      }
      // Small bonus when bullish unusual activity is present.
      if (opt.unusual_activity.length > 0 && opt.sentiment === "Bullish") s += 5;
      optScore = clampScore(s);
    }

    // Weighted blend with redistribution.
    const pillars = [
      { key: "rs", w: 0.40, v: rsScore },
      { key: "theme", w: 0.30, v: themeScore },
      { key: "fund", w: 0.20, v: fundScore },
      { key: "opt", w: 0.10, v: optScore },
    ];
    const present = pillars.filter((p) => p.v !== null);
    if (present.length === 0) return null;
    const wSum = present.reduce((a, p) => a + p.w, 0);
    const total = present.reduce((a, p) => a + (p.v as number) * (p.w / wSum), 0);
    const effectiveWeights = {
      rs: rsScore === null ? null : Math.round((0.4 / wSum) * 100),
      theme: themeScore === null ? null : Math.round((0.3 / wSum) * 100),
      fund: fundScore === null ? null : Math.round((0.2 / wSum) * 100),
      opt: optScore === null ? null : Math.round((0.1 / wSum) * 100),
    };
    const contributions = {
      rs: rsScore === null ? null : Math.round(rsScore * (0.4 / wSum) * 10) / 10,
      theme: themeScore === null ? null : Math.round(themeScore * (0.3 / wSum) * 10) / 10,
      fund: fundScore === null ? null : Math.round(fundScore * (0.2 / wSum) * 10) / 10,
      opt: optScore === null ? null : Math.round(optScore * (0.1 / wSum) * 10) / 10,
    };

    return {
      total: Math.round(total),
      rs: rsScore === null ? null : Math.round(rsScore),
      theme: themeScore === null ? null : Math.round(themeScore),
      fund: fundScore === null ? null : Math.round(fundScore),
      opt: optScore === null ? null : Math.round(optScore),
      hasIndustry: ih?.available ?? false,
      hasFund: fd?.available ?? false,
      hasOptions: opt?.available ?? false,
      themeDetail: {
        label: resolvedTheme.broadLabel,
        matchedCount: themeStats.matchedCount,
        avgRating: themeStats.avgRating,
        leaderPct: themeStats.leaderPct,
        etfBacked: ih?.available ?? false,
      },
      fundDetail,
      effectiveWeights,
      contributions,
    };
  }, [snapshot, overallRating, accelDelta, themeStats, resolvedTheme]);

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

  // ── AI-suggested theme peers (fallback when the qualified universe doesn't have enough) ──
  type AiPeer = { symbol: string; shortName: string | null; price: number | null; changePct: number | null; return1m: number | null };
  const [aiTheme, setAiTheme] = useState<{ theme: string | null; peers: AiPeer[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setAiTheme(null);
    aiKeyRef.current = null;
    if (!activeSymbol || !snapshot) return;
    // Only use AI fallback when we have fewer than 3 qualified peers.
    if (themeUniverseMembers.length >= 3) return;

    const key = activeSymbol;
    aiKeyRef.current = key;
    const hint = activeStock?.sector
      ?? snapshot.fundamentals?.industry
      ?? snapshot.fundamentals?.sector
      ?? null;
    setAiLoading(true);
    supabase.functions
      .invoke("live-theme-suggest", { body: { symbol: activeSymbol, hint } })
      .then(({ data, error }) => {
        if (aiKeyRef.current !== key) return;
        if (error || !data) { setAiTheme(null); return; }
        setAiTheme({ theme: (data as any).theme ?? null, peers: ((data as any).quotes ?? []) as AiPeer[] });
      })
      .finally(() => { if (aiKeyRef.current === key) setAiLoading(false); });
  }, [activeSymbol, snapshot, themeUniverseMembers.length, activeStock?.sector]);


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
                <h1 className="font-['Syne',sans-serif] text-3xl font-bold tracking-tight text-foreground">
                  Live Execution
                </h1>
                <p className="text-sm text-muted-foreground">
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
            <div className="mb-4 flex items-center gap-2">
              <Zap size={20} className="text-primary" />
              <h2 className="font-['Syne',sans-serif] text-2xl font-bold uppercase tracking-wider text-foreground">
                Quick Trade Check
              </h2>
              {rsLoading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-sm uppercase tracking-wider text-muted-foreground">Benchmark</span>
                <div className="inline-flex rounded-md border border-border/60 bg-background/40 p-0.5">
                  {(["SPY", "QQQ"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBenchmark(b)}
                      className={`rounded-sm px-3 py-1 font-mono text-base font-bold transition-colors ${
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
                    <span className="inline-flex cursor-help"><Info size={14} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    Switch the benchmark used for relative strength (RS) comparisons. SPY tracks the S&amp;P 500 (broad market); QQQ tracks the Nasdaq-100 (tech-heavy). RS values below recompute live.
                  </TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => activeSymbol && submit(activeSymbol, { force: true })}
                  disabled={!activeSymbol || snapLoading}
                  className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Force a fresh data pull from Yahoo (bypasses 24h cache)"
                >
                  <RefreshCw size={14} className={snapLoading ? "animate-spin" : ""} />
                  Refresh Data
                </button>
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
                className="h-16 w-full rounded-lg border border-border bg-background/60 pl-12 pr-28 font-mono text-2xl font-bold text-foreground placeholder:text-muted-foreground placeholder:text-base placeholder:font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
                    <span className="font-mono text-4xl font-extrabold text-foreground">{snapshot.symbol}</span>
                    <span className="text-lg text-muted-foreground">{snapshot.quote.shortName ?? "—"}</span>
                    {activeStock?.sector && (
                      <span className="rounded border border-border/60 px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground">
                        {activeStock.sector}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-4xl font-extrabold text-foreground">
                      ${num(snapshot.quote.price)}
                    </div>
                    <div className={`font-mono text-lg font-bold ${pctClass(snapshot.quote.changePct)}`}>
                      {pct(snapshot.quote.changePct)}
                    </div>
                  </div>
                </div>

                {/* Verdict badge */}
                <div
                  className={`flex items-start gap-3 rounded-lg border ${verdict.border} ${verdict.bg} p-4`}
                >
                  <VerdictIcon size={28} className={`shrink-0 ${verdict.color}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`font-['Syne',sans-serif] text-xl font-bold ${verdict.color}`}>
                        {verdict.label}
                      </div>
                      <WhyButton onClick={() => setWhyTopic("verdict")} label="Why this verdict?" />
                    </div>
                    <p className="mt-1.5 text-base leading-relaxed text-foreground/85">{verdict.reason}</p>
                    {/* Factor breakdown chips */}
                    <div className="mt-3 flex flex-wrap gap-2">
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
                            className={`rounded border px-2 py-1 text-sm ${cls}`}
                          >
                            <span className="font-bold">{f.label}:</span> {f.note}
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
                    className="shrink-0 rounded-md border border-border bg-background/60 p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={hasWatch(snapshot.symbol) ? "Remove from live watchlist" : "Pin to live watchlist"}
                  >
                    {hasWatch(snapshot.symbol) ? (
                      <Star size={18} className="fill-[hsl(40,85%,55%)] text-[hsl(40,85%,55%)]" />
                    ) : (
                      <StarOff size={18} />
                    )}
                  </button>
                </div>

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
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`font-semibold ${pullback.kind === "healthy" ? "text-[hsl(160,80%,45%)]" : "text-destructive"}`}>
                          {pullback.label}
                        </div>
                        <WhyButton onClick={() => setWhyTopic("pullback")} />
                      </div>
                      <div className="mt-0.5 text-foreground/80">{pullback.note}</div>
                    </div>
                  </div>
                )}

                {/* Rotation Risk warning */}
                {rotationRisk && (
                  <div className="flex items-start gap-2 rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/10 p-3 text-xs">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[hsl(40,85%,55%)]" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-[hsl(40,85%,55%)]">
                          Rotation Risk — strong stock, weakening sector
                        </div>
                        <WhyButton onClick={() => setWhyTopic("rotation")} />
                      </div>
                      <div className="mt-0.5 text-foreground/80">
                        {rotationRisk.sector} ({rotationRisk.etf}) is fading: 1W {pct(rotationRisk.sectorR1w)} vs 1M {pct(rotationRisk.sectorR1m)}.
                        Leaders inside fading sectors often roll over next. Tighten stops or wait for sector to stabilise.
                      </div>
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

          {/*
            ── New 4-section sketch layout ──
            Row A: [1] Theme Tickers (tall left col)  |  [2] Fundamentals (top right) + Conviction summary
            Row B: [3] Options Activity (full width)
            Row C: [4] RS Rating Across Timeframes (full width, raw % + RS score)
          */}
          {snapshot && (
            <section className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              {/* ── [1] Theme Tickers ── tall left column */}
              <div
                className="rounded-xl border border-border/60 p-5 lg:row-span-2"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  <h2 className="font-['Syne',sans-serif] text-2xl font-bold uppercase tracking-wider text-foreground">
                    Theme Tickers
                  </h2>
                  <span className="text-base font-bold text-primary">
                    {(themeUniverseMembers.length > 0 ? resolvedTheme.broadLabel : aiTheme?.theme) ?? resolvedTheme.broadLabel ?? "—"}
                  </span>
                  {snapLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                  <span className="ml-auto text-sm text-muted-foreground">
                    {themeUniverseMembers.length > 0
                      ? `${themeUniverseMembers.length} qualified peers`
                      : aiTheme && aiTheme.peers.length > 0
                      ? `${aiTheme.peers.length} AI-suggested peers`
                      : aiLoading
                      ? "Finding peers…"
                      : ""}
                  </span>
                </div>
                <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                  All tickers in the same theme as <span className="font-mono font-bold text-foreground">{snapshot.symbol}</span>.
                  Auto-refreshes every 7 s. When the qualified universe has fewer than 3 peers we fall back to an AI-suggested peer set with live Yahoo quotes.
                </p>

                {themeUniverseMembers.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-base">
                      <thead>
                        <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="py-2.5 text-left">Ticker</th>
                          <th className="py-2.5 text-right">RS Rating</th>
                          <th className="py-2.5 text-right">1D</th>
                          <th className="py-2.5 text-right">1M</th>
                        </tr>
                      </thead>
                      <tbody>
                        {themeUniverseMembers.slice(0, 15).map((stock) => {
                          const rating = ratingOverall.get(stock.symbol.toUpperCase()) ?? null;
                          const isActive = stock.symbol === activeSymbol;
                          const r1d = isActive ? snapshot.quote.changePct : (stock as any).return1d ?? null;
                          return (
                            <tr key={stock.symbol} className="border-b border-border/20 hover:bg-muted/20">
                              <td className="py-3">
                                <button
                                  onClick={() => { setInput(stock.symbol); submit(stock.symbol); }}
                                  className={`font-mono text-base font-bold ${isActive ? "text-foreground" : "text-primary hover:underline"}`}
                                >
                                  {stock.symbol}
                                </button>
                                {stock.companyName && (
                                  <div className="truncate text-xs text-muted-foreground max-w-[200px]">{stock.companyName}</div>
                                )}
                              </td>
                              <td className={`py-3 text-right font-mono text-base font-bold ${ratingClass(rating)}`}>{rating ?? "—"}</td>
                              <td className={`py-3 text-right font-mono text-base ${pctClass(r1d)}`}>{pct(r1d)}</td>
                              <td className={`py-3 text-right font-mono text-base ${pctClass(stock.return1m)}`}>{pct(stock.return1m)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {themeUniverseMembers.length > 15 && (
                      <div className="mt-2 text-center text-sm text-muted-foreground">
                        Showing top 15 of {themeUniverseMembers.length} by RS Rating
                      </div>
                    )}
                  </div>
                ) : aiLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/10 p-4 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" /> AI is identifying the theme and peers…
                  </div>
                ) : aiTheme && aiTheme.peers.length > 0 ? (
                  <div className="space-y-2">
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground/85">
                      🤖 No qualified peers in the RS universe — these peers were suggested by AI for the theme
                      <span className="ml-1 font-bold">{aiTheme.theme ?? "—"}</span>, with live Yahoo quotes.
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-base">
                        <thead>
                          <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="py-2.5 text-left">Ticker</th>
                            <th className="py-2.5 text-right">Price</th>
                            <th className="py-2.5 text-right">1D</th>
                            <th className="py-2.5 text-right">1M</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiTheme.peers.map((p) => (
                            <tr key={p.symbol} className="border-b border-border/20 hover:bg-muted/20">
                              <td className="py-3">
                                <button
                                  onClick={() => { setInput(p.symbol); submit(p.symbol); }}
                                  className="font-mono text-base font-bold text-primary hover:underline"
                                >
                                  {p.symbol}
                                </button>
                                {p.shortName && (
                                  <div className="truncate text-xs text-muted-foreground max-w-[200px]">{p.shortName}</div>
                                )}
                              </td>
                              <td className="py-3 text-right font-mono text-base text-foreground">
                                {p.price !== null ? `$${p.price.toFixed(2)}` : "—"}
                              </td>
                              <td className={`py-3 text-right font-mono text-base ${pctClass(p.changePct)}`}>{pct(p.changePct)}</td>
                              <td className={`py-3 text-right font-mono text-base ${pctClass(p.return1m)}`}>{pct(p.return1m)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border/30 bg-muted/10 p-4 text-sm text-muted-foreground">
                    Insufficient data — could not match this ticker to a theme peer set.
                  </div>
                )}
              </div>

              {/* ── [2] Fundamentals ── top right */}
              <div
                className="rounded-xl border border-border/60 p-5"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="mb-4 flex items-center gap-2 flex-wrap">
                  <h2 className="font-['Syne',sans-serif] text-2xl font-bold uppercase tracking-wider text-foreground">
                    Fundamentals
                  </h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help"><Info size={14} className="text-muted-foreground" /></span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-sm">
                      Growth-focused: EPS growth (YoY), revenue growth (YoY) and Forward P/E vs the sector average. High P/E is acceptable when growth is strong and is not heavily penalised.
                    </TooltipContent>
                  </Tooltip>
                  <span className="ml-auto text-sm text-muted-foreground">Source: Yahoo Finance</span>
                </div>
                {snapshot.fundamentals?.available ? (
                  <FundamentalsBlock
                    fd={snapshot.fundamentals}
                    sectorPeAvg={(snapshot as any)?.sectorPeAvg ?? null}
                    sectorEtf={snapshot.industry?.etfSymbol ?? null}
                    peJustified={conviction?.fundDetail.peJustified ?? false}
                    onWhy={() => setWhyTopic("fundamentals")}
                  />
                ) : (
                  <div className="rounded-md border border-border/30 bg-muted/10 p-4 text-sm text-muted-foreground">
                    Insufficient data — Yahoo did not return clean fundamentals for this ticker.
                  </div>
                )}
              </div>

              {/* Conviction summary slot — sits below Fundamentals on the right column */}
              {conviction && (
                <div
                  className="rounded-xl border border-primary/30 p-5"
                  style={{ background: "rgba(60, 200, 255, 0.04)" }}
                >
                  <ConvictionBreakdown
                    total={conviction.total}
                    rs={conviction.rs}
                    theme={conviction.theme}
                    fund={conviction.fund}
                    opt={conviction.opt}
                    benchmarkLabel={benchmark}
                    sectorName={resolvedTheme.broadLabel ?? snapshot?.industry?.sectorName ?? null}
                    sectorEtf={snapshot?.industry?.etfSymbol ?? null}
                    fundamentals={snapshot?.fundamentals ?? null}
                    sectorPeAvg={(snapshot as any)?.sectorPeAvg ?? null}
                    peJustified={conviction.fundDetail.peJustified}
                    hasIndustry={conviction.hasIndustry}
                    hasFund={conviction.hasFund}
                    hasOptions={conviction.hasOptions}
                    onWhy={() => setWhyTopic("conviction")}
                  />
                </div>
              )}
            </section>
          )}

          {/* ── [3] Options Activity ── full width */}
          {snapshot && (
            <section
              className="rounded-xl border border-border/60 p-6"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="mb-5 flex items-center gap-3 flex-wrap">
                <h2 className="font-['Syne',sans-serif] text-2xl font-bold uppercase tracking-wider text-foreground">
                  Options Activity
                </h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={16} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    Plain-English read of today's options flow on the nearest expiration: directional sentiment, put/call balance, implied volatility and any unusual prints.
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto text-sm text-muted-foreground">
                  Source: Yahoo Finance · Nearest expiration
                </span>
              </div>

              {!snapshot.options.available ? (
                <div className="rounded-md border border-border/30 bg-muted/10 p-4 text-base text-muted-foreground">
                  Insufficient data — no live options chain available for this ticker.
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    className={`rounded-lg border p-4 ${
                      snapshot.options.sentiment === "Bullish"
                        ? "border-[hsl(160,80%,45%)]/30 bg-[hsl(160,80%,45%)]/10"
                        : snapshot.options.sentiment === "Bearish"
                        ? "border-destructive/30 bg-destructive/10"
                        : "border-border/40 bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                        Overall Sentiment
                      </span>
                      <span
                        className={`font-['Syne',sans-serif] text-2xl font-bold ${
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
                    <p className="mt-2 text-base text-foreground/85">{snapshot.options.sentiment_explanation}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

                  {snapshot.options.unusual_activity.length > 0 ? (
                    <div className="rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/10 p-4">
                      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-[hsl(40,85%,55%)]">
                        <AlertTriangle size={14} /> Unusual Options Activity
                      </div>
                      <ul className="space-y-1 text-base text-foreground/90">
                        {snapshot.options.unusual_activity.map((u, i) => (
                          <li key={i}>• {u}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Unusual = today's contract volume more than 3× the existing open interest at that strike.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border/40 bg-muted/10 p-4 text-base text-muted-foreground">
                      No significant unusual options activity detected today.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── [4] RS vs Benchmark Across Timeframes ── full width, at the very bottom */}
          {snapshot && (
            <section
              className="rounded-xl border border-border/60 p-6"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="mb-5 flex items-center gap-3 flex-wrap">
                <h2 className="font-['Syne',sans-serif] text-2xl font-bold uppercase tracking-wider text-foreground">
                  RS vs {benchmark} Across Timeframes
                </h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help"><Info size={16} className="text-muted-foreground" /></span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    Each card shows the stock's % return for the window, the {benchmark} return for the same window, the resulting RS (% outperformance), and where available the universe-based RS Rating (1–99).
                  </TooltipContent>
                </Tooltip>
                <span className="ml-auto text-sm text-muted-foreground">
                  Benchmark: <span className="font-mono font-semibold text-foreground">{benchmark}</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {([
                  { tf: "1D", stock: snapshot.quote.changePct, bench: snapshot.benchmark.changePct, rs: liveRs.rs1d, rating: null as number | null },
                  { tf: "1W", stock: snapshot.tickerHistory?.return1w ?? null, bench: snapshot.benchmark.return1w, rs: liveRs.rs1w, rating: activeSymbol ? rating1w.get(activeSymbol) ?? null : null },
                  { tf: "1M", stock: snapshot.tickerHistory?.return1m ?? null, bench: snapshot.benchmark.return1m, rs: liveRs.rs1m, rating: activeSymbol ? rating1m.get(activeSymbol) ?? null : null },
                  { tf: "3M", stock: snapshot.tickerHistory?.return3m ?? null, bench: snapshot.benchmark.return3m, rs: liveRs.rs3m, rating: null as number | null },
                ]).map((row) => (
                  <div key={row.tf} className="rounded-lg border border-border/40 bg-background/40 p-4">
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="font-['Syne',sans-serif] text-lg font-bold uppercase tracking-wider text-muted-foreground">
                        RS {row.tf}
                      </span>
                      {row.rating !== null && (
                        <span className={`font-mono text-base font-bold ${ratingClass(row.rating)}`}>
                          {row.rating}<span className="text-xs text-muted-foreground">/99</span>
                        </span>
                      )}
                    </div>
                    <div className={`font-mono text-3xl font-extrabold ${pctClass(row.rs)}`}>
                      {pct(row.rs)}
                    </div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stock</span>
                        <span className={`font-mono font-semibold ${pctClass(row.stock)}`}>{pct(row.stock)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{benchmark}</span>
                        <span className={`font-mono font-semibold ${pctClass(row.bench)}`}>{pct(row.bench)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
      <WhyDialog
        open={whyTopic !== null}
        onOpenChange={(o) => { if (!o) setWhyTopic(null); }}
        content={
          whyTopic === null
            ? null
            : buildWhyContent({
                topic: whyTopic,
                symbol: activeSymbol,
                benchmark,
                verdict,
                conviction,
                setupQuality,
                overallRating,
                accelDelta,
                relVol,
                pullback,
                rotationRisk,
                snapshot,
                activeStock,
              })
        }
      />
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
  onWhy,
}: {
  label: string;
  value: string;
  sub?: string;
  tooltip?: string;
  valueClass?: string;
  onWhy?: () => void;
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
        {onWhy && (
          <button
            type="button"
            onClick={onWhy}
            className="ml-auto inline-flex items-center gap-0.5 rounded border border-border/40 bg-background/60 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            title="Detailed explanation"
          >
            <HelpCircle size={9} />
            Why
          </button>
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
      className={`rounded-lg border p-4 ${
        highlight ? "border-[hsl(40,85%,55%)]/40 bg-[hsl(40,85%,55%)]/5" : "border-border/40 bg-background/40"
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help"><Info size={12} /></span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-sm">{tooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={`font-mono text-3xl font-extrabold ${highlight ? "text-[hsl(40,85%,55%)]" : "text-foreground"}`}>
        {value}
      </div>
      <div className="mt-2 text-sm leading-snug text-foreground/80">{explain}</div>
    </div>
  );
}

function ConvictionBreakdown({
  total,
  rs,
  theme,
  fund,
  opt,
  benchmarkLabel,
  sectorName,
  sectorEtf,
  fundamentals,
  sectorPeAvg,
  peJustified,
  hasIndustry,
  hasFund,
  hasOptions,
  onWhy,
}: {
  total: number;
  rs: number | null;
  theme: number | null;
  fund: number | null;
  opt: number | null;
  benchmarkLabel: string;
  sectorName: string | null;
  sectorEtf: string | null;
  fundamentals: import("@/hooks/useLiveSnapshot").LiveFundamentals | null;
  sectorPeAvg: number | null;
  peJustified: boolean;
  hasIndustry: boolean;
  hasFund: boolean;
  hasOptions: boolean;
  onWhy?: () => void;
}) {
  // Pillars and weights for the new 4-section blend.
  const pillars = [
    { key: "RS", weight: 0.40, value: rs, sub: "RS Rating + acceleration" },
    { key: "Theme", weight: 0.30, value: theme, sub: hasIndustry ? `${sectorName ?? "Sector"}${sectorEtf ? ` · ${sectorEtf}` : ""}` : "No sector mapped" },
    { key: "Fundamentals", weight: 0.20, value: fund, sub: hasFund && fundamentals
        ? `P/E ${(fundamentals.forwardPe ?? fundamentals.pe)?.toFixed(1) ?? "—"}${sectorPeAvg ? ` (sec ~${sectorPeAvg})` : ""}${peJustified ? " · growth-justified" : ""}`
        : "Not available" },
    { key: "Options", weight: 0.10, value: opt, sub: hasOptions ? "Sentiment + IV" : "Not available" },
  ];
  const tone = (s: number | null) =>
    s === null ? "bg-muted/40" :
    s >= 70 ? "bg-[hsl(160,80%,45%)]" : s >= 50 ? "bg-[hsl(40,85%,55%)]" : "bg-destructive";

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className="font-['Syne',sans-serif] text-lg font-bold uppercase tracking-wider text-foreground">
          Overall Conviction Score
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help"><Info size={14} className="text-muted-foreground" /></span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-sm">
            Weighted blend of the four sections below: 40% RS Rating, 30% Theme/Sector strength, 20% Fundamentals, 10% Options activity. Missing pillars are dropped and the weight is redistributed proportionally.
          </TooltipContent>
        </Tooltip>
        {onWhy && (
          <button
            type="button"
            onClick={onWhy}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-sm font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <HelpCircle size={12} /> Why this score?
          </button>
        )}
        <span className="ml-auto font-mono text-5xl font-extrabold text-foreground">
          {total} <span className="text-base text-muted-foreground">/ 100</span>
        </span>
      </div>
      {/* Segmented bar */}
      <div className="flex h-4 w-full overflow-hidden rounded-md border border-border/40 bg-background/60">
        {pillars.map((p) => (
          <div
            key={p.key}
            className="relative border-l border-background/60 first:border-l-0"
            style={{ width: `${p.weight * 100}%` }}
            title={`${p.key} (${(p.weight * 100).toFixed(0)}%) — score ${p.value ?? "n/a"}`}
          >
            <div className={`h-full ${tone(p.value)}`} style={{ width: `${p.value ?? 0}%`, opacity: p.value === null ? 0.2 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        {pillars.map((p) => (
          <div key={p.key} className="rounded border border-border/40 bg-background/40 p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-muted-foreground">{p.key} <span className="text-xs">({(p.weight * 100).toFixed(0)}%)</span></span>
              <span className={`font-mono text-lg font-bold ${ratingClass(p.value)}`}>{p.value ?? "—"}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground" title={p.sub}>{p.sub}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-snug text-foreground/80">
        Final = {pillars.filter((p) => p.value !== null).map((p) => `${p.value} × ${(p.weight * 100).toFixed(0)}%`).join(" + ")}
        {pillars.some((p) => p.value === null) && " (missing pillars dropped, weight redistributed)"} = <span className="font-bold text-foreground">{total}</span>.
      </p>
    </div>
  );
}

function FundamentalsBlock({
  fd,
  sectorPeAvg,
  sectorEtf,
  peJustified,
  onWhy,
}: {
  fd: import("@/hooks/useLiveSnapshot").LiveFundamentals;
  sectorPeAvg: number | null;
  sectorEtf: string | null;
  peJustified: boolean;
  onWhy: () => void;
}) {
  const pe = fd.forwardPe ?? fd.pe;
  const peLabel = fd.forwardPe !== null ? "Forward P/E" : "Trailing P/E";
  const peVsSector = pe !== null && sectorPeAvg ? pe / sectorPeAvg : null;
  const peTone = peVsSector === null
    ? "text-muted-foreground"
    : peVsSector < 1.0 ? "text-[hsl(160,80%,45%)]"
    : peVsSector < 1.5 ? "text-foreground"
    : "text-[hsl(40,85%,55%)]";

  const growthCard = (label: string, value: number | null, goodAt: number) => {
    if (value === null) return { label, value: "—", tone: "text-muted-foreground", note: "Not reported" };
    const v = value * 100;
    const tone = v >= goodAt ? "text-[hsl(160,80%,45%)]" : v >= 0 ? "text-foreground" : "text-destructive";
    const note = v >= goodAt ? "Strong" : v >= 0 ? "Positive but modest" : "Contracting";
    return { label, value: `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, tone, note };
  };
  const eps = growthCard("EPS growth (YoY)", fd.epsGrowth, 25);
  const rev = growthCard("Revenue growth (YoY)", fd.revenueGrowth, 15);

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Growth-focused read: are earnings and revenue actually growing, and is the price reasonable for that growth?
        High P/E is acceptable when growth is strong — we don't penalise it.
        <button onClick={onWhy} className="ml-1 underline decoration-dotted hover:text-foreground">Full breakdown</button>
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border/40 bg-background/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{eps.label}</div>
          <div className={`font-mono text-lg font-bold ${eps.tone}`}>{eps.value}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{eps.note} · O'Neil target ≥ 25%</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{rev.label}</div>
          <div className={`font-mono text-lg font-bold ${rev.tone}`}>{rev.value}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{rev.note} · target ≥ 15%</div>
        </div>
        <div className="rounded-lg border border-border/40 bg-background/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{peLabel} vs Sector</div>
          <div className={`font-mono text-lg font-bold ${peTone}`}>
            {pe !== null ? pe.toFixed(1) : "—"}
            {sectorPeAvg && pe !== null && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                vs {sectorEtf ?? "sector"} ~{sectorPeAvg}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {pe === null
              ? "No P/E reported"
              : peVsSector === null
              ? "No sector benchmark"
              : peVsSector < 1.0
              ? "Trading below sector average"
              : peVsSector < 1.5
              ? "Slight premium to sector"
              : "Notable premium to sector"}
            {peJustified && " · justified by growth"}
          </div>
        </div>
      </div>
      {peJustified && pe !== null && (
        <div className="rounded-md border border-[hsl(160,80%,45%)]/30 bg-[hsl(160,80%,45%)]/10 p-2 text-[11px] text-foreground/85">
          ✓ The high P/E ({pe.toFixed(1)}) is being justified by strong growth (EPS ≥ 25% or Revenue ≥ 20% YoY) — no valuation penalty applied to the Fundamentals score.
        </div>
      )}
    </div>
  );
}
