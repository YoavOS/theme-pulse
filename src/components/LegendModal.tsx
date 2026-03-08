import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronDown, X } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

interface LegendItem {
  label: string;
  labelStyle: string;
  explanation: string;
}

function Section({ title, items, defaultOpen = false }: { title: string; items: LegendItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[rgba(255,255,255,0.06)] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
      >
        <span className="text-xs font-semibold uppercase tracking-widest text-foreground" style={{ fontFamily: SYNE }}>
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-3">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="shrink-0 min-w-[140px] text-right"
                dangerouslySetInnerHTML={{ __html: item.labelStyle }}
              />
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                {item.explanation}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const momentumLabels: LegendItem[] = [
  {
    label: "Breaking Out",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#00f5c4]" style="font-family: ${DM_MONO}">Breaking Out</span>`,
    explanation: "Short-term performance is significantly outpacing long-term trend AND volume confirms. Strong rotation signal.",
  },
  {
    label: "Breaking Out (low vol)",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#facc15]" style="font-family: ${DM_MONO}">Breaking Out (low vol)</span>`,
    explanation: "Price is moving higher short-term but volume is below average. Move lacks institutional conviction — watch for confirmation.",
  },
  {
    label: "Accelerating",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#00f5c4]" style="font-family: ${DM_MONO}">Accelerating</span>`,
    explanation: "Short-term is moderately outperforming long-term. Emerging strength, not yet a full breakout.",
  },
  {
    label: "Consolidating",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" style="font-family: ${DM_MONO}">Consolidating</span>`,
    explanation: "Short-term and long-term performance are roughly equal. Theme is in a holding pattern — no clear direction.",
  },
  {
    label: "Losing Steam",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#f5a623]" style="font-family: ${DM_MONO}">Losing Steam</span>`,
    explanation: "Short-term is underperforming long-term. Recent strength is fading but not yet a full reversal.",
  },
  {
    label: "Fading",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#f5a623]" style="font-family: ${DM_MONO}">Fading</span>`,
    explanation: "Long-term trend is positive but short-term is negative. The theme is losing momentum.",
  },
  {
    label: "Fading Hard",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#ef4444]" style="font-family: ${DM_MONO}">Fading Hard</span>`,
    explanation: "Short-term is significantly underperforming long-term AND volume confirms selling. Strong reversal signal with institutional distribution.",
  },
  {
    label: "Recovering",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-wide text-[#00f5c4]" style="font-family: ${DM_MONO}">Recovering</span>`,
    explanation: "Short-term is positive while long-term is still negative. Early signs of a turnaround — watch for sustained follow-through.",
  },
];

const volumeSignals: LegendItem[] = [
  {
    label: "Volume confirming",
    labelStyle: `<span class="text-[10px] font-medium text-[#00f5c4]" style="font-family: ${DM_MONO}">⚡ Volume confirming</span>`,
    explanation: "Today's volume is 40%+ above average AND the theme is accelerating. Institutional buying is supporting the move.",
  },
  {
    label: "High volume selling",
    labelStyle: `<span class="text-[10px] font-medium text-[#ef4444]" style="font-family: ${DM_MONO}">⚡ High volume selling</span>`,
    explanation: "Today's volume is elevated AND the theme is fading. Suggests institutional distribution — more serious than low-volume fading.",
  },
  {
    label: "Low volume move",
    labelStyle: `<span class="text-[10px] font-medium text-[#facc15]" style="font-family: ${DM_MONO}">⚠ Low volume move</span>`,
    explanation: "Theme is accelerating but volume is below average. Price move is not confirmed by participation — treat with caution.",
  },
  {
    label: "~ prefix on Rel Vol",
    labelStyle: `<span class="text-[10px] font-medium text-muted-foreground" style="font-family: ${DM_MONO}">~1.2×</span>`,
    explanation: "Estimated value — market is closed or no live data available. Uses recent historical average as proxy. Updates to live data during market hours.",
  },
];

const demandSignals: LegendItem[] = [
  {
    label: "Rel Vol",
    labelStyle: `<span class="text-[10px] font-medium text-[#00f5c4]" style="font-family: ${DM_MONO}">Rel Vol: 1.8×</span>`,
    explanation: "Today's volume vs 20-day average. >1.8× = unusual institutional interest. >1.4× = elevated. <0.8× = quiet, below average participation.",
  },
  {
    label: "Sustained Vol",
    labelStyle: `<span class="text-[10px] font-medium text-[#4ade80]" style="font-family: ${DM_MONO}">+29% sus</span>`,
    explanation: "10-day average volume vs 3-month average. Positive = multi-day accumulation building. Negative = volume trend declining.",
  },
  {
    label: "Vol Spike",
    labelStyle: `<span class="text-[10px] font-medium text-[#4ade80]" style="font-family: ${DM_MONO}">↑ +36%</span>`,
    explanation: "Today's volume vs 20-day average as a percentage. Only shown when change exceeds 30% — filters out noise.",
  },
];

const breadthIndicators: LegendItem[] = [
  {
    label: "X/Y advancing",
    labelStyle: `<span class="text-[10px] text-muted-foreground" style="font-family: ${DM_MONO}">8/9 advancing</span>`,
    explanation: "X out of Y tickers in the theme closed above their previous close today. Higher = broader participation in the move.",
  },
  {
    label: "Breadth %",
    labelStyle: `<span class="text-sm font-medium text-[#00f5c4]" style="font-family: ${DM_MONO}">89%</span>`,
    explanation: "Percentage of tickers advancing. >80% = very broad strength. <30% = narrow, single-stock driven.",
  },
  {
    label: "⚠ Thin signal",
    labelStyle: `<span class="text-[11px] font-medium text-[#f5a623]" style="font-family: ${DM_MONO}">⚠ Thin</span>`,
    explanation: "Momentum rank is much better than breadth rank — price move not confirmed by broad participation. Caution warranted.",
  },
  {
    label: "👀 Watch signal",
    labelStyle: `<span class="text-[11px] font-medium text-[#00f5c4]" style="font-family: ${DM_MONO}">👀 Watch</span>`,
    explanation: "Breadth rank is much better than momentum rank — broad quiet strength not yet reflected in price. Potential opportunity.",
  },
];

const scoringExplained: LegendItem[] = [
  {
    label: "Momentum Score",
    labelStyle: `<div class="flex items-center gap-1"><div class="h-1.5 w-12 rounded-full bg-[rgba(255,255,255,0.06)]"><div class="h-full w-3/4 rounded-full bg-[#00f5c4]"></div></div><span class="text-xs text-muted-foreground" style="font-family: ${DM_MONO}">75</span></div>`,
    explanation: "Weighted score: 20% today + 35% this week + 45% this month, adjusted for volume. Higher = stronger sustained momentum. Normalized 0-100 across all themes.",
  },
  {
    label: "Section: Strong",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-widest text-[#00f5c4]" style="font-family: ${SYNE}">Strong</span>`,
    explanation: "Themes with positive average daily performance. These are outperforming on the selected timeframe.",
  },
  {
    label: "Section: Neutral",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground" style="font-family: ${SYNE}">Neutral</span>`,
    explanation: "Themes with near-zero performance (between -0.5% and +0.5%). No clear directional bias on the selected timeframe.",
  },
  {
    label: "Section: Weak",
    labelStyle: `<span class="text-[10px] font-semibold uppercase tracking-widest text-[#f5a623]" style="font-family: ${SYNE}">Weak</span>`,
    explanation: "Themes with negative average daily performance. These are underperforming on the selected timeframe.",
  },
  {
    label: "7D Sparkline",
    labelStyle: `<span class="text-[10px] text-muted-foreground" style="font-family: ${DM_MONO}">7D chart</span>`,
    explanation: "Mini chart showing the primary ticker's closing price over the last 7 trading days. Green = trending up, amber = trending down.",
  },
  {
    label: "Trend Arrow",
    labelStyle: `<span class="text-[#00f5c4]">↗</span> <span class="text-[#f5a623]">↘</span> <span class="text-muted-foreground">—</span>`,
    explanation: "Quick visual: ↗ = momentum score >65 (strong). ↘ = score <35 (weak). — = neutral range in between.",
  },
];

export default function LegendModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[620px] border-none p-0 overflow-hidden max-h-[85vh] flex flex-col"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
          <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: SYNE }}>
            Indicator Guide
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable sections */}
        <div className="overflow-y-auto flex-1 vol-leaders-scroll">
          <Section title="Momentum Labels" items={momentumLabels} defaultOpen={true} />
          <Section title="Volume Signals" items={volumeSignals} />
          <Section title="Demand Signals" items={demandSignals} />
          <Section title="Breadth Indicators" items={breadthIndicators} />
          <Section title="Scoring & Layout" items={scoringExplained} />
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-[rgba(255,255,255,0.06)] shrink-0">
          <p className="text-[10px] text-muted-foreground text-center" style={{ fontFamily: DM_MONO }}>
            All indicators update automatically with each scan · Colors match what you see on cards
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
