import { useEffect, useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  Tooltip as ReTooltip, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSmartVolumeMetrics, type SmartVolumeMetrics } from "@/hooks/useSmartVolumeMetrics";
import type { Timeframe } from "@/hooks/useTimeframeAvailability";
import { Activity, BarChart3, Layers, TrendingUp, Users } from "lucide-react";
import { VolumeHeatBadge, classifyVolumeHeat } from "./VolumeVisuals";

const DM_MONO = "'DM Mono', monospace";
const SYNE = "'Syne', sans-serif";

type ChartTf = "1W" | "1M" | "3M" | "6M";
const TF_TO_PERIOD: Record<ChartTf, string> = { "1W": "5d", "1M": "1mo", "3M": "3mo", "6M": "6mo" };
// Smart-volume metrics support today/1W/1M/3M; map 6M → 3M for the metric cards.
const TF_TO_METRIC_TF: Record<ChartTf, Timeframe> = { "1W": "1W", "1M": "1M", "3M": "3M", "6M": "3M" };

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface OHLC { ts: number; open?: number; high?: number; low?: number; close: number; volume?: number }

interface HistRow { symbol: string; ohlc?: OHLC[]; error?: string }

/** Convert unix seconds to YYYY-MM-DD (UTC) for stable date keys. */
function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

interface ChartPoint {
  date: string;
  themeRet: number | null;
  spyRet: number | null;
  volume: number | null;
}

function fmtPct(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}

function perfColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "hsl(var(--muted-foreground))";
  if (v > 0) return "#00f5c4";
  if (v < 0) return "#f87171";
  return "hsl(var(--muted-foreground))";
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  theme: ThemeIntelData | null;
  smartVolumeData?: Record<string, SmartVolumeMetrics>;
}

