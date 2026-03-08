import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import { Zap } from "lucide-react";
import { useState } from "react";

function getRelVolColor(val: number): string {
  if (val > 1.8) return "text-[hsl(152,100%,50%)]"; // bright green
  if (val > 1.4) return "text-gain-medium";
  if (val >= 1.1) return "text-yellow-400";
  return "text-muted-foreground";
}

function getSustainedColor(val: number): string {
  if (val > 30) return "text-[hsl(152,100%,50%)]";
  if (val >= 15) return "text-gain-medium";
  if (val >= 5) return "text-yellow-400";
  return "text-muted-foreground";
}

function DemandSkeleton() {
  return (
    <div className="mt-2 space-y-1">
      <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
      <div className="flex gap-2">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

interface Props {
  signals: ThemeDemandSignals;
}

export default function DemandSignals({ signals }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const { relVol, relVolEstimated, sustainedVol, spikingUp, spikingDown, totalTickers, loading } = signals;
  const hasSpike = spikingUp > 0 || spikingDown > 0;

  // Mobile collapse
  if (collapsed) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
        className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        title="Show Demand Signals"
      >
        <Zap size={10} className="text-yellow-400" />
        <span>Demand Signals</span>
      </button>
    );
  }

  if (loading) return <DemandSkeleton />;

  return (
    <div className="mt-2 border-t border-border/40 pt-1.5" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.1em] text-gain-medium/60 uppercase">
          Demand Signals
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
          className="text-[9px] text-muted-foreground hover:text-foreground md:hidden"
        >
          ⚡
        </button>
      </div>
      <p className="text-[9px] italic text-muted-foreground leading-tight mt-0.5">
        Green Sustained Vol &gt;+20% + high Rel Vol + spike = accumulation signal
      </p>

      {/* Indicators */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {/* A: Relative Volume */}
        {relVol !== null ? (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono font-medium ${relVolEstimated ? "text-muted-foreground" : getRelVolColor(relVol)}`}
            title={relVolEstimated
              ? "Using 10-day avg as proxy — market closed. Live Rel Vol available during trading hours"
              : "Today's avg volume vs 20-day avg — >1.8× = strong unusual interest"}
          >
            {relVolEstimated ? "~" : relVol >= 1.1 ? "↑" : "↓"} Rel Vol: {relVolEstimated ? "~" : ""}{relVol.toFixed(2)}×
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
            title="Need more EOD history for accurate Rel Vol"
          >
            Rel Vol: --
          </span>
        )}

        {/* B: Sustained Volume */}
        {sustainedVol !== null ? (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono font-medium ${getSustainedColor(sustainedVol)}`}
            title="10-day avg vol vs 3-month avg — higher % = multi-day accumulation building"
          >
            {sustainedVol >= 5 ? "↑" : "↓"} Sustained Vol: {sustainedVol >= 0 ? "+" : ""}{sustainedVol.toFixed(0)}%
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            Sustained Vol: N/A
          </span>
        )}

        {/* C: Volume Spike */}
        {hasSpike && (
          <span
            className={`inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono font-medium ${
              spikingUp > 0 ? "text-gain-medium" : "text-loss-mild"
            }`}
            title="Number of theme tickers showing unusual volume today vs their 20-day avg"
          >
            {spikingUp > 0 && <span>↑ {spikingUp}/{totalTickers} spiking</span>}
            {spikingUp > 0 && spikingDown > 0 && <span className="mx-0.5">·</span>}
            {spikingDown > 0 && <span className="text-loss-mild">↓ {spikingDown}/{totalTickers} dropping</span>}
          </span>
        )}
      </div>
    </div>
  );
}
