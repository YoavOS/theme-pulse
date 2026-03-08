import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

function PerfCell({ value }: { value: number }) {
  const color = value > 0 ? "text-[#00f5c4]" : value < 0 ? "text-[#f5a623]" : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return (
    <td className={`px-3 py-2.5 text-right font-mono text-sm ${color}`}>
      {sign}{value.toFixed(2)}%
    </td>
  );
}

function MomentumBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${score}%`,
            background: score > 70
              ? "#00f5c4"
              : score > 40
              ? "linear-gradient(90deg, #00f5c4, #f5a623)"
              : "#f5a623",
          }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground w-7 text-right">{score}</span>
    </div>
  );
}

function TrendArrow({ score }: { score: number }) {
  if (score > 65) return <TrendingUp size={14} className="text-[#00f5c4]" />;
  if (score < 35) return <TrendingDown size={14} className="text-[#f5a623]" />;
  return <Minus size={14} className="text-muted-foreground" />;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-[rgba(255,255,255,0.04)]">
          <td className="px-3 py-3"><Skeleton className="h-4 w-6" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-32" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-14" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-14" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-14" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-6" /></td>
        </tr>
      ))}
    </>
  );
}

export default function OverviewTab({
  themes,
  isLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  return (
    <div className="h-full overflow-auto">
      {/* Summary */}
      <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
          Momentum Rankings
        </span>
        <span>{themes.length} themes ranked</span>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden rounded-lg"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.08)] text-xs text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-medium w-10">#</th>
              <th className="px-3 py-2.5 text-left font-medium">Theme</th>
              <th className="px-3 py-2.5 text-left font-medium">Momentum</th>
              <th className="px-3 py-2.5 text-right font-medium">1D</th>
              <th className="px-3 py-2.5 text-right font-medium">1W</th>
              <th className="px-3 py-2.5 text-right font-medium">1M</th>
              <th className="px-3 py-2.5 text-center font-medium w-10">Trend</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : (
              themes.map((t, i) => (
                <tr
                  key={t.themeId}
                  className="border-b border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-['Syne',sans-serif] font-semibold text-foreground text-[13px] leading-tight">
                      {t.themeName}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {t.breadthUp}/{t.breadthTotal} advancing
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <MomentumBar score={t.momentumScore} />
                  </td>
                  <PerfCell value={t.perf_1d} />
                  <PerfCell value={t.perf_1w} />
                  <PerfCell value={t.perf_1m} />
                  <td className="px-3 py-2.5 text-center">
                    <TrendArrow score={t.momentumScore} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