export default function ThemeVolumeDashboard({ open, onOpenChange, theme, smartVolumeData }: Props) {
  const [tf, setTf] = useState<ChartTf>("1M");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [spyHistory, setSpyHistory] = useState<OHLC[] | null>(null);
  const [rsMap, setRsMap] = useState<Record<string, number>>({});

  // Per-panel smart volume metrics tied to the panel's own tf selector.
  const localSmart = useSmartVolumeMetrics(TF_TO_METRIC_TF[tf]);
  useEffect(() => {
    if (open && theme && theme.symbols.length > 0) {
      localSmart.fetchMetrics(theme.symbols);
    }
  }, [open, theme?.themeId, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on theme change
  useEffect(() => { if (theme) { setHistory([]); setSpyHistory(null); } }, [theme?.themeId]);

  // Load historical data for theme symbols + SPY
  useEffect(() => {
    if (!open || !theme) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const period = TF_TO_PERIOD[tf];
        const symbols = theme.symbols.slice(0, 30); // safety cap
        const [themeRes, spyRes] = await Promise.all([
          fetch(`${supabaseUrl}/functions/v1/get-historical-data`, {
            method: "POST",
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ symbols, period }),
          }).then(r => r.json()),
          fetch(`${supabaseUrl}/functions/v1/get-historical-data?symbol=SPY&period=${period}`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          }).then(r => r.json()),
        ]);
        if (cancelled) return;
        // Edge function POST returns { results: { SYMBOL: { ohlc: [...] } } }
        const resultsObj = themeRes?.results ?? {};
        const rows: HistRow[] = Object.entries(resultsObj).map(([symbol, v]) => {
          const r = v as { ohlc?: OHLC[]; error?: string };
          return { symbol, ohlc: r.ohlc, error: r.error };
        });
        setHistory(rows);
        setSpyHistory(Array.isArray(spyRes?.ohlc) ? spyRes.ohlc : null);
      } catch (e) {
        console.error("ThemeVolumeDashboard hist fetch error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, theme?.themeId, tf]);

  // Load RS ratings for the theme tickers
  useEffect(() => {
    if (!open || !theme) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("qualified_rs_universe")
        .select("symbol, rs_overall")
        .in("symbol", theme.symbols);
      if (cancelled || !data) return;
      const map: Record<string, number> = {};
      data.forEach(r => { if (r.rs_overall != null) map[r.symbol] = Number(r.rs_overall); });
      setRsMap(map);
    })();
    return () => { cancelled = true; };
  }, [open, theme?.themeId]);

  const chartData: ChartPoint[] = useMemo(() => {
    if (!theme || history.length === 0) return [];
    // Build aligned date series across all theme symbols (intersection by date string).
    // Theme return = average of per-symbol % returns indexed to first available close.
    const validRows = history.filter(h => Array.isArray(h.ohlc) && h.ohlc.length > 1) as Required<HistRow>[];
    if (validRows.length === 0) return [];

    // Use the date set from the longest series as the canonical timeline.
    const longest = validRows.reduce((a, b) => (b.ohlc.length > a.ohlc.length ? b : a));
    const dates = longest.ohlc.map(p => tsToDate(p.ts));

    // Build per-symbol close maps (date → close) and base close (first non-null).
    const symbolMaps = validRows.map(r => {
      const m = new Map<string, number>();
      r.ohlc.forEach(p => { if (p.close > 0) m.set(tsToDate(p.ts), p.close); });
      const base = r.ohlc.find(p => p.close > 0)?.close ?? null;
      return { symbol: r.symbol, m, base };
    });

    const spyMap = new Map<string, number>();
    let spyBase: number | null = null;
    if (spyHistory) {
      spyHistory.forEach(p => { if (p.close > 0) spyMap.set(tsToDate(p.ts), p.close); });
      spyBase = spyHistory.find(p => p.close > 0)?.close ?? null;
    }

    // Aggregate volume per date across all theme tickers.
    const volByDate = new Map<string, number>();
    validRows.forEach(r => {
      r.ohlc.forEach(p => {
        const d = tsToDate(p.ts);
        if (p.volume != null) volByDate.set(d, (volByDate.get(d) ?? 0) + p.volume);
      });
    });

    return dates.map((d): ChartPoint => {
      const rets: number[] = [];
      symbolMaps.forEach(({ m, base }) => {
        const c = m.get(d);
        if (c != null && base != null && base > 0) rets.push(((c - base) / base) * 100);
      });
      const themeRet = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
      const spyClose = spyMap.get(d);
      const spyRet = (spyClose != null && spyBase != null && spyBase > 0) ? ((spyClose - spyBase) / spyBase) * 100 : null;
      return {
        date: d,
        themeRet: themeRet != null ? Math.round(themeRet * 100) / 100 : null,
        spyRet: spyRet != null ? Math.round(spyRet * 100) / 100 : null,
        volume: volByDate.get(d) ?? null,
      };
    });
  }, [theme, history, spyHistory]);

  // Theme-level metrics from the panel-local hook (period-aware via tf).
  // Falls back to the parent-supplied snapshot only if the local hook hasn't loaded yet.
  const volSource: Record<string, SmartVolumeMetrics> = useMemo(() => {
    if (Object.keys(localSmart.data).length > 0) return localSmart.data;
    return smartVolumeData ?? {};
  }, [localSmart.data, smartVolumeData]);

  const aggregate = useMemo(() => {
    if (!theme) return null;
    const rows = theme.symbols.map(s => volSource[s]).filter(Boolean).filter(r => !r.error);
    if (rows.length === 0) return null;
    const avg = (xs: (number | null | undefined)[]) => {
      const v = xs.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
      return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
    };
    return {
      relVol: avg(rows.map(r => r.rel_vol)),
      sustained: avg(rows.map(r => r.sustained_score)),
      consistency: avg(rows.map(r => r.vol_consistency)),
      trendPct: avg(rows.map(r => r.vol_trend_pct)),
    };
  }, [theme, volSource]);

  const top3 = useMemo(() => {
    if (!theme) return [];
    return [...theme.tickers]
      .filter(t => t.status === "done")
      .map(t => ({ ...t, rs: rsMap[t.symbol] ?? null }))
      .sort((a, b) => {
        const ar = a.rs ?? -Infinity, br = b.rs ?? -Infinity;
        if (ar !== br) return br - ar;
        return b.perf_1m - a.perf_1m;
      })
      .slice(0, 3);
  }, [theme, rsMap]);

  const tickerRows = useMemo(() => {
    if (!theme) return [];
    return [...theme.tickers]
      .map(t => ({ ...t, rs: rsMap[t.symbol] ?? null, vol: volSource[t.symbol] }))
      .sort((a, b) => {
        const av = a.status === "done" ? 0 : 1;
        const bv = b.status === "done" ? 0 : 1;
        if (av !== bv) return av - bv;
        return (b.rs ?? -Infinity) - (a.rs ?? -Infinity);
      });
  }, [theme, rsMap, volSource]);

  const heat = aggregate
    ? classifyVolumeHeat(aggregate.relVol, aggregate.trendPct, aggregate.sustained)
    : "neutral";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="z-[80] p-0 border-l border-[rgba(255,255,255,0.08)] flex flex-col gap-0 w-full sm:max-w-[720px]"
        style={{ width: "min(720px, 96vw)", maxWidth: "none", background: "linear-gradient(180deg, #0b0e12 0%, #11151c 100%)" }}
      >
        {theme && (
          <>
            <SheetHeader className="px-5 pt-5 pb-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <SheetTitle
                    className="text-[18px] font-bold text-foreground truncate"
                    style={{ fontFamily: SYNE }}
                  >
                    {theme.themeName}
                  </SheetTitle>
                  <SheetDescription className="text-[11px] text-muted-foreground mt-0.5" style={{ fontFamily: DM_MONO }}>
                    {theme.symbols.length} tickers · {tf} window
                  </SheetDescription>
                </div>
                <VolumeHeatBadge heat={heat} />
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Timeframe selector */}
              <div className="flex items-center gap-1.5">
                {(["1W", "1M", "3M", "6M"] as ChartTf[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTf(t)}
                    className={`px-3 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                      tf === t
                        ? "bg-[#00f5c4] text-[#022c1f]"
                        : "bg-[rgba(255,255,255,0.04)] text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.08)]"
                    }`}
                    style={{ fontFamily: DM_MONO }}
                  >
                    {t}
                  </button>
                ))}
                {loading && <span className="ml-2 text-[10.5px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>loading…</span>}
              </div>

              {/* Combined chart */}
              <div
                className="rounded-lg p-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-[10.5px] uppercase tracking-widest text-muted-foreground mb-1" style={{ fontFamily: DM_MONO }}>
                  Theme vs SPY · Volume
                </div>
                {chartData.length > 1 ? (
                  <div style={{ width: "100%", height: 240 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "DM Mono" }}
                          tickLine={false}
                          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                          minTickGap={28}
                          tickFormatter={(d: string) => d.slice(5)}
                        />
                        <YAxis
                          yAxisId="ret"
                          orientation="left"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "DM Mono" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                          width={42}
                        />
                        <YAxis
                          yAxisId="vol"
                          orientation="right"
                          tick={{ fill: "rgba(148,163,184,0.6)", fontSize: 9, fontFamily: "DM Mono" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}K`}
                          width={42}
                        />
                        <ReTooltip
                          cursor={{ stroke: "rgba(0,245,196,0.25)", strokeWidth: 1 }}
                          contentStyle={{
                            background: "rgba(11,14,18,0.96)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 8,
                            fontSize: 11,
                            fontFamily: "DM Mono",
                          }}
                          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                          formatter={(v: number | null, name: string) => {
                            if (v == null) return ["—", name];
                            if (name === "Volume") {
                              return [v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString(), name];
                            }
                            return [`${v > 0 ? "+" : ""}${v.toFixed(2)}%`, name];
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10.5, fontFamily: "DM Mono", paddingTop: 4 }}
                          iconType="line"
                        />
                        <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="#00f5c4" opacity={0.18} barSize={6} />
                        <Line yAxisId="ret" dataKey="themeRet" name="Theme" stroke="#00f5c4" strokeWidth={2} dot={false} />
                        <Line yAxisId="ret" dataKey="spyRet" name="SPY" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[240px] flex items-center justify-center text-[12px] text-muted-foreground">
                    {loading ? "Loading historical data…" : "No historical data available."}
                  </div>
                )}
              </div>

              {/* Key metric cards */}
              <div className="grid grid-cols-2 gap-2.5">
                <MetricCard icon={<Activity size={12} />} label="Avg Rel Vol" value={aggregate?.relVol != null ? `${aggregate.relVol.toFixed(2)}×` : "—"} accent="#00f5c4" />
                <MetricCard icon={<BarChart3 size={12} />} label="Sustained Score" value={aggregate?.sustained != null ? aggregate.sustained.toFixed(2) : "—"} accent="#4ade80" />
                <MetricCard icon={<TrendingUp size={12} />} label="Vol Consistency" value={aggregate?.consistency != null ? `${aggregate.consistency.toFixed(0)}%` : "—"} accent="#facc15" />
                <MetricCard icon={<Users size={12} />} label="Tickers" value={String(theme.symbols.length)} accent="#94a3b8" />
              </div>

              {/* Top 3 strongest */}
              <div>
                <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-widest text-muted-foreground mb-1.5" style={{ fontFamily: DM_MONO }}>
                  <Layers size={11} /> Top 3 by RS Rating
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {top3.length === 0 && (
                    <div className="col-span-3 text-[11.5px] text-muted-foreground py-2">No qualified RS data for these tickers.</div>
                  )}
                  {top3.map(t => (
                    <div
                      key={t.symbol}
                      className="rounded-md px-2.5 py-2"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="text-[12.5px] font-bold text-foreground" style={{ fontFamily: DM_MONO }}>{t.symbol}</div>
                      <div className="flex items-baseline justify-between mt-0.5">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider" style={{ fontFamily: DM_MONO }}>RS</span>
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: t.rs != null && t.rs >= 80 ? "#00f5c4" : t.rs != null && t.rs >= 60 ? "#4ade80" : "hsl(var(--foreground))", fontFamily: DM_MONO }}>
                          {t.rs != null ? t.rs.toFixed(0) : "—"}
                        </span>
                      </div>
                      <div className="text-[10.5px] tabular-nums mt-0.5" style={{ color: perfColor(t.perf_1m), fontFamily: DM_MONO }}>
                        1M {fmtPct(t.perf_1m, 1)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ticker list */}
              <div>
                <div className="text-[10.5px] uppercase tracking-widest text-muted-foreground mb-1.5" style={{ fontFamily: DM_MONO }}>
                  All tickers
                </div>
                <div
                  className="rounded-md overflow-hidden"
                  style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="max-h-[320px] overflow-auto">
                    <table className="w-full text-[12px]" style={{ fontFamily: DM_MONO }}>
                      <thead className="sticky top-0 z-10" style={{ background: "rgba(15,18,25,0.95)" }}>
                        <tr className="text-[10.5px] text-muted-foreground border-b border-[rgba(255,255,255,0.06)]">
                          <th className="px-2.5 py-2 text-left font-medium">Ticker</th>
                          <th className="px-2.5 py-2 text-right font-medium">Price</th>
                          <th className="px-2.5 py-2 text-right font-medium">1D</th>
                          <th className="px-2.5 py-2 text-right font-medium">1M</th>
                          <th className="px-2.5 py-2 text-right font-medium">3M</th>
                          <th className="px-2.5 py-2 text-right font-medium">RS</th>
                          <th className="px-2.5 py-2 text-right font-medium">Vol Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickerRows.map(t => {
                          const isDone = t.status === "done";
                          return (
                            <tr key={t.symbol} className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] ${isDone ? "" : "opacity-60"}`}>
                              <td className="px-2.5 py-2 font-bold text-foreground">{t.symbol}</td>
                              <td className="px-2.5 py-2 text-right text-muted-foreground tabular-nums">{t.price > 0 ? `$${t.price.toFixed(2)}` : "—"}</td>
                              <td className="px-2.5 py-2 text-right tabular-nums" style={{ color: perfColor(isDone ? t.perf_1d : null) }}>{isDone ? fmtPct(t.perf_1d, 2) : "—"}</td>
                              <td className="px-2.5 py-2 text-right tabular-nums" style={{ color: perfColor(isDone ? t.perf_1m : null) }}>{isDone ? fmtPct(t.perf_1m, 1) : "—"}</td>
                              <td className="px-2.5 py-2 text-right tabular-nums" style={{ color: perfColor(isDone ? t.perf_3m : null) }}>{isDone ? fmtPct(t.perf_3m, 1) : "—"}</td>
                              <td className="px-2.5 py-2 text-right font-bold tabular-nums" style={{ color: t.rs != null && t.rs >= 80 ? "#00f5c4" : t.rs != null && t.rs >= 60 ? "#4ade80" : "hsl(var(--muted-foreground))" }}>
                                {t.rs != null ? t.rs.toFixed(0) : "—"}
                              </td>
                              <td className="px-2.5 py-2 text-right font-semibold tabular-nums" style={{ color: perfColor(t.vol?.vol_trend_pct ?? null) }}>
                                {t.vol?.vol_trend_pct != null ? fmtPct(t.vol.vol_trend_pct, 1) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div
      className="rounded-md px-3 py-2.5 flex flex-col gap-1"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: DM_MONO }}>
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="text-[18px] font-bold tabular-nums" style={{ color: accent, fontFamily: DM_MONO }}>{value}</div>
    </div>
  );
}
