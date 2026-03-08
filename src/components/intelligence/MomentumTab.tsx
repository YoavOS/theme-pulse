import { useMemo } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, TrendingDown } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { hasThemeBreadthEvent } from "@/hooks/useBreadthAlerts";
import { useVolumeDryUp } from "@/hooks/useVolumeDryUp";

const DM_MONO = "'DM Mono', monospace";
const EOD_TOOLTIP = "Accumulating EOD history — available after more daily saves";

function MiniBar({ label, value, max, hasData }: { label: string; value: number; max: number; hasData: boolean }) {
  const w = hasData ? (Math.abs(value) / max) * 100 : 0;
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground w-6 text-right" style={{ fontFamily: DM_MONO }}>{label}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${w}%`,
            backgroundColor: value >= 0 ? "#00f5c4" : "#f5a623",
          }}
        />
      </div>
      {hasData ? (
        <span className={`w-12 ${value >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}`} style={{ fontFamily: DM_MONO }}>
          {value >= 0 ? "+" : ""}{value.toFixed(2)}%
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="w-12 text-muted-foreground cursor-help" style={{ fontFamily: DM_MONO }}>--</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px] text-xs">{EOD_TOOLTIP}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function VolumeSignal({ theme, isAccelerating }: { theme: ThemeIntelData; isAccelerating: boolean }) {
  try {
    const relVol = theme.avgRelVol;
    if (relVol === null) return null;

    if (relVol > 1.4 && isAccelerating) {
      return (
        <div className="text-[10px] font-medium text-[#00f5c4] mt-1" style={{ fontFamily: DM_MONO }}>
          ⚡ Volume confirming
        </div>
      );
    }
    if (relVol > 1.4 && !isAccelerating) {
      return (
        <div className="text-[10px] font-medium text-[#ef4444] mt-1" style={{ fontFamily: DM_MONO }}>
          ⚡ High volume selling
        </div>
      );
    }
    if (relVol < 0.8 && isAccelerating) {
      return (
        <div className="text-[10px] font-medium text-[#facc15] mt-1" style={{ fontFamily: DM_MONO }}>
          ⚠ Low volume move
        </div>
      );
    }
    return null;
  } catch {
    return null;
  }
}

function BreadthEventLabel({ themeName }: { themeName: string }) {
  const event = useMemo(() => hasThemeBreadthEvent(themeName), [themeName]);
  if (!event) return null;
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide ${
        event.type === "surge" ? "text-[#00f5c4]" : "text-[#60a5fa]"
      }`}
      style={{ fontFamily: DM_MONO }}
      title={
        event.type === "surge"
          ? `Breadth surged ${event.yesterdayBreadth}% → ${event.todayBreadth}%`
          : `Breadth collapsed ${event.yesterdayBreadth}% → ${event.todayBreadth}%`
      }
    >
      {event.type === "surge" ? "🔥 Breadth Surge" : "❄️ Breadth Collapse"}
    </span>
  );
}

function VolumeDryUpLabel({ themeName }: { themeName: string }) {
  const { isThemeDryingUp } = useVolumeDryUp();
  const isDrying = useMemo(() => isThemeDryingUp(themeName), [themeName, isThemeDryingUp]);
  if (!isDrying) return null;
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide text-[#f5a623]"
      style={{ fontFamily: DM_MONO }}
      title="Volume fading after elevated activity — potential reversal signal"
    >
      📉 Volume Fading
    </span>
  );
}

function ThemeCard({ theme, isAccelerating }: { theme: ThemeIntelData; isAccelerating: boolean }) {
  const labelColorMap: Record<string, string> = {
    "Breaking Out": "text-[#00f5c4]",
    "Breaking Out (low vol)": "text-[#facc15]",
    "Accelerating": "text-[#00f5c4]",
    "Losing Steam": "text-[#f5a623]",
    "Fading": "text-[#f5a623]",
    "Fading Hard": "text-[#ef4444]",
    "Recovering": "text-[#00f5c4]",
    "Consolidating": "text-muted-foreground",
  };
  const labelColor = labelColorMap[theme.label] || "text-muted-foreground";

  const max = Math.max(Math.abs(theme.perf_1d), Math.abs(theme.perf_1m), 0.1);

  return (
    <div
      className="rounded-lg p-3.5 transition-all hover:bg-[rgba(255,255,255,0.06)]"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="font-['Syne',sans-serif] font-semibold text-[13px] text-foreground leading-tight">
          {theme.themeName}
        </h4>
        <div className="flex flex-col items-end gap-0.5">
          <BreadthEventLabel themeName={theme.themeName} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${labelColor}`}>
            {theme.label}
          </span>
        </div>
      </div>

      {/* Mini bars comparing 1D vs 1M */}
      <div className="space-y-1 mb-2.5">
        <MiniBar label="1D" value={theme.perf_1d} max={max} hasData={true} />
        <MiniBar label="1M" value={theme.perf_1m} max={max} hasData={theme.hasEodHistory} />
      </div>

      {/* Breadth */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
          <div
            className="h-full rounded-full bg-[#00f5c4]/60"
            style={{ width: `${theme.breadthTotal > 0 ? (theme.breadthUp / theme.breadthTotal) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0" style={{ fontFamily: DM_MONO }}>
          Breadth: {theme.breadthUp}/{theme.breadthTotal} confirm
        </span>
      </div>

      {/* Volume confirmation signal */}
      <VolumeSignal theme={theme} isAccelerating={isAccelerating} />
    </div>
  );
}

function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg p-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <Skeleton className="h-4 w-32 mb-2" />
          <Skeleton className="h-3 w-full mb-1" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-2 w-24" />
        </div>
      ))}
    </>
  );
}

export default function MomentumTab({
  accelerating,
  fading,
  isLoading,
}: {
  accelerating: ThemeIntelData[];
  fading: ThemeIntelData[];
  isLoading: boolean;
}) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-2">
      {/* Accelerating panel */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Rocket size={16} className="text-[#00f5c4]" />
          <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-[#00f5c4]">
            Accelerating
          </h3>
          <span className="rounded-full bg-[#00f5c4]/10 px-2 py-0.5 text-[10px] text-[#00f5c4]" style={{ fontFamily: DM_MONO }}>
            {accelerating.length}
          </span>
        </div>
        <div className="space-y-2 overflow-auto max-h-[calc(100vh-220px)]">
          {isLoading ? (
            <SkeletonCards />
          ) : accelerating.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No accelerating themes</p>
          ) : (
            [...accelerating]
              .sort((a, b) => (b.perf_1d - b.perf_1m) - (a.perf_1d - a.perf_1m))
              .map(t => <ThemeCard key={t.themeId} theme={t} isAccelerating={true} />)
          )}
        </div>
      </div>

      {/* Fading panel */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <TrendingDown size={16} className="text-[#f5a623]" />
          <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-[#f5a623]">
            Fading
          </h3>
          <span className="rounded-full bg-[#f5a623]/10 px-2 py-0.5 text-[10px] text-[#f5a623]" style={{ fontFamily: DM_MONO }}>
            {fading.length}
          </span>
        </div>
        <div className="space-y-2 overflow-auto max-h-[calc(100vh-220px)]">
          {isLoading ? (
            <SkeletonCards />
          ) : fading.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No fading themes</p>
          ) : (
            [...fading]
              .sort((a, b) => (a.perf_1d - a.perf_1m) - (b.perf_1d - b.perf_1m))
              .map(t => <ThemeCard key={t.themeId} theme={t} isAccelerating={false} />)
          )}
        </div>
      </div>
    </div>
  );
}
