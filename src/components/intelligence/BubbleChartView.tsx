import { useState, useMemo, useCallback } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip as RechartsTooltip, Cell, ZAxis, Label,
} from "recharts";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import type { Timeframe } from "./OverviewTab";

const DM_MONO = "'DM Mono', monospace";

const TF_FIELD: Record<Timeframe, "perf_1d" | "perf_1w" | "perf_1m" | "perf_3m" | "perf_ytd"> = {
  "1d": "perf_1d", "1w": "perf_1w", "1m": "perf_1m", "3m": "perf_3m", "ytd": "perf_ytd",
};
const TF_LABEL: Record<Timeframe, string> = { "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "ytd": "YTD" };

interface ThemeAug extends ThemeIntelData {
  perfActive?: number;
  breadthUpActive?: number;
  breadthTotalActive?: number;
  breadthPct?: number;
}

interface BubblePoint {
  x: number;
  y: number;
  z: number;
  themeName: string;
  perfActive: number;
  avgRelVol: number | null;
  sustainedVol: number | null;
  themeId: string;
  topTickers: { symbol: string; perf: number }[];
  leader: { symbol: string; perf: number } | null;
  breadthPct: number;
  breadthUp: number;
  breadthTotal: number;
}

function getBubbleColor(perf: number): string {
  if (perf > 2) return "#00f5c4";
  if (perf >= 0) return "#4ade80";
  if (perf >= -2) return "#f5a623";
  return "#ef4444";
}

function CustomTooltip({ active, payload, tfLabel }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as BubblePoint;
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs shadow-xl min-w-[220px]"
      style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(12px)" }}>
      <div className="font-['Syne',sans-serif] text-sm font-semibold text-foreground mb-1.5">{d.themeName}</div>
      <div className="space-y-0.5 text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        <div>Momentum: {d.x} · Breadth: {d.breadthPct}% ({d.breadthUp}/{d.breadthTotal})</div>
        <div>
          {tfLabel}:{" "}
          <span className={d.perfActive >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}>
            {d.perfActive >= 0 ? "+" : ""}{d.perfActive.toFixed(2)}%
          </span>
          {" · Rel Vol: "}
          {d.avgRelVol !== null ? `${d.avgRelVol.toFixed(1)}×` : "N/A"}
        </div>
        {d.sustainedVol !== null && (
          <div>Sustained Vol: {d.sustainedVol >= 0 ? "+" : ""}{d.sustainedVol.toFixed(0)}%</div>
        )}
        {d.leader && (
          <div className="text-[#00f5c4] mt-1">
            Led by {d.leader.symbol} {d.leader.perf >= 0 ? "+" : ""}{d.leader.perf.toFixed(2)}%
          </div>
        )}
        {d.topTickers.length > 0 && (
          <div className="pt-1.5 mt-1 border-t border-white/10">
            <div className="text-[10px] uppercase opacity-60 mb-0.5">Top movers</div>
            {d.topTickers.slice(0, 3).map(tk => (
              <div key={tk.symbol} className="flex justify-between gap-3">
                <span className="text-foreground">{tk.symbol}</span>
                <span className={tk.perf >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}>
                  {tk.perf >= 0 ? "+" : ""}{tk.perf.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BubbleChartView({
  themes, isLoading, timeframe = "1d",
}: {
  themes: ThemeAug[];
  isLoading: boolean;
  timeframe?: Timeframe;
}) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownTheme, setDrilldownTheme] = useState<any>(null);
  const { themes: liveThemes } = useLiveThemeData("Today");

  const field = TF_FIELD[timeframe];
  const tfLabel = TF_LABEL[timeframe];

  const data = useMemo<BubblePoint[]>(() => {
    return themes.map(t => {
      const valid = t.tickers.filter(tk => tk.status === "done");
      const perfActive = t.perfActive ?? (valid.length > 0
        ? valid.reduce((s, tk) => s + ((tk as any)[field] || 0), 0) / valid.length
        : 0);
      const breadthUp = t.breadthUpActive ?? valid.filter(tk => ((tk as any)[field] || 0) > 0).length;
      const breadthTotal = t.breadthTotalActive ?? valid.length;
      const breadthPct = t.breadthPct ?? (breadthTotal > 0 ? Math.round((breadthUp / breadthTotal) * 100) : 0);
      const relVol = t.avgRelVol ?? 0;
      const z = Math.max(8, Math.min(40, relVol > 0 ? 8 + (relVol / 3) * 32 : 8));

      const ranked = valid
        .map(tk => ({ symbol: tk.symbol, perf: ((tk as any)[field] as number) || 0 }))
        .sort((a, b) => b.perf - a.perf);

      return {
        x: t.momentumScore,
        y: breadthPct,
        z,
        themeName: t.themeName,
        perfActive: Math.round(perfActive * 100) / 100,
        avgRelVol: t.avgRelVol,
        sustainedVol: t.sustainedVol,
        themeId: t.themeId,
        topTickers: ranked.slice(0, 3),
        leader: ranked[0] || null,
        breadthPct,
        breadthUp,
        breadthTotal,
      };
    });
  }, [themes, field]);

  const handleClick = useCallback((point: BubblePoint) => {
    const theme = liveThemes.find(t => t.theme_name === point.themeName);
    if (theme) { setDrilldownTheme(theme); setDrilldownOpen(true); }
  }, [liveThemes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg"
        style={{ height: 500, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span className="text-sm text-muted-foreground animate-pulse">Loading bubble chart…</span>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(12px)" }}>
        <div className="h-[350px] md:h-[500px] w-full p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" dataKey="x" domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}>
                <Label value="Momentum Score →" position="bottom" offset={0}
                  style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }} />
              </XAxis>
              <YAxis type="number" dataKey="y" domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}>
                <Label value="↑ Breadth %" position="insideTopLeft" offset={10}
                  style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: DM_MONO }} />
              </YAxis>
              <ZAxis type="number" dataKey="z" range={[64, 1600]} />
              <ReferenceLine x={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.12)" strokeDasharray="6 4" />
              <RechartsTooltip content={<CustomTooltip tfLabel={tfLabel} />} cursor={false} />
              <Scatter data={data} isAnimationActive animationDuration={600}>
                {data.map(entry => (
                  <Cell key={entry.themeId} fill={getBubbleColor(entry.perfActive)} fillOpacity={0.75}
                    stroke={getBubbleColor(entry.perfActive)} strokeWidth={1}
                    style={{ cursor: "pointer" }} onClick={() => handleClick(entry)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Quadrant labels overlay — refined to be actionable, timeframe-aware */}
        <div className="relative -mt-[350px] md:-mt-[500px] h-[350px] md:h-[500px] pointer-events-none p-8">
          <div className="absolute top-8 right-12 text-[10px] text-[#00f5c4]/60 text-right" style={{ fontFamily: DM_MONO }}>
            Strong Momentum<br />+ Broad Participation
          </div>
          <div className="absolute top-8 left-12 text-[10px] text-muted-foreground/60" style={{ fontFamily: DM_MONO }}>
            Broad but Weak<br />(Rotating Out)
          </div>
          <div className="absolute bottom-12 right-12 text-[10px] text-[#facc15]/70 text-right" style={{ fontFamily: DM_MONO }}>
            Emerging Strength<br />(Thin Leaders)
          </div>
          <div className="absolute bottom-12 left-12 text-[10px] text-[#f5a623]/60" style={{ fontFamily: DM_MONO }}>
            Weakening / Exhausting<br />Momentum
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/40 uppercase tracking-widest" style={{ fontFamily: DM_MONO }}>
            {tfLabel} view
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[10px] text-muted-foreground px-1" style={{ fontFamily: DM_MONO }}>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#00f5c4" }} /> &gt;+2%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#4ade80" }} /> 0–+2%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#f5a623" }} /> -2–0%</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} /> &lt;-2%</span>
        <span className="opacity-60">|</span>
        <span>Bubble size = Rel Vol</span>
        <span className="opacity-60">|</span>
        <span>Color = {tfLabel} perf</span>
      </div>

      <ThemeDrilldownModal theme={drilldownTheme} open={drilldownOpen} onOpenChange={setDrilldownOpen} defaultSortKey="relVol" />
    </div>
  );
}
