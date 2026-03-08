import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import VolumeLeaders from "./VolumeLeaders";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import { useVolumeDryUp } from "@/hooks/useVolumeDryUp";
import BubbleChartView from "./BubbleChartView";

const DM_MONO = "'DM Mono', monospace";
const VIEW_KEY = "overviewView";
type ViewMode = "table" | "bubble";
const EOD_TOOLTIP = "Accumulating EOD history — available after more daily saves. 1W and 1M performance require at least 5 and 20 saved trading days respectively.";
const SIGNAL_TOOLTIP =
  "Divergence between momentum rank and breadth rank. '⚠ Thin' = momentum rank is much better than breadth — price move driven by few tickers, not confirmed by broad participation. '👀 Watch' = breadth rank is much better than momentum — broad quiet strength not yet reflected in price. Potential early rotation signal.";
const VOL_TOOLTIP = "Average relative volume across all theme tickers vs their 20-day average. >1.8× = unusual institutional interest. >1.4× = elevated. <0.8× = quiet. Factors into momentum score as a conviction multiplier.";
const MOMENTUM_TOOLTIP = "Weighted score: 20% today + 35% this week + 45% this month, adjusted for volume. Higher = stronger sustained momentum. Normalized 0-100 across all themes.";

type SortMode = "momentum" | "breadth";

function getRelVolColor(val: number): string {
  if (val > 1.8) return "#00f5c4";
  if (val > 1.4) return "#4ade80";
  if (val >= 1.1) return "#facc15";
  return "currentColor";
}

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

function breadthPctColor(pct: number): string {
  if (pct >= 80) return "#00f5c4";
  if (pct >= 60) return "#4ade80";
  if (pct >= 40) return "#f5a623";
  return "#ef4444";
}

function BreadthCell({ up, total }: { up: number; total: number }) {
  const pct = total > 0 ? Math.round((up / total) * 100) : 0;
  return (
    <td className="px-3 py-2.5 text-right">
      <div style={{ fontFamily: DM_MONO, color: breadthPctColor(pct) }} className="text-sm font-medium">
        {pct}%
      </div>
      <div className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        {up}/{total}
      </div>
    </td>
  );
}

