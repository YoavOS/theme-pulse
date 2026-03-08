import { useMemo } from "react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";

const DM_MONO = "'DM Mono', monospace";

interface BarDataPoint {
  name: string;
  shortName: string;
  perf: number;
  absPerf: number;
  breadthUp: number;
  breadthTotal: number;
  breadthPct: number;
  relVol: number | null;
  relVolEstimated: boolean;
  sustainedVol: number | null;
  fScore: number | null;
  stockType: string | null;
  rs: { text: string; color: string } | null;
  theme: ThemeData;
  isDimmed: boolean;
}

function BarRow({
  d,
  maxAbs,
  side,
  onClick,
}: {
  d: BarDataPoint;
  maxAbs: number;
  side: "left" | "right";
  onClick?: (theme: ThemeData) => void;
}) {
  const widthPct = maxAbs > 0 ? (d.absPerf / maxAbs) * 100 : 0;
  const sign = d.perf >= 0 ? "+" : "";
  const isPositive = side === "left";
  const barColor = isPositive ? "#00ff88" : "#ef4444";
  const glowColor = isPositive ? "rgba(0,255,136,0.15)" : "rgba(239,68,68,0.15)";

  return (
    <div
      className="group flex items-center cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.04)]"
      style={{ height: 25, opacity: d.isDimmed ? 0.3 : 1 }}
      onClick={() => onClick?.(d.theme)}
    >
      {isPositive ? (
        <>
          {/* Theme name — left side */}
          <div
            className="shrink-0 truncate text-[14px] text-[rgba(255,255,255,0.85)] pr-2 text-right"
            style={{ width: 130 }}
            title={d.name}
          >
            {d.shortName}
          </div>
          {/* Bar growing right */}
          <div className="flex-1 relative h-[18px] flex items-center">
            <div
              className="h-full rounded-r transition-all duration-400"
              style={{
                width: `${Math.max(widthPct, 1)}%`,
                background: barColor,
                opacity: 0.7,
                boxShadow: `0 0 8px ${glowColor}`,
                borderRadius: "0 4px 4px 0",
              }}
            />
            {/* Perf + breadth at bar end */}
            <div className="ml-1.5 flex items-baseline gap-1 shrink-0">
              <span
                className="text-xs font-medium"
                style={{ fontFamily: DM_MONO, color: barColor }}
              >
                {sign}{d.perf.toFixed(2)}%
              </span>
              <span
                className="text-[9px]"
                style={{ fontFamily: DM_MONO, color: "rgba(255,255,255,0.3)" }}
              >
                {d.breadthUp}/{d.breadthTotal}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Bar growing left + perf label */}
          <div className="flex-1 relative h-[18px] flex items-center justify-end">
            <div className="mr-1.5 flex items-baseline gap-1 shrink-0">
              <span
                className="text-[9px]"
                style={{ fontFamily: DM_MONO, color: "rgba(255,255,255,0.3)" }}
              >
                {d.breadthUp}/{d.breadthTotal}
              </span>
              <span
                className="text-xs font-medium"
                style={{ fontFamily: DM_MONO, color: barColor }}
              >
                {sign}{d.perf.toFixed(2)}%
              </span>
            </div>
            <div
              className="h-full transition-all duration-400"
              style={{
                width: `${Math.max(widthPct, 1)}%`,
                background: barColor,
                opacity: 0.7,
                boxShadow: `0 0 8px ${glowColor}`,
                borderRadius: "4px 0 0 4px",
              }}
            />
          </div>
          {/* Theme name — right side */}
          <div
            className="shrink-0 truncate text-[11px] text-[rgba(255,255,255,0.85)] pl-2 text-left"
            style={{ width: 130 }}
            title={d.name}
          >
            {d.shortName}
          </div>
        </>
      )}

      {/* Tooltip on hover */}
      <div
        className="pointer-events-none absolute z-50 rounded-lg px-3.5 py-3 text-xs shadow-xl opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: "rgba(10,10,15,0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          [isPositive ? "left" : "right"]: "50%",
          top: "100%",
          marginTop: 4,
          minWidth: 220,
        }}
      >
        <div className="font-['Syne',sans-serif] text-sm font-semibold text-foreground mb-1.5">{d.name}</div>
        <div className="border-t border-[rgba(255,255,255,0.08)] mb-1.5" />
        <div className="space-y-1 text-muted-foreground whitespace-nowrap" style={{ fontFamily: DM_MONO }}>
          <div className="flex justify-between gap-4">
            <span>1D:</span>
            <span>
              <span style={{ color: isPositive ? "#00ff88" : "#ef4444" }}>{sign}{d.perf.toFixed(2)}%</span>
              {d.rs && <span className={`ml-2 ${d.rs.color}`}>vs SPY: {d.rs.text}</span>}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Breadth:</span>
            <span>{d.breadthPct}% ({d.breadthUp}/{d.breadthTotal} advancing)</span>
          </div>
          {d.relVol != null && (
            <div className="flex justify-between gap-4">
              <span>Rel Vol:</span>
              <span style={{ color: d.relVolEstimated ? "rgba(255,255,255,0.4)" : undefined }}>
                ~{d.relVol.toFixed(1)}×{d.relVolEstimated ? " (estimated)" : ""}
              </span>
            </div>
          )}
          {d.sustainedVol != null && (
            <div className="flex justify-between gap-4">
              <span>Sustained Vol:</span>
              <span style={{
                color: d.sustainedVol > 15 ? "#00ff88" : d.sustainedVol > 5 ? "#f5a623" : "rgba(255,255,255,0.4)",
              }}>
                {d.sustainedVol >= 0 ? "+" : ""}{d.sustainedVol.toFixed(0)}%
              </span>
            </div>
          )}
          {(d.fScore != null || d.stockType) && (
            <div className="flex justify-between gap-4">
              <span>F:</span>
              <span>
                {d.fScore ?? "—"}
                {d.stockType && (
                  <span className="ml-1.5">
                    {d.stockType === "Growth" ? "🚀" : d.stockType === "Value" ? "💎" : d.stockType === "Blend" ? "⚖️" : "⚠️"} {d.stockType}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="border-t border-[rgba(255,255,255,0.08)] mt-1.5 pt-1.5">
          <span className="text-[9px] text-muted-foreground">Click to open full breakdown</span>
        </div>
      </div>
    </div>
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

  const { leftData, rightData, maxAbs } = useMemo(() => {
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
        absPerf: Math.abs(t.performance_pct),
        breadthUp: up,
        breadthTotal: total,
        breadthPct,
        relVol: signals?.relVol ?? null,
        relVolEstimated: signals?.relVolEstimated ?? false,
        sustainedVol: signals?.sustainedVol ?? null,
        fScore,
        stockType: null, // Could be enriched from fundamentals cache
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

    const leftPts = left.map(toPoint);
    const rightPts = right.map(toPoint); // mild losses at top, severe at bottom
    const all = [...leftPts, ...rightPts];
    const mx = all.length > 0 ? Math.max(...all.map(d => d.absPerf), 1) : 5;

    return { leftData: leftPts, rightData: rightPts, maxAbs: mx };
  }, [themes, getThemeSignals, getRelativeStrength, getThemeFundamentalScore, dimmedThemes]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
      {/* Left panel — Top Performers */}
      <div className="pr-0 md:pr-3 md:border-r md:border-[rgba(255,255,255,0.06)]">
        <h3
          className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: "#00f5c4" }}
        >
          Top Performers
        </h3>
        <div className="space-y-[3px]">
          {leftData.map((d) => (
            <BarRow key={d.name} d={d} maxAbs={maxAbs} side="left" onClick={onCardClick} />
          ))}
        </div>
      </div>

      {/* Right panel — Bottom Performers */}
      <div className="pl-0 md:pl-3 mt-4 md:mt-0">
        <h3
          className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-destructive"
        >
          Bottom Performers
        </h3>
        <div className="space-y-[3px]">
          {rightData.map((d) => (
            <BarRow key={d.name} d={d} maxAbs={maxAbs} side="right" onClick={onCardClick} />
          ))}
        </div>
      </div>
    </div>
  );
}
