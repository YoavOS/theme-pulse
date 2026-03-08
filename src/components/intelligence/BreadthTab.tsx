import { useState, useEffect, useMemo, useCallback } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  ReferenceArea,
} from "recharts";
import ThemeDrilldownModal from "@/components/ThemeDrilldownModal";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

function breadthColor(pct: number): string {
  if (pct >= 65) return "#00f5c4";
  if (pct >= 50) return "#4ade80";
  if (pct >= 35) return "#f5a623";
  return "#ef4444";
}

function breadthLabel(pct: number): string {
  if (pct >= 80) return "Extremely Broad — near-universal participation";
  if (pct >= 65) return "Strong Breadth — healthy market";
  if (pct >= 50) return "Moderate Breadth — mixed conditions";
  if (pct >= 35) return "Weak Breadth — selective market";
  return "Very Narrow — caution, few leaders";
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-4 ${className}`}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      {children}
    </div>
  );
}

// Section 1 — Hero gauge
function MarketBreadthGauge({ themes, isLoading }: { themes: ThemeIntelData[]; isLoading: boolean }) {
  const { totalAdvancing, totalTickers, score } = useMemo(() => {
    let adv = 0, total = 0;
    for (const t of themes) {
      adv += t.breadthUp;
      total += t.breadthTotal;
    }
    return { totalAdvancing: adv, totalTickers: total, score: total > 0 ? Math.round((adv / total) * 100) : 0 };
  }, [themes]);

  if (isLoading) {
    return (
      <GlassCard className="flex flex-col items-center py-8">
        <Skeleton className="h-40 w-40 rounded-full mb-4" />
        <Skeleton className="h-4 w-48" />
      </GlassCard>
    );
  }

  const gaugeData = [
    { name: "bg", value: 100, fill: "rgba(255,255,255,0.06)" },
    { name: "score", value: score, fill: breadthColor(score) },
  ];

  return (
    <GlassCard className="flex flex-col items-center py-6">
      <h3 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Overall Market Breadth
      </h3>
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            startAngle={180}
            endAngle={0}
            data={[gaugeData[1]]}
            barSize={14}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={8}
              background={{ fill: "rgba(255,255,255,0.06)" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
          <span
            className="text-4xl font-bold"
            style={{ fontFamily: DM_MONO, color: breadthColor(score) }}
          >
            {score}%
          </span>
        </div>
      </div>
      <p className="text-sm text-foreground font-['Syne',sans-serif] font-medium mt-1">
        {breadthLabel(score)}
      </p>
      <p className="text-xs text-muted-foreground mt-1" style={{ fontFamily: DM_MONO }}>
        {totalAdvancing} of {totalTickers} tickers advancing today
      </p>
    </GlassCard>
  );
}

// Section 2 — Bar chart
function BreadthByTheme({
  themes,
  isLoading,
  onThemeClick,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
  onThemeClick: (name: string) => void;
}) {
  const data = useMemo(() => {
    return themes
      .map(t => ({
        name: t.themeName.length > 16 ? t.themeName.slice(0, 14) + "…" : t.themeName,
        fullName: t.themeName,
        pct: t.breadthTotal > 0 ? Math.round((t.breadthUp / t.breadthTotal) * 100) : 0,
        advancing: t.breadthUp,
        total: t.breadthTotal,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [themes]);

  if (isLoading) {
    return (
      <GlassCard>
        <Skeleton className="h-72 w-full" />
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <h3 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Breadth by Theme
      </h3>
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: Math.max(600, data.length * 28), height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, bottom: 60, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                angle={-45}
                textAnchor="end"
                interval={0}
                height={60}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
              />
              <ReferenceLine y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="6 4" />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div
                      className="rounded-lg px-3 py-2 text-xs shadow-xl"
                      style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)" }}
                    >
                      <div className="font-['Syne',sans-serif] font-semibold text-foreground">{d.fullName}</div>
                      <div style={{ fontFamily: DM_MONO, color: breadthColor(d.pct) }}>
                        {d.pct}% advancing ({d.advancing}/{d.total} tickers)
                      </div>
                    </div>
                  );
                }}
                cursor={false}
              />
              <Bar
                dataKey="pct"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => onThemeClick(data.fullName)}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={breadthColor(d.pct)} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
}

// Need Cell import
import { Cell } from "recharts";

// Section 3 — Breadth history
function BreadthHistory() {
  const [timeframe, setTimeframe] = useState<"1W" | "2W" | "1M" | "All">("2W");
  const [historyData, setHistoryData] = useState<{ date: string; breadth: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const { data } = await supabase
          .from("theme_breadth_history")
          .select("date, breadth_pct")
          .order("date", { ascending: true });

        if (!data || data.length === 0) {
          setHistoryData([]);
          setIsLoading(false);
          return;
        }

        // Group by date → average breadth
        const byDate = new Map<string, number[]>();
        for (const row of data) {
          const arr = byDate.get(row.date) || [];
          arr.push(Number(row.breadth_pct));
          byDate.set(row.date, arr);
        }

        const all = Array.from(byDate.entries())
          .map(([date, vals]) => ({
            date,
            breadth: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        setHistoryData(all);
      } catch (err) {
        console.error("Breadth history fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (timeframe === "All") return historyData;
    const days = timeframe === "1W" ? 7 : timeframe === "2W" ? 14 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return historyData.filter(d => d.date >= cutoffStr);
  }, [historyData, timeframe]);

  if (isLoading) {
    return (
      <GlassCard>
        <Skeleton className="h-52 w-full" />
      </GlassCard>
    );
  }

  if (historyData.length < 3) {
    return (
      <GlassCard className="text-center py-8">
        <h3 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Breadth History
        </h3>
        <p className="text-sm text-muted-foreground">
          Breadth history builds automatically with each scan — {historyData.length} day{historyData.length !== 1 ? "s" : ""} recorded so far
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Breadth History
        </h3>
        <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-0.5">
          {(["1W", "2W", "1M", "All"] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                timeframe === tf
                  ? "bg-[rgba(255,255,255,0.08)] text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filtered} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={d => d.slice(5)}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
            />
            <ReferenceArea y1={65} y2={100} fill="#00f5c4" fillOpacity={0.04} />
            <ReferenceArea y1={0} y2={35} fill="#ef4444" fillOpacity={0.04} />
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div
                    className="rounded-lg px-3 py-2 text-xs shadow-xl"
                    style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    <div style={{ fontFamily: DM_MONO }}>{d.date}</div>
                    <div style={{ fontFamily: DM_MONO, color: breadthColor(d.breadth) }}>
                      Market Breadth: {d.breadth}%
                    </div>
                  </div>
                );
              }}
              cursor={false}
            />
            <Line
              type="monotone"
              dataKey="breadth"
              stroke="#00f5c4"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#00f5c4" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

// Section 4 — Leaders & Laggards
function BreadthLeadersLaggards({ themes, isLoading }: { themes: ThemeIntelData[]; isLoading: boolean }) {
  const { top5, bottom5 } = useMemo(() => {
    const sorted = [...themes]
      .map(t => ({
        ...t,
        breadthPct: t.breadthTotal > 0 ? Math.round((t.breadthUp / t.breadthTotal) * 100) : 0,
      }))
      .sort((a, b) => b.breadthPct - a.breadthPct);
    return { top5: sorted.slice(0, 5), bottom5: sorted.slice(-5).reverse() };
  }, [themes]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard><Skeleton className="h-40 w-full" /></GlassCard>
        <GlassCard><Skeleton className="h-40 w-full" /></GlassCard>
      </div>
    );
  }

  const renderColumn = (items: typeof top5, title: string, accent: string) => (
    <GlassCard>
      <h4
        className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest mb-3"
        style={{ color: accent }}
      >
        {title}
      </h4>
      <div className="space-y-2">
        {items.map((t, i) => (
          <div key={t.themeId} className="flex items-center gap-2">
            <span className="w-4 text-right text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-['Syne',sans-serif] text-[12px] font-medium text-foreground truncate">{t.themeName}</span>
                <div className="flex items-center gap-2 shrink-0" style={{ fontFamily: DM_MONO }}>
                  <span className="text-[11px]" style={{ color: breadthColor(t.breadthPct) }}>
                    {t.breadthPct}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">{t.breadthUp}/{t.breadthTotal}</span>
                  <span className={`text-[10px] ${t.perf_1d >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}>
                    {t.perf_1d >= 0 ? "+" : ""}{t.perf_1d.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {accent === "#ef4444" && bottom5.some(t => t.avgRelVol !== null && t.avgRelVol > 1.4 && t.breadthPct < 40) && (
          <p className="text-[10px] text-[#f5a623] mt-2" style={{ fontFamily: DM_MONO }}>
            ⚡ High vol + low breadth = distribution signal
          </p>
        )}
      </div>
    </GlassCard>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {renderColumn(top5, "Top 5 — Broadest Participation", "#00f5c4")}
      {renderColumn(bottom5, "Bottom 5 — Narrowest Participation", "#ef4444")}
    </div>
  );
}