function VolCell({ avgRelVol, isDryingUp }: { avgRelVol: number | null; isDryingUp: boolean }) {
  return (
    <td className="px-3 py-2.5 text-right">
      <div className="flex items-center justify-end gap-1">
        {isDryingUp && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block h-2 w-2 rounded-full bg-[#f5a623] shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px] text-xs">
              Volume drying up after elevated activity
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            {avgRelVol !== null ? (
              <span
                className="text-sm font-medium cursor-help"
                style={{ fontFamily: DM_MONO, color: getRelVolColor(avgRelVol) }}
              >
                {avgRelVol.toFixed(1)}×
              </span>
            ) : (
              <span className="text-sm text-muted-foreground cursor-help" style={{ fontFamily: DM_MONO }}>--</span>
            )}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-xs">
            {VOL_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </div>
    </td>
  );
}

function SignalCell({ divergence }: { divergence: number }) {
  if (divergence <= -5) {
    return (
      <td className="px-3 py-2.5 text-center">
        <span className="text-[11px] font-medium text-[#f5a623]" style={{ fontFamily: DM_MONO }}>⚠ Thin</span>
      </td>
    );
  }
  if (divergence >= 5) {
    return (
      <td className="px-3 py-2.5 text-center">
        <span className="text-[11px] font-medium text-[#00f5c4]" style={{ fontFamily: DM_MONO }}>👀 Watch</span>
      </td>
    );
  }
  return <td className="px-3 py-2.5" />;
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
          <td className="px-3 py-3"><Skeleton className="h-4 w-10" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-12" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-16" /></td>
          <td className="px-3 py-3"><Skeleton className="h-4 w-12" /></td>
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
   const [sortMode, setSortMode] = useState<SortMode>("momentum");
   const [highlightId, setHighlightId] = useState<string | null>(null);
   const [drilldownOpen, setDrilldownOpen] = useState(false);
   const [drilldownTheme, setDrilldownTheme] = useState<ReturnType<typeof useLiveThemeData>["themes"][0] | null>(null);
   const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

   const { themes: liveThemes } = useLiveThemeData("Today");
   const { isThemeDryingUp } = useVolumeDryUp();

   const handleSelectTheme = useCallback((themeId: string) => {
     const el = rowRefs.current.get(themeId);
     if (el) {
       el.scrollIntoView({ behavior: "smooth", block: "center" });
       setHighlightId(themeId);
     }
   }, []);

   const handleOpenDrilldown = useCallback((themeName: string) => {
     const theme = liveThemes.find(t => t.theme_name === themeName);
     if (theme) {
       setDrilldownTheme(theme);
       setDrilldownOpen(true);
     }
   }, [liveThemes]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const enriched = useMemo(() => {
    if (themes.length === 0) return [];

    const momentumRanked = themes.map((t, i) => ({ ...t, momentumRank: i + 1 }));

    const byBreadth = [...momentumRanked].sort((a, b) => {
      const aPct = a.breadthTotal > 0 ? a.breadthUp / a.breadthTotal : 0;
      const bPct = b.breadthTotal > 0 ? b.breadthUp / b.breadthTotal : 0;
      return bPct - aPct;
    });
    const breadthRankMap = new Map<string, number>();
    byBreadth.forEach((t, i) => breadthRankMap.set(t.themeId, i + 1));

    return momentumRanked.map(t => ({
      ...t,
      breadthRank: breadthRankMap.get(t.themeId) || 0,
      breadthPct: t.breadthTotal > 0 ? Math.round((t.breadthUp / t.breadthTotal) * 100) : 0,
      divergence: t.momentumRank - (breadthRankMap.get(t.themeId) || 0),
    }));
  }, [themes]);

  const sorted = useMemo(() => {
    if (sortMode === "breadth") {
      return [...enriched].sort((a, b) => b.breadthPct - a.breadthPct);
    }
    return enriched;
  }, [enriched, sortMode]);

  return (
    <div className="h-full overflow-auto">
      <VolumeLeaders themes={themes} onSelectTheme={handleSelectTheme} onDrilldownOpen={handleOpenDrilldown} />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
            Theme Rankings
          </span>
          <span>{themes.length} themes ranked</span>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-1">
          {(["momentum", "breadth"] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                sortMode === mode
                  ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]"
              }`}
            >
              {mode === "momentum" ? "Momentum" : "Breadth"}
              {sortMode === mode && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-[#00f5c4]" />
              )}
            </button>
          ))}
        </div>
      </div>

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
              <th className="px-3 py-2.5 text-left font-medium">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help inline-flex items-center gap-1">
                      Momentum <Info size={10} className="opacity-50" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] text-xs">
                    {MOMENTUM_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
              </th>
              <th className="px-3 py-2.5 text-right font-medium">1D</th>
              <th className="px-3 py-2.5 text-right font-medium">1W</th>
              <th className="px-3 py-2.5 text-right font-medium">1M</th>
              <th className="px-3 py-2.5 text-right font-medium">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help inline-flex items-center gap-1">
                      Vol <Info size={10} className="opacity-50" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    {VOL_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Breadth</th>
              <th className="px-3 py-2.5 text-center font-medium">7D</th>
              <th className="px-3 py-2.5 text-center font-medium">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help inline-flex items-center gap-1">
                      Signal <Info size={10} className="opacity-50" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                    {SIGNAL_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
              </th>
              <th className="px-3 py-2.5 text-center font-medium w-10">Trend</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : (
              sorted.map((t, i) => {
                const borderColor =
                  t.divergence <= -5
                    ? "2px solid #f5a623"
                    : t.divergence >= 5
                    ? "2px solid #00f5c4"
                    : "2px solid transparent";

                return (
                  <tr
                    key={t.themeId}
                    ref={el => { if (el) rowRefs.current.set(t.themeId, el); }}
                    className={`border-b border-[rgba(255,255,255,0.04)] transition-all duration-200 hover:bg-[rgba(255,255,255,0.03)] ${
                      highlightId === t.themeId ? "bg-[rgba(0,245,196,0.06)]" : ""
                    }`}
                    style={{ borderLeft: borderColor }}
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
                    <VolCell avgRelVol={t.avgRelVol} isDryingUp={isThemeDryingUp(t.themeName)} />
                    <BreadthCell up={t.breadthUp} total={t.breadthTotal} />
                    <td className="px-3 py-2.5 text-center">
                      <MiniSparkline data={t.sparklineData} />
                    </td>
                    <SignalCell divergence={t.divergence} />
                    <td className="px-3 py-2.5 text-center">
                      <TrendArrow score={t.momentumScore} />
                    </td>
                  </tr>
                );
              })
            )}
           </tbody>
         </table>
       </div>

       <ThemeDrilldownModal 
         theme={drilldownTheme} 
         open={drilldownOpen} 
         onOpenChange={setDrilldownOpen}
         defaultSortKey="relVol"
       />
     </div>
   );
}
