import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const DM_MONO = "'DM Mono', monospace";
const EOD_TOOLTIP = "Accumulating EOD history — available after more daily saves";

function PerfCell({ value, hasData }: { value: number; hasData: boolean }) {
  if (!hasData) {
    return (
      <td className="px-3 py-2.5 text-right text-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground cursor-help" style={{ fontFamily: DM_MONO }}>--</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px] text-xs">
            {EOD_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </td>
    );
  }
  const color = value > 0 ? "text-[#00f5c4]" : value < 0 ? "text-[#f5a623]" : "text-muted-foreground";
  const sign = value > 0 ? "+" : "";
  return (
    <td className={`px-3 py-2.5 text-right text-sm ${color}`} style={{ fontFamily: DM_MONO }}>
      {sign}{value.toFixed(2)}%
    </td>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 3) {
    return <span className="text-muted-foreground text-[10px]" style={{ fontFamily: DM_MONO }}>--</span>;
  }
  const chartData = data.map((v, i) => ({ v, i }));
  const trend = data[data.length - 1] >= data[0];
  return (
    <div className="w-16 h-6">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={trend ? "#00f5c4" : "#f5a623"}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
      <span className="text-xs text-muted-foreground w-7 text-right" style={{ fontFamily: DM_MONO }}>{score}</span>
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
          <td className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>
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
              <th className="px-3 py-2.5 text-center font-medium">7D</th>
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
                  <td className="px-3 py-2.5 text-xs text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                    {i + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-['Syne',sans-serif] font-semibold text-foreground text-[13px] leading-tight">
                      {t.themeName}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: DM_MONO }}>
                      {t.breadthUp}/{t.breadthTotal} advancing
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <MomentumBar score={t.momentumScore} />
                  </td>
                  <PerfCell value={t.perf_1d} hasData={true} />
                  <PerfCell value={t.perf_1w} hasData={t.hasEodHistory} />
                  <PerfCell value={t.perf_1m} hasData={t.hasEodHistory} />
                  <td className="px-3 py-2.5 text-center">
                    <MiniSparkline data={t.sparklineData} />
                  </td>
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
