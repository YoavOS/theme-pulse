import { useState, useEffect, useMemo } from "react";
import { ThemeData } from "@/data/themeData";
import {
  FundamentalsData,
  getScoreLabel,
  getStockTypeInfo,
  getMetricDot,
} from "@/hooks/useFundamentals";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

function ScoreGauge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const label = getScoreLabel(score);
  const pct = Math.min(100, Math.max(0, score));
  const w = size === "sm" ? 40 : 60;
  const h = size === "sm" ? 6 : 8;
  const barColor = score >= 70 ? "hsl(var(--primary))" : score >= 50 ? "hsl(152, 100%, 50%)" : score >= 30 ? "#facc15" : "hsl(var(--destructive))";

  return (
    <div className="flex items-center gap-2">
      <div className="rounded-full overflow-hidden bg-secondary/60" style={{ width: w, height: h }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className={`text-xs font-bold ${label.color}`} style={{ fontFamily: DM_MONO }}>{score}</span>
    </div>
  );
}

function CategoryBar({ label, emoji, score, max = 25 }: { label: string; emoji: string; score: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = pct >= 70 ? "hsl(var(--primary))" : pct >= 50 ? "hsl(152, 100%, 50%)" : pct >= 30 ? "#facc15" : "hsl(var(--destructive))";

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 text-muted-foreground truncate">{emoji} {label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-5 text-right text-muted-foreground" style={{ fontFamily: DM_MONO }}>{score}</span>
    </div>
  );
}

function PriceTargetBar({ low, mean, high, current }: { low: number; mean: number; high: number; current: number }) {
  const min = Math.min(low, current) * 0.95;
  const max = Math.max(high, current) * 1.05;
  const range = max - min || 1;
  const currentPct = ((current - min) / range) * 100;
  const meanPct = ((mean - min) / range) * 100;
  const lowPct = ((low - min) / range) * 100;
  const highPct = ((high - min) / range) * 100;
  const upside = current > 0 ? ((mean - current) / current * 100).toFixed(0) : "0";

  return (
    <div className="mt-2">
      <div className="relative h-3 rounded-full bg-secondary/60 overflow-hidden">
        <div className="absolute h-full bg-primary/20" style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }} />
        <div className="absolute top-0 h-full w-0.5 bg-primary" style={{ left: `${meanPct}%` }} title={`Mean: $${mean}`} />
        <div className="absolute top-[-2px] h-[calc(100%+4px)] w-1.5 rounded-full bg-foreground" style={{ left: `${currentPct}%`, transform: "translateX(-50%)" }} title={`Current: $${current}`} />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        <span>${low}</span>
        <span className={Number(upside) >= 0 ? "text-gain-medium" : "text-loss-mild"}>
          Analysts: {Number(upside) >= 0 ? "+" : ""}{upside}% to ${mean}
        </span>
        <span>${high}</span>
      </div>
    </div>
  );
}

function MetricRow({ label, value, explanation, dot }: { label: string; value: string; explanation: string; dot: string }) {
  return (
    <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-start py-1.5 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <span className="text-xs font-semibold text-foreground text-right" style={{ fontFamily: DM_MONO }}>{value}</span>
      <span className="text-[10px] text-muted-foreground leading-snug">{explanation}</span>
    </div>
  );
}

function DetailedSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent/30 transition-colors">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function fmtVal(v: number | null, suffix = "%"): string {
  if (v === null || v === undefined) return "N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;
}

function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "N/A";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

