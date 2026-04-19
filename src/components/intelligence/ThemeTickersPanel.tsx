import { useMemo } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import type { SmartVolumeMetrics } from "@/hooks/useSmartVolumeMetrics";
import type { Timeframe } from "@/hooks/useTimeframeAvailability";

const DM_MONO = "'DM Mono', monospace";

interface Props {
  theme: ThemeIntelData;
  compact?: boolean;
  /** When provided, ticker rows display per-symbol smart volume columns. */
  smartVolumeData?: Record<string, SmartVolumeMetrics>;
  smartVolumePeriod?: Timeframe;
}

function perfClass(v: number): string {
  return v > 0 ? "text-[#00f5c4]" : v < 0 ? "text-[#f5a623]" : "text-muted-foreground";
}

function fmt(v: number | null | undefined, suffix = "%"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}${suffix}`;
}

function relVolColor(v: number | null): string {
  if (v === null) return "var(--muted-foreground)";
  if (v > 1.8) return "#00f5c4";
  if (v > 1.4) return "#4ade80";
  if (v >= 1.1) return "#facc15";
  if (v < 0.9) return "#f87171";
  return "currentColor";
}
function trendColor(v: number | null): string {
  if (v === null) return "var(--muted-foreground)";
  if (v > 25) return "#00f5c4";
  if (v > 5) return "#4ade80";
  if (v < -10) return "#f87171";
  return "currentColor";
}
function consistencyColor(v: number | null): string {
  if (v === null) return "var(--muted-foreground)";
  if (v >= 70) return "#00f5c4";
  if (v >= 50) return "#4ade80";
  if (v < 30) return "#f87171";
  return "currentColor";
}
function sustainedColor(v: number | null): string {
  if (v === null) return "var(--muted-foreground)";
  if (v >= 1.2) return "#00f5c4";
  if (v >= 1.05) return "#4ade80";
  if (v < 0.9) return "#f87171";
  return "currentColor";
}

export default function ThemeTickersPanel({ theme, compact = false, smartVolumeData, smartVolumePeriod }: Props) {
  const { spy } = useSpyBenchmark();
  const showVolume = !!smartVolumeData;

  const rows = useMemo(() => {
    const done = theme.tickers
      .filter(tk => tk.status === "done")
      .sort((a, b) => b.perf_1d - a.perf_1d);
    const others = theme.tickers.filter(tk => tk.status !== "done");
    return [...done, ...others];
  }, [theme.tickers]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md py-3 px-3 text-center text-[11px] text-muted-foreground"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        No ticker performance data available for this theme yet.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md"
      style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="max-h-[480px] overflow-auto">
        <div className="px-2.5 py-1 text-[10px] text-muted-foreground border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]" style={{ fontFamily: DM_MONO }}>
          {rows.length} ticker{rows.length === 1 ? "" : "s"}
          {showVolume && smartVolumePeriod && (
            <span className="ml-2 opacity-70">· volume metrics: {smartVolumePeriod === "today" ? "Today" : smartVolumePeriod}</span>
          )}
        </div>
        <table className="w-full text-[11px]" style={{ fontFamily: DM_MONO }}>
          <thead className="sticky top-0 z-10" style={{ background: "rgba(15,18,25,0.95)" }}>
            <tr className="text-[10px] text-muted-foreground border-b border-[rgba(255,255,255,0.06)]">
              <th className="px-2.5 py-1.5 text-left font-medium">Ticker</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Price</th>
              <th className="px-2.5 py-1.5 text-right font-medium">1D</th>
              <th className="px-2.5 py-1.5 text-right font-medium">vs SPY</th>
              {!compact && !showVolume && <th className="px-2.5 py-1.5 text-right font-medium">1W</th>}
              {!compact && !showVolume && <th className="px-2.5 py-1.5 text-right font-medium">1M</th>}
              {!compact && !showVolume && <th className="px-2.5 py-1.5 text-right font-medium">3M</th>}
              {!compact && !showVolume && <th className="px-2.5 py-1.5 text-right font-medium">YTD</th>}
              {showVolume && <th className="px-2.5 py-1.5 text-right font-medium" title="Today's vol vs avg for the selected period">Rel Vol</th>}
              {showVolume && <th className="px-2.5 py-1.5 text-right font-medium" title="% change in avg daily volume across the selected period">Vol Trend</th>}
              {showVolume && <th className="px-2.5 py-1.5 text-right font-medium" title="% of days in window above 60d average">Consist.</th>}
              {showVolume && <th className="px-2.5 py-1.5 text-right font-medium" title="(10d/30d) × (20d/60d) — >1.2 = strong sustained demand">Sustained</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(tk => {
              const isDone = tk.status === "done";
              const rs = isDone && spy.perf_1d !== null
                ? Math.round((tk.perf_1d - spy.perf_1d) * 100) / 100
                : null;
              const vol = showVolume ? smartVolumeData?.[tk.symbol] : undefined;
              return (
                <tr
                  key={tk.symbol}
                  className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] ${isDone ? "" : "opacity-60"}`}
                >
                  <td className="px-2.5 py-1.5 font-semibold text-foreground">
                    {tk.symbol}
                    {!isDone && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">{tk.status}</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                    {tk.price > 0 ? `$${tk.price.toFixed(2)}` : "--"}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1d) : "text-muted-foreground"}`}>
                    {isDone ? fmt(tk.perf_1d) : "--"}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right ${rs === null ? "text-muted-foreground" : perfClass(rs)}`}>
                    {rs === null ? "--" : fmt(rs)}
                  </td>
                  {!compact && !showVolume && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1w) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_1w) : "--"}</td>}
                  {!compact && !showVolume && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1m) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_1m) : "--"}</td>}
                  {!compact && !showVolume && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_3m) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_3m) : "--"}</td>}
                  {!compact && !showVolume && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_ytd) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_ytd) : "--"}</td>}
                  {showVolume && (
                    <>
                      <td className="px-2.5 py-1.5 text-right" style={{ color: relVolColor(vol?.rel_vol ?? null) }}>
                        {vol?.rel_vol != null ? `${vol.rel_vol.toFixed(2)}×` : "--"}
                      </td>
                      <td className="px-2.5 py-1.5 text-right" style={{ color: trendColor(vol?.vol_trend_pct ?? null) }}>
                        {vol?.vol_trend_pct != null ? `${vol.vol_trend_pct > 0 ? "+" : ""}${vol.vol_trend_pct.toFixed(1)}%` : "--"}
                      </td>
                      <td className="px-2.5 py-1.5 text-right" style={{ color: consistencyColor(vol?.vol_consistency ?? null) }}>
                        {vol?.vol_consistency != null ? `${vol.vol_consistency}%` : "--"}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-bold" style={{ color: sustainedColor(vol?.sustained_score ?? null) }}>
                        {vol?.sustained_score != null ? vol.sustained_score.toFixed(2) : "--"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
