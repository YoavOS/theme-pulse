import { useState, useMemo, useCallback } from "react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";

const DM_MONO = "'DM Mono', monospace";

interface BarDataPoint {
  name: string;
  shortName: string;
  perf: number;
  breadthUp: number;
  breadthTotal: number;
  breadthPct: number;
  relVol: number | null;
  fScore: number | null;
  rs: { text: string; color: string } | null;
  theme: ThemeData;
  isDimmed: boolean;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as BarDataPoint;
  const sign = d.perf >= 0 ? "+" : "";
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-xs shadow-xl"
      style={{
        background: "rgba(10,10,15,0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="font-['Syne',sans-serif] text-sm font-semibold text-foreground mb-1.5">{d.name}</div>
      <div className="space-y-0.5 text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        <div>
          1D: <span className={d.perf >= 0 ? "text-[#00ff88]" : "text-[#ef4444]"}>
            {sign}{d.perf.toFixed(2)}%
          </span>
          {d.rs && (
            <span className={`ml-2 ${d.rs.color}`}>vs SPY: {d.rs.text}</span>
          )}
        </div>
        <div>
          Breadth: {d.breadthPct}% ({d.breadthUp}/{d.breadthTotal} advancing)
        </div>
        <div>
          {d.relVol != null ? `Rel Vol: ~${d.relVol.toFixed(1)}×` : "Rel Vol: N/A"}
          {d.fScore != null ? `  F:${d.fScore}` : ""}
        </div>
      </div>
    </div>
  );
}

function BarLabel({ x, y, width, height, value, payload }: any) {
  if (!payload) return null;
  const d = payload as BarDataPoint;
  const sign = d.perf >= 0 ? "+" : "";
  const isPositive = d.perf >= 0;

  return (
    <g>
      {/* Theme name */}
      <text
        x={isPositive ? (x || 0) + 4 : (x || 0) + (width || 0) - 4}
        y={(y || 0) + (height || 0) / 2}
        dy={-1}
        textAnchor={isPositive ? "start" : "end"}
        fill="rgba(255,255,255,0.85)"
        fontSize={11}
        fontFamily="inherit"
      >
        {d.shortName}
      </text>
      {/* Perf + breadth */}
      <text
        x={isPositive ? (x || 0) + (width || 0) + 6 : (x || 0) - 6}
        y={(y || 0) + (height || 0) / 2 + 1}
        textAnchor={isPositive ? "start" : "end"}
        fill={isPositive ? "#00ff88" : "#ef4444"}
        fontSize={12}
        fontFamily={DM_MONO}
      >
        {sign}{d.perf.toFixed(2)}%
      </text>
      <text
        x={isPositive ? (x || 0) + (width || 0) + 6 + (sign + d.perf.toFixed(2) + "%").length * 7.5 + 4 : (x || 0) - 6 - (sign + d.perf.toFixed(2) + "%").length * 7.5 - 4}
        y={(y || 0) + (height || 0) / 2 + 1}
        textAnchor={isPositive ? "start" : "end"}
        fill="rgba(255,255,255,0.3)"
        fontSize={9}
        fontFamily={DM_MONO}
      >
        · {d.breadthUp}/{d.breadthTotal}
      </text>
    </g>
  );
}

export default function BarChartView({
  themes,
  onCardClick,
  getThemeSignals,
  dimmedThemes,
  getThemeFundamentalScore,
}: {
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  dimmedThemes?: Set<string> | null;
  getThemeFundamentalScore?: (symbols: string[]) => number | null;
}) {
  const { getRelativeStrength } = useSpyBenchmark();

  const { leftData, rightData } = useMemo(() => {
    const sorted = [...themes].sort((a, b) => b.performance_pct - a.performance_pct);

    const toPoint = (t: ThemeData): BarDataPoint => {
      const valid = t.tickers.filter(tk => !tk.skipped);
      const total = valid.length;
      const up = valid.filter(tk => tk.pct > 0).length;
      const breadthPct = total > 0 ? Math.round((up / total) * 100) : 0;
      const symbols = t.tickers.map(tk => tk.symbol);
      const signals = getThemeSignals ? getThemeSignals(symbols) : null;
      const rs = getRelativeStrength(t.performance_pct);
      const rsF = rs !== null ? formatRS(rs) : null;
      const fScore = getThemeFundamentalScore ? getThemeFundamentalScore(valid.map(tk => tk.symbol)) : null;
      const isDimmed = dimmedThemes ? !dimmedThemes.has(t.theme_name.toLowerCase()) : false;
      const shortName = t.theme_name.length > 20 ? t.theme_name.slice(0, 18) + "…" : t.theme_name;

      return {
        name: t.theme_name,
        shortName,
        perf: t.performance_pct,
        breadthUp: up,
        breadthTotal: total,
        breadthPct,
        relVol: signals?.relVol ?? null,
        fScore,
        rs: rsF,
        theme: t,
        isDimmed,
      };
    };

    const positive = sorted.filter(t => t.performance_pct >= 0);
    const negative = sorted.filter(t => t.performance_pct < 0);

    let left: ThemeData[], right: ThemeData[];
    if (negative.length === 0) {
      const mid = Math.ceil(sorted.length / 2);
      left = sorted.slice(0, mid);
      right = sorted.slice(mid);
    } else {
      left = positive;
      right = negative;
    }

    return {
      leftData: left.map(toPoint),
      rightData: [...right].reverse().map(toPoint), // worst at bottom
    };
  }, [themes, getThemeSignals, getRelativeStrength, getThemeFundamentalScore, dimmedThemes]);

  const maxAbs = useMemo(() => {
    const all = [...leftData, ...rightData];
    if (all.length === 0) return 5;
    return Math.max(Math.abs(Math.max(...all.map(d => d.perf))), Math.abs(Math.min(...all.map(d => d.perf))), 1);
  }, [leftData, rightData]);

  const barHeight = 22;
  const barGap = 3;

  const chartHeight = (data: BarDataPoint[]) => Math.max(200, data.length * (barHeight + barGap) + 60);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
      {/* Left panel — Top Performers */}
      <div className="pr-0 md:pr-2 md:border-r md:border-[rgba(255,255,255,0.06)]">
        <h3
          className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: "#00f5c4" }}
        >
          Top Performers
        </h3>
        <div style={{ height: chartHeight(leftData) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={leftData}
              layout="vertical"
              margin={{ top: 5, right: 80, bottom: 5, left: 5 }}
              barSize={barHeight}
              barGap={barGap}
            >
              <CartesianGrid
                horizontal
                vertical={false}
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis
                type="number"
                domain={[0, maxAbs * 1.15]}
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)", fontFamily: DM_MONO }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
              />
              <YAxis type="category" dataKey="shortName" hide />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar
                dataKey="perf"
                isAnimationActive
                animationDuration={400}
                animationBegin={0}
                radius={[0, 4, 4, 0]}
                label={<BarLabel />}
                onClick={(_: any, index: number) => {
                  if (leftData[index]) onCardClick?.(leftData[index].theme);
                }}
                style={{ cursor: "pointer" }}
              >
                {leftData.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill="#00ff88"
                    fillOpacity={entry.isDimmed ? 0.1 : 0.7}
                    stroke="none"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Right panel — Bottom Performers */}
      <div className="pl-0 md:pl-2 mt-4 md:mt-0">
        <h3
          className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-destructive"
        >
          Bottom Performers
        </h3>
        <div style={{ height: chartHeight(rightData) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rightData}
              layout="vertical"
              margin={{ top: 5, right: 5, bottom: 5, left: 80 }}
              barSize={barHeight}
              barGap={barGap}
            >
              <CartesianGrid
                horizontal
                vertical={false}
                stroke="rgba(255,255,255,0.05)"
              />
              <XAxis
                type="number"
                domain={[-(maxAbs * 1.15), 0]}
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)", fontFamily: DM_MONO }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                reversed
              />
              <YAxis type="category" dataKey="shortName" hide />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar
                dataKey="perf"
                isAnimationActive
                animationDuration={400}
                animationBegin={0}
                radius={[4, 0, 0, 4]}
                label={<BarLabel />}
                onClick={(_: any, index: number) => {
                  if (rightData[index]) onCardClick?.(rightData[index].theme);
                }}
                style={{ cursor: "pointer" }}
              >
                {rightData.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill="#ef4444"
                    fillOpacity={entry.isDimmed ? 0.1 : 0.7}
                    stroke="none"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