// Section 5 — Breadth Alerts History
function BreadthAlertsHistory() {
  const [events, setEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        // We detect events by looking for large day-over-day changes
        const { data } = await supabase
          .from("theme_breadth_history")
          .select("theme_name, date, breadth_pct")
          .order("date", { ascending: false })
          .limit(5000);

        if (!data || data.length === 0) {
          setIsLoading(false);
          return;
        }

        // Group by theme → sorted dates
        const byTheme = new Map<string, { date: string; pct: number }[]>();
        for (const row of data) {
          const arr = byTheme.get(row.theme_name) || [];
          arr.push({ date: row.date, pct: Number(row.breadth_pct) });
          byTheme.set(row.theme_name, arr);
        }

        const detectedEvents: { date: string; themeName: string; type: "surge" | "collapse"; before: number; after: number }[] = [];

        for (const [theme, rows] of byTheme) {
          const sorted = rows.sort((a, b) => b.date.localeCompare(a.date));
          for (let i = 0; i < sorted.length - 1; i++) {
            const today = sorted[i];
            const yesterday = sorted[i + 1];
            const change = today.pct - yesterday.pct;
            if (Math.abs(change) >= 40) {
              detectedEvents.push({
                date: today.date,
                themeName: theme,
                type: change > 0 ? "surge" : "collapse",
                before: yesterday.pct,
                after: today.pct,
              });
            }
          }
        }

        detectedEvents.sort((a, b) => b.date.localeCompare(a.date));
        setEvents(detectedEvents.slice(0, 20));
      } catch (err) {
        console.error("Breadth events fetch error:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (isLoading) {
    return (
      <GlassCard>
        <Skeleton className="h-32 w-full" />
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <h3 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Breadth Alerts History
      </h3>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          No breadth events recorded yet — events appear here when a theme's breadth changes by 40%+ in a single day
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {events.map((e, i) => (
            <div
              key={`${e.date}-${e.themeName}-${i}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-20 shrink-0 text-muted-foreground" style={{ fontFamily: DM_MONO }}>{e.date.slice(5)}</span>
              <span className="truncate flex-1 font-['Syne',sans-serif] font-medium text-foreground">{e.themeName}</span>
              <span className={e.type === "surge" ? "text-[#00f5c4]" : "text-[#ef4444]"}>
                {e.type === "surge" ? "🔥 Surge" : "❄️ Collapse"}
              </span>
              <span className="w-24 text-right text-muted-foreground shrink-0" style={{ fontFamily: DM_MONO }}>
                {e.before}% → {e.after}%
              </span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

// Main tab
export default function BreadthTab({
  themes,
  isLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownTheme, setDrilldownTheme] = useState<any>(null);
  const { themes: liveThemes } = useLiveThemeData("Today");

  const handleThemeClick = useCallback((name: string) => {
    const theme = liveThemes.find(t => t.theme_name === name);
    if (theme) {
      setDrilldownTheme(theme);
      setDrilldownOpen(true);
    }
  }, [liveThemes]);

  return (
    <div className="space-y-4">
      <MarketBreadthGauge themes={themes} isLoading={isLoading} />
      <BreadthByTheme themes={themes} isLoading={isLoading} onThemeClick={handleThemeClick} />
      <BreadthHistory />
      <DispersionHistory />
      <BreadthLeadersLaggards themes={themes} isLoading={isLoading} />
      <BreadthAlertsHistory />
      <ThemeDrilldownModal
        theme={drilldownTheme}
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        defaultSortKey="relVol"
      />
    </div>
  );
}
