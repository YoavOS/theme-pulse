import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, TrendingDown } from "lucide-react";

function MiniBar({ value1d, value1m }: { value1d: number; value1m: number }) {
  const max = Math.max(Math.abs(value1d), Math.abs(value1m), 0.1);
  const w1d = Math.abs(value1d) / max * 100;
  const w1m = Math.abs(value1m) / max * 100;

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="font-mono text-muted-foreground w-6 text-right">1D</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${w1d}%`,
            backgroundColor: value1d >= 0 ? "#00f5c4" : "#f5a623",
          }}
        />
      </div>
      <span className={`font-mono w-12 ${value1d >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}>
        {value1d >= 0 ? "+" : ""}{value1d.toFixed(2)}%
      </span>
    </div>
  );
}

function ThemeCard({ theme }: { theme: ThemeIntelData }) {
  const labelColor = {
    "Breaking Out": "text-[#00f5c4]",
    "Accelerating": "text-[#00f5c4]",
    "Losing Steam": "text-[#f5a623]",
    "Fading": "text-[#f5a623]",
    "Recovering": "text-[#00f5c4]",
    "Consolidating": "text-muted-foreground",
  }[theme.label];

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
        <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${labelColor}`}>
          {theme.label}
        </span>
      </div>

      {/* Mini bars comparing 1D vs 1M */}
      <div className="space-y-1 mb-2.5">
        <MiniBar value1d={theme.perf_1d} value1m={theme.perf_1m} />
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="font-mono text-muted-foreground w-6 text-right">1M</span>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.abs(theme.perf_1m) / Math.max(Math.abs(theme.perf_1d), Math.abs(theme.perf_1m), 0.1) * 100}%`,
                backgroundColor: theme.perf_1m >= 0 ? "#00f5c4" : "#f5a623",
              }}
            />
          </div>
          <span className={`font-mono w-12 ${theme.perf_1m >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}>
            {theme.perf_1m >= 0 ? "+" : ""}{theme.perf_1m.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Breadth */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
          <div
            className="h-full rounded-full bg-[#00f5c4]/60"
            style={{ width: `${theme.breadthTotal > 0 ? (theme.breadthUp / theme.breadthTotal) * 100 : 0}%` }}
          />
        </div>
        <span className="font-mono shrink-0">
          Breadth: {theme.breadthUp}/{theme.breadthTotal} confirm
        </span>
      </div>
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
          <span className="rounded-full bg-[#00f5c4]/10 px-2 py-0.5 text-[10px] font-mono text-[#00f5c4]">
            {accelerating.length}
          </span>
        </div>
        <div className="space-y-2 overflow-auto max-h-[calc(100vh-220px)]">
          {isLoading ? (
            <SkeletonCards />
          ) : accelerating.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No accelerating themes</p>
          ) : (
            accelerating
              .sort((a, b) => (b.perf_1d - b.perf_1m) - (a.perf_1d - a.perf_1m))
              .map(t => <ThemeCard key={t.themeId} theme={t} />)
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
          <span className="rounded-full bg-[#f5a623]/10 px-2 py-0.5 text-[10px] font-mono text-[#f5a623]">
            {fading.length}
          </span>
        </div>
        <div className="space-y-2 overflow-auto max-h-[calc(100vh-220px)]">
          {isLoading ? (
            <SkeletonCards />
          ) : fading.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No fading themes</p>
          ) : (
            fading
              .sort((a, b) => (a.perf_1d - a.perf_1m) - (b.perf_1d - b.perf_1m))
              .map(t => <ThemeCard key={t.themeId} theme={t} />)
          )}
        </div>
      </div>
    </div>
  );
}
