import { useState, useMemo, useCallback } from "react";
import { useEodChartData, EodRow } from "@/hooks/useEodChartData";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

const PALETTE = [
  "#00f5c4", "#f5a623", "#6366f1", "#ec4899", "#14b8a6",
  "#f97316", "#8b5cf6", "#ef4444", "#22d3ee", "#84cc16",
  "#e879f9", "#facc15",
];

const TIMEFILTERS = ["1W", "2W", "1M", "All"] as const;
type TimeFilter = typeof TIMEFILTERS[number];

function filterDates(dates: string[], filter: TimeFilter): string[] {
  if (filter === "All" || dates.length === 0) return dates;
  const last = new Date(dates[dates.length - 1]);
  const days = filter === "1W" ? 7 : filter === "2W" ? 14 : 30;
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - days);
  return dates.filter(d => new Date(d) >= cutoff);
}

function formatDateShort(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

/** Pearson correlation coefficient */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function corrColor(v: number): string {
  if (v >= 0.5) return `rgba(0,245,196,${0.3 + v * 0.7})`;
  if (v >= 0) return `rgba(255,255,255,${v * 0.3})`;
  if (v >= -0.5) return `rgba(245,166,35,${Math.abs(v) * 0.5})`;
  return `rgba(255,68,68,${0.3 + Math.abs(v) * 0.7})`;
}

export default function TrendsTab() {
  const { data, isLoading, uniqueDates } = useEodChartData();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("All");
  const [hiddenThemes, setHiddenThemes] = useState<Set<string>>(new Set());

  // Build theme list and daily % changes
  const { themeNames, chartData, themeChanges } = useMemo(() => {
    if (data.length === 0 || uniqueDates.length < 1) {
      return { themeNames: [] as string[], chartData: [] as any[], themeChanges: new Map<string, number[]>() };
    }

    // Group by theme+date -> avg close
    const map = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const row of data) {
      if (!map.has(row.theme_name)) map.set(row.theme_name, new Map());
      const tm = map.get(row.theme_name)!;
      const existing = tm.get(row.date) || { sum: 0, count: 0 };
      existing.sum += row.close_price;
      existing.count += 1;
      tm.set(row.date, existing);
    }

    const names = [...map.keys()].sort();
    const dates = uniqueDates;

    // Compute daily avg % change per theme per date
    const themeChangesMap = new Map<string, number[]>();
    const chart: any[] = [];

    for (let i = 0; i < dates.length; i++) {
      const point: any = { date: dates[i], dateLabel: formatDateShort(dates[i]) };
      for (const name of names) {
        const tm = map.get(name)!;
        const today = tm.get(dates[i]);
        const yesterday = i > 0 ? tm.get(dates[i - 1]) : null;
        let pctChange = 0;
        if (today && yesterday && yesterday.sum > 0) {
          const avgToday = today.sum / today.count;
          const avgYesterday = yesterday.sum / yesterday.count;
          pctChange = ((avgToday - avgYesterday) / avgYesterday) * 100;
        }
        point[name] = Math.round(pctChange * 100) / 100;
        if (!themeChangesMap.has(name)) themeChangesMap.set(name, []);
        themeChangesMap.get(name)!.push(pctChange);
      }
      chart.push(point);
    }

    return { themeNames: names, chartData: chart, themeChanges: themeChangesMap };
  }, [data, uniqueDates]);

  const filteredDates = useMemo(() => filterDates(uniqueDates, timeFilter), [uniqueDates, timeFilter]);
  const filteredChart = useMemo(
    () => chartData.filter(p => filteredDates.includes(p.date)),
    [chartData, filteredDates]
  );

  const toggleTheme = useCallback((name: string) => {
    setHiddenThemes(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Correlation matrix
  const corrMatrix = useMemo(() => {
    if (themeNames.length < 2) return null;
    const matrix: (number | null)[][] = [];
    for (let i = 0; i < themeNames.length; i++) {
      const row: (number | null)[] = [];
      for (let j = 0; j < themeNames.length; j++) {
        if (i === j) {
          row.push(1);
        } else {
          const xs = themeChanges.get(themeNames[i]) || [];
          const ys = themeChanges.get(themeNames[j]) || [];
          const minLen = Math.min(xs.length, ys.length);
          row.push(pearson(xs.slice(0, minLen), ys.slice(0, minLen)));
        }
      }
      matrix.push(row);
    }
    return matrix;
  }, [themeNames, themeChanges]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  const noData = uniqueDates.length === 0;
  const lowData = uniqueDates.length < 7;

  return (
    <div className="space-y-6">
      {/* ── AREA CHART ── */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
            Theme Momentum Over Time
          </h3>
          <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-1">
            {TIMEFILTERS.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeFilter(tf)}
                className={`relative rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  timeFilter === tf
                    ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tf}
                {timeFilter === tf && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-4 rounded-full bg-[#00f5c4]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {lowData && !noData && (
          <p className="mb-2 text-xs text-muted-foreground">
            Chart will improve as more EOD data accumulates — {uniqueDates.length} day{uniqueDates.length !== 1 ? "s" : ""} saved so far
          </p>
        )}

        {noData ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No EOD data yet — run a scan and save EOD to start building history
          </div>
        ) : filteredChart.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No data for this range yet
          </div>
        ) : filteredChart.length === 1 ? (
          <div className="flex h-[250px] flex-col items-center justify-center text-sm text-muted-foreground">
            <span>Building history...</span>
            <span className="text-xs mt-1">1 data point — chart draws after 2+ EOD saves</span>
          </div>
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: "hsl(215,15%,55%)", fontSize: 10, fontFamily: DM_MONO }}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(215,15%,55%)", fontSize: 10, fontFamily: DM_MONO }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `${v}%`}
                  width={40}
                />
                <RTooltip
                  contentStyle={{
                    background: "hsl(220,18%,13%)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                    fontFamily: DM_MONO,
                  }}
                  labelStyle={{ color: "hsl(210,20%,95%)", fontFamily: "'Syne',sans-serif", fontWeight: 600 }}
                  itemSorter={(a: any) => -(a.value || 0)}
                  formatter={(value: number) => [`${value.toFixed(2)}%`]}
                />
                <Legend
                  onClick={(e: any) => toggleTheme(e.value)}
                  wrapperStyle={{ fontSize: 10, fontFamily: DM_MONO, cursor: "pointer" }}
                />
                {themeNames.map((name, i) => (
                  <Area
                    key={name}
                    type="monotoneX"
                    dataKey={name}
                    stroke={PALETTE[i % PALETTE.length]}
                    fill={PALETTE[i % PALETTE.length]}
                    fillOpacity={hiddenThemes.has(name) ? 0 : 0.08}
                    strokeOpacity={hiddenThemes.has(name) ? 0.15 : 1}
                    strokeWidth={hiddenThemes.has(name) ? 0.5 : 1.5}
                    hide={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── CORRELATION MATRIX ── */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
            Theme Correlation Matrix
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={12} className="text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px] text-xs">
              Based on daily % change correlation from EOD price data
            </TooltipContent>
          </Tooltip>
        </div>

        {uniqueDates.length < 5 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Correlation matrix available after 5 EOD saves
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              {uniqueDates.length} / 5 complete
            </p>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
              <div
                className="h-full rounded-full bg-[#00f5c4] transition-all"
                style={{ width: `${(uniqueDates.length / 5) * 100}%` }}
              />
            </div>
          </div>
        ) : corrMatrix && themeNames.length > 0 ? (
          <>
            <div className="overflow-auto max-h-[400px]">
              <table className="text-[10px]" style={{ fontFamily: DM_MONO }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-background px-2 py-1" />
                    {themeNames.map(name => (
                      <th
                        key={name}
                        className="sticky top-0 z-10 bg-background px-1.5 py-1 text-muted-foreground font-normal max-w-[80px] truncate"
                        title={name}
                      >
                        {name.length > 10 ? name.slice(0, 10) + "…" : name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {themeNames.map((rowName, ri) => (
                    <tr key={rowName}>
                      <td
                        className="sticky left-0 z-10 bg-background px-2 py-1 text-muted-foreground font-normal max-w-[100px] truncate"
                        title={rowName}
                      >
                        {rowName.length > 12 ? rowName.slice(0, 12) + "…" : rowName}
                      </td>
                      {corrMatrix[ri].map((val, ci) => (
                        <td key={ci} className="px-1.5 py-1 text-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-block w-10 rounded px-1 py-0.5 cursor-help"
                                style={{ background: val !== null ? corrColor(val) : "transparent" }}
                              >
                                {val !== null ? val.toFixed(2) : "?"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[240px]">
                              {val !== null
                                ? `${rowName} vs ${themeNames[ci]}: ${val.toFixed(2)} correlation — ${
                                    val > 0.6
                                      ? "moves together strongly"
                                      : val > 0.3
                                      ? "moderate positive correlation"
                                      : val > -0.3
                                      ? "weak or no correlation"
                                      : val > -0.6
                                      ? "moderate inverse correlation"
                                      : "moves inversely"
                                  }`
                                : `Need more EOD history`}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground text-center">
              Red = inverse · White = uncorrelated · Teal = moves together
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            Need at least 2 themes with EOD data to show correlations
          </p>
        )}
      </div>
    </div>
  );
}
