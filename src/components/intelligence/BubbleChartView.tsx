import { useState, useMemo, useCallback } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
  ZAxis,
  Label,
} from "recharts";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";

const DM_MONO = "'DM Mono', monospace";

interface BubblePoint {
  x: number; // momentum
  y: number; // breadth %
  z: number; // rel vol (for size)
  themeName: string;
  shortName: string;
  perf_1d: number;
  avgRelVol: number | null;
  sustainedVol: number | null;
  themeId: string;
}

function getBubbleColor(perf1d: number): string {
  if (perf1d > 2) return "#00f5c4";
  if (perf1d >= 0) return "#4ade80";
  if (perf1d >= -2) return "#f5a623";
  return "#ef4444";
}

function truncateName(name: string): string {
  const words = name.split(/\s+/);
  return words.length > 2 ? words.slice(0, 2).join(" ") : name;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as BubblePoint;
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-xl"
      style={{
        background: "rgba(20,20,30,0.95)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="font-['Syne',sans-serif] text-sm font-semibold text-foreground mb-1.5">{d.themeName}</div>
      <div className="space-y-0.5 text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        <div>Momentum: {d.x} | Breadth: {d.y}%</div>
        <div>
          1D: <span className={d.perf_1d >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}>
            {d.perf_1d >= 0 ? "+" : ""}{d.perf_1d.toFixed(2)}%
          </span>
          {" | Rel Vol: "}
          {d.avgRelVol !== null ? `${d.avgRelVol.toFixed(1)}×` : "N/A"}
        </div>
        {d.sustainedVol !== null && (
          <div>Sustained Vol: {d.sustainedVol >= 0 ? "+" : ""}{d.sustainedVol.toFixed(0)}%</div>
        )}
        {d.avgRelVol === null && (
          <div className="text-[10px] italic mt-1 opacity-60">Volume data unavailable</div>
        )}
      </div>
    </div>
  );
}

const QUADRANT_LABELS = [
  { x: 78, y: 92, text: "Strong + Broad", anchor: "end" },
  { x: 22, y: 92, text: "Broad but Weak", anchor: "start" },
  { x: 78, y: 8, text: "Strong but Thin", anchor: "end" },
  { x: 22, y: 8, text: "Weak + Narrow", anchor: "start" },
];

export default function BubbleChartView({
  themes,
  isLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownTheme, setDrilldownTheme] = useState<any>(null);
  const { themes: liveThemes } = useLiveThemeData("Today");

  const data = useMemo<BubblePoint[]>(() => {
    return themes.map(t => {
      const breadthPct = t.breadthTotal > 0 ? Math.round((t.breadthUp / t.breadthTotal) * 100) : 0;
      const relVol = t.avgRelVol ?? 0;
      // Map rel vol to bubble size: min 8, max 40
      const z = Math.max(8, Math.min(40, relVol > 0 ? 8 + (relVol / 3) * 32 : 8));
      return {
        x: t.momentumScore,
        y: breadthPct,
        z,
        themeName: t.themeName,
        shortName: truncateName(t.themeName),
        perf_1d: t.perf_1d,
        avgRelVol: t.avgRelVol,
        sustainedVol: t.sustainedVol,
        themeId: t.themeId,
      };
    });
  }, [themes]);

  const handleClick = useCallback((point: BubblePoint) => {
    const theme = liveThemes.find(t => t.theme_name === point.themeName);
    if (theme) {
      setDrilldownTheme(theme);
      setDrilldownOpen(true);
    }
  }, [liveThemes]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center rounded-lg"
        style={{ height: 500, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <span className="text-sm text-muted-foreground animate-pulse">Loading bubble chart…</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="overflow-hidden rounded-lg"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="h-[350px] md:h-[500px] w-full p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
              />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              >
                <Label
                  value="Momentum Score →"
                  position="bottom"
                  offset={0}
                  style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }}
                />
              </XAxis>
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              >
                <Label
                  value="↑ Breadth %"
                  position="insideTopLeft"
                  offset={10}
                  style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }}
                />
              </YAxis>
              <ZAxis type="number" dataKey="z" range={[64, 1600]} />

              {/* Quadrant reference lines */}
              <ReferenceLine x={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />

              <RechartsTooltip
                content={<CustomTooltip />}
                cursor={false}
              />

              <Scatter data={data} isAnimationActive animationDuration={600}>
                {data.map((entry, i) => (
                  <Cell
                    key={entry.themeId}
                    fill={getBubbleColor(entry.perf_1d)}
                    fillOpacity={0.75}
                    stroke={getBubbleColor(entry.perf_1d)}
                    strokeWidth={1}
                    style={{ cursor: "pointer" }}
                    onClick={() => handleClick(entry)}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Quadrant labels overlay */}
        <div className="relative -mt-[350px] md:-mt-[500px] h-[350px] md:h-[500px] pointer-events-none p-8">
          <div className="absolute top-8 right-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>
            Strong + Broad
          </div>
          <div className="absolute top-8 left-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>
            Broad but Weak
          </div>
          <div className="absolute bottom-12 right-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>
            Strong but Thin
          </div>
          <div className="absolute bottom-12 left-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>
            Weak + Narrow
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] text-muted-foreground px-1" style={{ fontFamily: DM_MONO }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#00f5c4" }} /> &gt;+2%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#4ade80" }} /> 0–+2%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#f5a623" }} /> -2–0%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} /> &lt;-2%
        </span>
        <span className="opacity-60">|</span>
        <span>Bubble size = Rel Vol</span>
        <span className="opacity-60">|</span>
        <span>Quadrants: momentum × breadth</span>
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