export default function FundamentalsTab({
  theme,
  fundamentals,
  isLoading,
  tickerPrices,
}: {
  theme: ThemeData;
  fundamentals: Record<string, FundamentalsData> | null;
  isLoading: boolean;
  tickerPrices: Record<string, number>;
}) {
  const [viewMode, setViewMode] = useState<"simple" | "detailed">(() => {
    try { return (localStorage.getItem("fundamentalsView") as "simple" | "detailed") || "simple"; } catch { return "simple"; }
  });

  useEffect(() => {
    localStorage.setItem("fundamentalsView", viewMode);
  }, [viewMode]);

  const tickers = useMemo(() => {
    return theme.tickers.filter(t => !t.skipped).map(t => {
      const f = fundamentals?.[t.symbol] || null;
      return { symbol: t.symbol, pct: t.pct, fundamentals: f, price: tickerPrices[t.symbol] || t.price || 0 };
    });
  }, [theme, fundamentals, tickerPrices]);

  if (isLoading) {
    return (
      <div className="space-y-3 py-4 px-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  if (!fundamentals || Object.keys(fundamentals).length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground px-6">
        No fundamental data available. Click to fetch.
      </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-auto px-6 pb-4 pt-2">
      {/* View toggle */}
      <div className="flex items-center gap-1 mb-3">
        {(["simple", "detailed"] as const).map(m => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === m ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "simple" ? "Simple" : "Detailed"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tickers.map(({ symbol, fundamentals: f, price }) => {
          if (!f) {
            return (
              <div key={symbol} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="font-bold text-foreground text-sm" style={{ fontFamily: DM_MONO }}>{symbol}</span>
                <p className="text-[11px] text-muted-foreground mt-1">Fundamental data not available for this ticker on free tier</p>
              </div>
            );
          }

          const typeInfo = getStockTypeInfo(f.stock_type);
          const scoreLabel = getScoreLabel(f.fundamental_score ?? 0);

          // Compute category sub-scores from raw metrics
          const rg1y = f.revenue_growth_1y ?? 0;
          const rg3y = f.revenue_growth_3y ?? 0;
          const eg1y = f.eps_growth_1y ?? 0;
          const nm = f.net_margin ?? 0;
          const gm = f.gross_margin ?? 0;
          const _roe = f.roe ?? 0;
          const cr = f.current_ratio ?? 0;
          const dte = f.debt_to_equity;
          const fcf = f.free_cash_flow ?? 0;
          const ar = f.analyst_rating || "Hold";
          const tm = f.target_mean ?? 0;
          const upside = price > 0 && tm > 0 ? ((tm - price) / price) * 100 : 0;

          const growthScore = (rg1y > 20 ? 10 : rg1y > 10 ? 7 : rg1y > 0 ? 4 : 0) + (eg1y > 20 ? 10 : eg1y > 10 ? 7 : eg1y > 0 ? 4 : 0) + (rg3y > 15 ? 5 : rg3y > 5 ? 3 : 0);
          const profitScore = (nm > 20 ? 10 : nm > 10 ? 7 : nm > 0 ? 4 : 0) + (_roe > 20 ? 10 : _roe > 10 ? 7 : _roe > 0 ? 4 : 0) + (gm > 50 ? 5 : gm > 30 ? 3 : 0);
          const healthScore = (cr > 2 ? 10 : cr > 1 ? 7 : 0) + (dte === null ? 5 : dte < 0.5 ? 10 : dte < 1 ? 7 : dte < 2 ? 4 : 0) + (fcf > 0 ? 5 : 0);
          const analystScore = (ar === "Strong Buy" ? 20 : ar === "Buy" ? 15 : ar === "Hold" ? 10 : ar === "Sell" ? 3 : 8) + (upside > 20 ? 5 : upside > 10 ? 3 : 0);

          if (viewMode === "simple") {
            return (
              <div key={symbol} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground text-sm" style={{ fontFamily: DM_MONO }}>{symbol}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${typeInfo.color}`}>
                      {typeInfo.emoji} {typeInfo.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreGauge score={f.fundamental_score ?? 0} />
                    <span className={`text-[10px] ${scoreLabel.color}`}>{scoreLabel.text}</span>
                  </div>
                </div>

                {/* Category mini-scores */}
                <div className="space-y-1 mb-2">
                  <CategoryBar emoji="📈" label="Growth" score={growthScore} />
                  <CategoryBar emoji="💰" label="Profitability" score={profitScore} />
                  <CategoryBar emoji="🏦" label="Financial Health" score={healthScore} />
                  <CategoryBar emoji="👨‍💼" label="Analysts" score={analystScore} />
                </div>

                {/* AI Summary */}
                {f.ai_summary && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-2 italic">{f.ai_summary}</p>
                )}

                {/* Price target bar */}
                {f.target_low != null && f.target_high != null && f.target_mean != null && price > 0 && (
                  <PriceTargetBar low={f.target_low} mean={f.target_mean} high={f.target_high} current={price} />
                )}
              </div>
            );
          }

          // Detailed view
          return (
            <div key={symbol} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="font-bold text-foreground text-sm" style={{ fontFamily: DM_MONO }}>{symbol}</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${typeInfo.color}`}>
                  {typeInfo.emoji} {typeInfo.label}
                </span>
                <ScoreGauge score={f.fundamental_score ?? 0} size="sm" />
              </div>

              <DetailedSection title="📈 Growth">
                <MetricRow label="Revenue Growth (1Y)" value={fmtVal(f.revenue_growth_1y)} explanation={
                  f.revenue_growth_1y == null ? "Data not available" :
                  f.revenue_growth_1y > 20 ? "Strong revenue growth — expanding rapidly" :
                  f.revenue_growth_1y > 10 ? "Solid revenue growth" :
                  f.revenue_growth_1y > 0 ? "Modest revenue growth" : "Revenue declining — concerning"
                } dot={getMetricDot(f.revenue_growth_1y, { green: 20, yellow: 5 })} />
                <MetricRow label="Revenue Growth (3Y)" value={fmtVal(f.revenue_growth_3y)} explanation={
                  f.revenue_growth_3y == null ? "Data not available" : "Measures consistency of growth over 3 years"
                } dot={getMetricDot(f.revenue_growth_3y, { green: 15, yellow: 5 })} />
                <MetricRow label="EPS Growth (1Y)" value={fmtVal(f.eps_growth_1y)} explanation={
                  f.eps_growth_1y == null ? "Data not available" :
                  f.eps_growth_1y > 20 ? "Earnings per share growing fast — improving efficiency" :
                  f.eps_growth_1y > 0 ? "Earnings growing" : "Earnings declining"
                } dot={getMetricDot(f.eps_growth_1y, { green: 20, yellow: 5 })} />
              </DetailedSection>

              <DetailedSection title="💰 Profitability" defaultOpen={false}>
                <MetricRow label="Net Margin" value={fmtVal(f.net_margin)} explanation={
                  f.net_margin == null ? "Data not available" :
                  `Company keeps $${(f.net_margin / 100).toFixed(2)} of every $1 in revenue as profit`
                } dot={getMetricDot(f.net_margin, { green: 15, yellow: 5 })} />
                <MetricRow label="Gross Margin" value={fmtVal(f.gross_margin)} explanation={
                  f.gross_margin == null ? "Data not available" :
                  f.gross_margin > 50 ? "Strong pricing power — low cost of goods" : "Moderate pricing power"
                } dot={getMetricDot(f.gross_margin, { green: 50, yellow: 30 })} />
                <MetricRow label="ROE" value={fmtVal(f.roe)} explanation={
                  f.roe == null ? "Data not available" :
                  `Generates ${f.roe.toFixed(0)} cents of profit for every dollar of shareholder equity`
                } dot={getMetricDot(f.roe, { green: 20, yellow: 10 })} />
                <MetricRow label="ROA" value={fmtVal(f.roa)} explanation={
                  f.roa == null ? "Data not available" : "How efficiently the company converts assets into profit"
                } dot={getMetricDot(f.roa, { green: 10, yellow: 5 })} />
              </DetailedSection>

              <DetailedSection title="🏦 Financial Health" defaultOpen={false}>
                <MetricRow label="Debt/Equity" value={f.debt_to_equity != null ? f.debt_to_equity.toFixed(2) : "N/A"} explanation={
                  f.debt_to_equity == null ? "Data not available" :
                  f.debt_to_equity < 0.5 ? "Low debt relative to equity — financially conservative" :
                  f.debt_to_equity < 1 ? "Moderate debt levels" : "High debt — potential risk"
                } dot={getMetricDot(f.debt_to_equity, { green: 0.5, yellow: 1.5, reverse: true })} />
                <MetricRow label="Current Ratio" value={f.current_ratio != null ? f.current_ratio.toFixed(1) : "N/A"} explanation={
                  f.current_ratio == null ? "Data not available" :
                  `Has ${f.current_ratio.toFixed(1)}x more short-term assets than liabilities`
                } dot={getMetricDot(f.current_ratio, { green: 2, yellow: 1 })} />
                <MetricRow label="Free Cash Flow" value={fmtMoney(f.free_cash_flow)} explanation={
                  f.free_cash_flow == null ? "Data not available" :
                  f.free_cash_flow > 0 ? "Generates cash after expenses — can invest or return to shareholders" :
                  "Burning cash — needs external funding"
                } dot={getMetricDot(f.free_cash_flow, { green: 1, yellow: 0 })} />
              </DetailedSection>

              <DetailedSection title="👨‍💼 Analyst Ratings" defaultOpen={false}>
                <MetricRow label="Consensus Rating" value={f.analyst_rating || "N/A"} explanation={
                  !f.analyst_rating ? "Data not available" :
                  f.analyst_rating === "Strong Buy" ? "Majority of analysts recommend buying" :
                  f.analyst_rating === "Buy" ? "Analysts lean bullish" :
                  f.analyst_rating === "Hold" ? "Analysts are neutral" : "Analysts recommend selling"
                } dot={getMetricDot(
                  f.analyst_rating === "Strong Buy" ? 5 : f.analyst_rating === "Buy" ? 4 : f.analyst_rating === "Hold" ? 3 : 1,
                  { green: 4, yellow: 3 }
                )} />
                <MetricRow label="Mean Price Target" value={f.target_mean != null ? `$${f.target_mean.toFixed(0)}` : "N/A"} explanation={
                  f.target_mean == null ? "Data not available" : `Average analyst thinks stock is worth $${f.target_mean.toFixed(0)}`
                } dot="bg-muted-foreground/30" />
                <MetricRow label="Upside to Target" value={price > 0 && f.target_mean != null ? `${upside >= 0 ? "+" : ""}${upside.toFixed(0)}%` : "N/A"} explanation={
                  f.target_mean == null ? "Data not available" : `Current price has ${Math.abs(upside).toFixed(0)}% ${upside >= 0 ? "upside" : "downside"} to consensus`
                } dot={getMetricDot(upside, { green: 10, yellow: 0 })} />
                <MetricRow label="Target Range" value={f.target_low != null && f.target_high != null ? `$${f.target_low.toFixed(0)} – $${f.target_high.toFixed(0)}` : "N/A"} explanation="Bear to bull case range from analysts" dot="bg-muted-foreground/30" />
              </DetailedSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
