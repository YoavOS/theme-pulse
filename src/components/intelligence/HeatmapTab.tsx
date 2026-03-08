import { useMemo } from "react";
import { useEodChartData, EodRow } from "@/hooks/useEodChartData";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const DM_MONO = "'DM Mono', monospace";

interface DayData {
  date: string;
  avgPctChange: number;
  breadthPct: number;
  strengthScore: number;
  topTheme: { name: string; pct: number } | null;
  worstTheme: { name: string; pct: number } | null;
}

function strengthColor(score: number, hasData: boolean): string {
  if (!hasData) return "#111111";
  if (score > 2) return "#00f5c4";
  if (score > 0) return "rgba(0,245,196,0.35)";
  if (score > -0.5) return "#1a1a1a";
  if (score > -2) return "rgba(245,166,35,0.4)";
  return "#ff4444";
}

function formatDayLabel(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

export default function HeatmapTab() {
  const { data, isLoading, uniqueDates } = useEodChartData();

  const { dayMap, weeks, monthLabels, daysWithData } = useMemo(() => {
    // Build per-date data
    const byDate = new Map<string, EodRow[]>();
    for (const row of data) {
      const arr = byDate.get(row.date) || [];
      arr.push(row);
      byDate.set(row.date, arr);
    }

    const sorted = [...uniqueDates].sort();
    const dayMap = new Map<string, DayData>();

    for (let i = 0; i < sorted.length; i++) {
      const date = sorted[i];
      const rows = byDate.get(date) || [];
      const prevDate = i > 0 ? sorted[i - 1] : null;
      const prevRows = prevDate ? (byDate.get(prevDate) || []) : [];

      if (prevRows.length === 0) continue; // Can't compute % change without prior day

      // Build symbol->close maps
      const todayMap = new Map<string, { close: number; theme: string }>();
      for (const r of rows) todayMap.set(r.symbol, { close: r.close_price, theme: r.theme_name });
      const prevMap = new Map<string, number>();
      for (const r of prevRows) prevMap.set(r.symbol, r.close_price);

      // Per-symbol % change
      const changes: { symbol: string; theme: string; pct: number }[] = [];
      for (const [symbol, { close, theme }] of todayMap) {
        const prevClose = prevMap.get(symbol);
        if (prevClose && prevClose > 0) {
          changes.push({ symbol, theme, pct: ((close - prevClose) / prevClose) * 100 });
        }
      }

      if (changes.length === 0) continue;

      const avgPctChange = changes.reduce((s, c) => s + c.pct, 0) / changes.length;
      const advancing = changes.filter(c => c.pct > 0).length;
      const breadthPct = (advancing / changes.length) * 100;
      const strengthScore = avgPctChange * 0.6 + (breadthPct - 50) * 0.4;

      // Theme aggregates
      const themeAgg = new Map<string, { sum: number; count: number }>();
      for (const c of changes) {
        const agg = themeAgg.get(c.theme) || { sum: 0, count: 0 };
        agg.sum += c.pct;
        agg.count += 1;
        themeAgg.set(c.theme, agg);
      }
      const themeAvgs = [...themeAgg.entries()].map(([name, a]) => ({
        name,
        pct: a.sum / a.count,
      }));
      themeAvgs.sort((a, b) => b.pct - a.pct);

      dayMap.set(date, {
        date,
        avgPctChange,
        breadthPct,
        strengthScore,
        topTheme: themeAvgs.length > 0 ? themeAvgs[0] : null,
        worstTheme: themeAvgs.length > 0 ? themeAvgs[themeAvgs.length - 1] : null,
      });
    }

    // Build calendar grid for current year
    const year = new Date().getFullYear();
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    const firstMonday = getMonday(jan1);
    const weeks: string[][] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let current = new Date(firstMonday);
    let lastMonth = -1;

    while (current <= dec31 || weeks.length === 0) {
      const week: string[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = current.toISOString().split("T")[0];
        if (current.getFullYear() === year) {
          week.push(dateStr);
          if (current.getMonth() !== lastMonth) {
            monthLabels.push({
              label: current.toLocaleDateString("en-US", { month: "short" }),
              weekIndex: weeks.length,
            });
            lastMonth = current.getMonth();
          }
        } else {
          week.push("");
        }
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
      if (current > dec31 && current.getDay() === 1) break;
    }

    return { dayMap, weeks, monthLabels, daysWithData: dayMap.size };
  }, [data, uniqueDates]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }

  const DAY_LABELS = ["M", "", "W", "", "F", "", ""];
  const CELL = 14;
  const GAP = 2;

  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-foreground mb-1">
        Market Strength Calendar
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        {daysWithData} trading day{daysWithData !== 1 ? "s" : ""} captured · calendar fills automatically with each EOD save
      </p>

      <div className="overflow-x-auto">
        <div className="inline-flex flex-col" style={{ fontFamily: DM_MONO }}>
           {/* Month labels */}
           <div className="flex ml-[20px]" style={{ gap: GAP }}>
             {weeks.map((_, wi) => {
               const label = monthLabels.find(m => m.weekIndex === wi);
               return (
                 <div
                   key={wi}
                   style={{ width: CELL, fontSize: 10 }}
                   className="text-muted-foreground text-center shrink-0"
                 >
                   {label ? label.label : ""}
                 </div>
               );
             })}
           </div>

          {/* Grid */}
          <div className="flex">
             {/* Day labels */}
             <div className="flex flex-col mr-1" style={{ gap: GAP }}>
               {DAY_LABELS.map((l, i) => (
                 <div
                   key={i}
                   style={{ height: CELL, width: 16, fontSize: 10, lineHeight: `${CELL}px` }}
                   className="text-muted-foreground text-right"
                 >
                   {l}
                 </div>
               ))}
             </div>

            {/* Weeks */}
            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((dateStr, di) => {
                    if (!dateStr) {
                      return <div key={di} style={{ width: CELL, height: CELL }} />;
                    }
                    const dd = dayMap.get(dateStr);
                    const hasData = !!dd;
                    const color = strengthColor(dd?.strengthScore || 0, hasData);

                    return (
                      <Tooltip key={di}>
                        <TooltipTrigger asChild>
                          <div
                            style={{
                              width: CELL,
                              height: CELL,
                              borderRadius: 2,
                              background: color,
                              cursor: hasData ? "pointer" : "default",
                            }}
                          />
                        </TooltipTrigger>
                        {hasData && dd && (
                          <TooltipContent side="top" className="text-xs max-w-[220px]">
                            <div className="font-semibold mb-1">{formatDayLabel(dateStr)}</div>
                            <div>Avg performance: {dd.avgPctChange >= 0 ? "+" : ""}{dd.avgPctChange.toFixed(2)}%</div>
                            <div>Breadth: {Math.round(dd.breadthPct)}% advancing</div>
                            {dd.topTheme && (
                              <div className="text-[#00f5c4]">
                                Top: {dd.topTheme.name} {dd.topTheme.pct >= 0 ? "+" : ""}{dd.topTheme.pct.toFixed(1)}%
                              </div>
                            )}
                            {dd.worstTheme && (
                              <div className="text-[#f5a623]">
                                Worst: {dd.worstTheme.name} {dd.worstTheme.pct >= 0 ? "+" : ""}{dd.worstTheme.pct.toFixed(1)}%
                              </div>
                            )}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
        <span>Strong Down</span>
        {[
          "#ff4444",
          "rgba(245,166,35,0.4)",
          "#1a1a1a",
          "rgba(0,245,196,0.35)",
          "#00f5c4",
        ].map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
        ))}
        <span>Strong Up</span>
      </div>
    </div>
  );
}
