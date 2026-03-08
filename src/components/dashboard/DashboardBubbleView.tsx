import { useState, useMemo, useCallback } from "react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
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

const DM_MONO = "'DM Mono', monospace";

interface BubblePoint {
  x: number;
  y: number;
  z: number;
  themeName: string;
  perf_1d: number;
  avgRelVol: number | null;
  breadthPct: number;
}

function getBubbleColor(perf1d: number): string {
  if (perf1d > 2) return "#00f5c4";
  if (perf1d >= 0) return "#4ade80";
  if (perf1d >= -2) return "#f5a623";
  return "#ef4444";
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
        <div>
          1D: <span className={d.perf_1d >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}>
            {d.perf_1d >= 0 ? "+" : ""}{d.perf_1d.toFixed(2)}%
          </span>
          {" | Breadth: "}{d.breadthPct}%
        </div>
        <div>Rel Vol: {d.avgRelVol !== null ? `${d.avgRelVol.toFixed(1)}×` : "N/A"}</div>
      </div>
    </div>
  );
}

export default function DashboardBubbleView({
  themes,
  getThemeSignals,
  dimmedThemes,
}: {
  themes: ThemeData[];
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  dimmedThemes?: Set<string> | null;
}) {
  const [drilldownTheme, setDrilldownTheme] = useState<ThemeData | null>(null);

  const data = useMemo<BubblePoint[]>(() => {
    return themes.map(t => {
      const valid = t.tickers.filter(tk => !tk.skipped);
      const total = valid.length;
      const up = valid.filter(tk => tk.pct > 0).length;
      const breadthPct = total > 0 ? Math.round((up / total) * 100) : 0;
      const symbols = t.tickers.map(tk => tk.symbol);
      const signals = getThemeSignals ? getThemeSignals(symbols) : null;
      const relVol = signals?.relVol ?? null;
      const z = Math.max(8, Math.min(40, relVol != null && relVol > 0 ? 8 + (relVol / 3) * 32 : 8));

      return {
        x: t.performance_pct,
        y: breadthPct,
        z,
        themeName: t.theme_name,
        perf_1d: t.performance_pct,
        avgRelVol: relVol,
        breadthPct,
      };
    });
  }, [themes, getThemeSignals]);

  const handleClick = useCallback((point: BubblePoint) => {
    const theme = themes.find(t => t.theme_name === point.themeName);
    if (theme) setDrilldownTheme(theme);
  }, [themes]);

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
        <div className="h-[600px] w-full p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                type="number"
                dataKey="x"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              >
                <Label value="1D Performance % →" position="bottom" offset={0} style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }} />
              </XAxis>
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              >
                <Label value="↑ Breadth %" position="insideTopLeft" offset={10} style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }} />
              </YAxis>
              <ZAxis type="number" dataKey="z" range={[64, 1600]} />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />
              <RechartsTooltip content={<CustomTooltip />} cursor={false} />
              <Scatter data={data} isAnimationActive animationDuration={600}>
                {data.map((entry) => (
                  <Cell
                    key={entry.themeName}
                    fill={getBubbleColor(entry.perf_1d)}
                    fillOpacity={dimmedThemes && !dimmedThemes.has(entry.themeName.toLowerCase()) ? 0.15 : 0.75}
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

        {/* Quadrant labels */}
        <div className="relative -mt-[600px] h-[600px] pointer-events-none p-8">
          <div className="absolute top-8 right-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>Strong + Broad</div>
          <div className="absolute top-8 left-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>Broad but Weak</div>
          <div className="absolute bottom-12 right-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>Strong but Thin</div>
          <div className="absolute bottom-12 left-12 text-[10px] text-muted-foreground/40" style={{ fontFamily: DM_MONO }}>Weak + Narrow</div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] text-muted-foreground px-1" style={{ fontFamily: DM_MONO }}>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#00f5c4" }} /> &gt;+2%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#4ade80" }} /> 0–+2%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#f5a623" }} /> -2–0%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} /> &lt;-2%</span>
        <span className="opacity-60">|</span>
        <span>Bubble size = Rel Vol</span>
      </div>

      <ThemeDrilldownModal
        theme={drilldownTheme}
        open={!!drilldownTheme}
        onOpenChange={(o) => { if (!o) setDrilldownTheme(null); }}
      />
    </div>
  );
}
