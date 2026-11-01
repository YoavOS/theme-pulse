import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ThemeData } from "@/data/themeData";
import { supabase as _supa } from "@/integrations/supabase/client";
import ThemeStory from "@/components/dashboard/ThemeStory";
import { Loader2, TrendingUp, TrendingDown, Minus, Sparkles, Zap } from "lucide-react";

const supabase: any = _supa;
const DM_MONO = "'DM Mono', monospace";
const CACHE_PREFIX = "theme-strength-ai-v1:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

type RsRow = {
  symbol: string;
  rs_1d: number | null;
  rs_1w: number | null;
  rs_1m: number | null;
  rs_3m: number | null;
  rs_6m: number | null;
  rs_overall: number | null;
};
type VolRow = {
  symbol: string;
  today_vol: number | null;
  avg_20d: number | null;
  avg_10d: number | null;
  avg_3m: number | null;
};

interface Props {
  theme: ThemeData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Grouping the box belongs to (theme / industry / subIndustry / sector), for the story. */
  mode?: string;
}

function rsColor(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "#6b7280";
  if (v >= 80) return "#00ff88";
  if (v >= 60) return "#22c55e";
  if (v >= 40) return "#f59e0b";
  return "#ff4466";
}
function perfColor(v: number): string {
  if (v > 0.1) return "#00ff88";
  if (v < -0.1) return "#ff4466";
  return "#9ca3af";
}
function relVolColor(v: number): string {
  if (v >= 2.0) return "#00ff88";
  if (v >= 1.2) return "#22c55e";
  if (v >= 0.8) return "#9ca3af";
  return "#f59e0b";
}

function avg(nums: (number | null | undefined)[]): number | null {
  const arr = nums.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function accelerationLabel(fast: number | null, slow: number | null): "up" | "down" | "flat" | "na" {
  if (fast == null || slow == null) return "na";
  const diff = fast - slow;
  if (diff > 5) return "up";
  if (diff < -5) return "down";
  return "flat";
}

function AccelIcon({ dir }: { dir: "up" | "down" | "flat" | "na" }) {
  if (dir === "up") return <TrendingUp size={11} style={{ color: "#00ff88" }} />;
  if (dir === "down") return <TrendingDown size={11} style={{ color: "#ff4466" }} />;
  if (dir === "flat") return <Minus size={11} style={{ color: "#9ca3af" }} />;
  return <span className="text-muted-foreground">—</span>;
}

function accelText(dir: "up" | "down" | "flat" | "na"): string {
  return dir === "up" ? "Accelerating" : dir === "down" ? "Slowing" : dir === "flat" ? "Stable" : "—";
}

function breadthLabel(breadthPct: number, avgRsOverall: number | null): {
  label: string;
  color: string;
} {
  if (breadthPct >= 70) return { label: "Strong Participation", color: "#00ff88" };
  if (breadthPct >= 50) return { label: "Good Participation", color: "#22c55e" };
  if (breadthPct >= 30) {
    if (avgRsOverall != null && avgRsOverall >= 70)
      return { label: "Selective Strength", color: "#f59e0b" };
    return { label: "Weak Participation", color: "#f59e0b" };
  }
  return { label: "Weak Participation", color: "#ff4466" };
}

function VolumeSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 80, h = 22;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * h).toFixed(1)}`)
    .join(" ");
  const trending = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} className="inline-block">
      <path d={d} stroke={trending ? "#00ff88" : "#ff4466"} strokeWidth={1.5} fill="none" />
    </svg>
  );
}

export default function ThemeStrengthMeter({ theme, open, onOpenChange, mode = "theme" }: Props) {
  const [rsRows, setRsRows] = useState<RsRow[]>([]);
  const [volRows, setVolRows] = useState<VolRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [keySignal, setKeySignal] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  const symbols = useMemo(
    () => (theme ? theme.tickers.filter(t => !t.skipped).map(t => t.symbol) : []),
    [theme]
  );

  // Fetch cached RS + volume rows when panel opens
  useEffect(() => {
    if (!open || !theme || symbols.length === 0) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const [rsRes, volRes] = await Promise.all([
          supabase
            .from("qualified_rs_universe")
            .select("symbol, rs_1d, rs_1w, rs_1m, rs_3m, rs_6m, rs_overall")
            .in("symbol", symbols),
          supabase
            .from("ticker_volume_cache")
            .select("symbol, today_vol, avg_20d, avg_10d, avg_3m")
            .in("symbol", symbols),
        ]);
        if (cancel) return;
        setRsRows(rsRes.data || []);
        setVolRows(volRes.data || []);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [open, theme, symbols]);

  // Derived metrics
  const metrics = useMemo(() => {
    if (!theme) return null;
    const rs = {
      rs_1d: avg(rsRows.map(r => r.rs_1d)),
      rs_1w: avg(rsRows.map(r => r.rs_1w)),
      rs_1m: avg(rsRows.map(r => r.rs_1m)),
      rs_3m: avg(rsRows.map(r => r.rs_3m)),
      rs_6m: avg(rsRows.map(r => r.rs_6m)),
      rs_overall: avg(rsRows.map(r => r.rs_overall)),
    };
    const validTickers = theme.tickers.filter(t => !t.skipped);
    const up = validTickers.filter(t => t.pct > 0).length;
    const breadthPct = validTickers.length > 0 ? Math.round((up / validTickers.length) * 100) : 0;
    const bLabel = breadthLabel(breadthPct, rs.rs_overall);

    // Volume aggregates
    const validVols = volRows.filter(v => (v.avg_20d ?? 0) > 0 && (v.today_vol ?? 0) > 0);
    const relVols = validVols.map(v => v.today_vol! / v.avg_20d!);
    const avgRelVol = relVols.length ? relVols.reduce((a, b) => a + b, 0) / relVols.length : null;
    const susVols = volRows.filter(v => (v.avg_3m ?? 0) > 0 && (v.avg_10d ?? 0) > 0)
      .map(v => ((v.avg_10d! / v.avg_3m!) - 1) * 100);
    const sustainedVol = susVols.length ? susVols.reduce((a, b) => a + b, 0) / susVols.length : null;

    // Sparkline synth: rs_6m, rs_3m, rs_1m, rs_1w, rs_1d
    const sparkPoints = [rs.rs_6m, rs.rs_3m, rs.rs_1m, rs.rs_1w, rs.rs_1d]
      .filter((n): n is number => typeof n === "number" && !Number.isNaN(n));

    // Acceleration: 1d vs 1w, 1w vs 1m, 1m vs 3m, 3m vs 6m
    const accel = {
      rs_1d: accelerationLabel(rs.rs_1d, rs.rs_1w),
      rs_1w: accelerationLabel(rs.rs_1w, rs.rs_1m),
      rs_1m: accelerationLabel(rs.rs_1m, rs.rs_3m),
      rs_3m: accelerationLabel(rs.rs_3m, rs.rs_6m),
      rs_6m: "na" as const,
    };

    // Top 5 today
    const rsMap = new Map(rsRows.map(r => [r.symbol, r]));
    const top5 = [...validTickers]
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
      .map(t => ({
        symbol: t.symbol,
        pct: t.pct,
        rs_overall: rsMap.get(t.symbol)?.rs_overall ?? null,
      }));

    return { rs, breadthPct, bLabel, avgRelVol, sustainedVol, sparkPoints, accel, top5 };
  }, [theme, rsRows, volRows]);

  // Fetch AI summary (cached)
  useEffect(() => {
    if (!open || !theme || !metrics) return;
    const cacheKey = `${CACHE_PREFIX}${theme.theme_name}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.at && Date.now() - parsed.at < CACHE_TTL_MS) {
          setAiSummary(parsed.summary || "");
          setKeySignal(parsed.key_signal || "");
          return;
        }
      }
    } catch {}
    setAiLoading(true);
    setAiSummary("");
    setKeySignal("");
    const payload = {
      themeName: theme.theme_name,
      perfPct: theme.performance_pct,
      breadthPct: metrics.breadthPct,
      breadthLabel: metrics.bLabel.label,
      rs: {
        rs_1d: metrics.rs.rs_1d?.toFixed(0),
        rs_1w: metrics.rs.rs_1w?.toFixed(0),
        rs_1m: metrics.rs.rs_1m?.toFixed(0),
        rs_3m: metrics.rs.rs_3m?.toFixed(0),
        rs_6m: metrics.rs.rs_6m?.toFixed(0),
      },
      acceleration: `1d ${accelText(metrics.accel.rs_1d)}, 1w ${accelText(metrics.accel.rs_1w)}, 1m ${accelText(metrics.accel.rs_1m)}`,
      relVol: metrics.avgRelVol?.toFixed(2),
      sustainedVol: metrics.sustainedVol?.toFixed(1),
      topMovers: metrics.top5,
    };
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("theme-strength-summary", { body: payload });
        if (error || !data) return;
        setAiSummary(data.summary || "");
        setKeySignal(data.key_signal || "");
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            at: Date.now(), summary: data.summary, key_signal: data.key_signal,
          }));
        } catch {}
      } finally {
        setAiLoading(false);
      }
    })();
  }, [open, theme, metrics]);

  if (!theme) return null;

  const sign = theme.performance_pct >= 0 ? "+" : "";
  const rsTimeframes: { key: keyof NonNullable<typeof metrics>["rs"]; label: string; accelKey: keyof NonNullable<typeof metrics>["accel"] }[] = [
    { key: "rs_1d", label: "1D", accelKey: "rs_1d" },
    { key: "rs_1w", label: "1W", accelKey: "rs_1w" },
    { key: "rs_1m", label: "1M", accelKey: "rs_1m" },
    { key: "rs_3m", label: "3M", accelKey: "rs_3m" },
    { key: "rs_6m", label: "6M", accelKey: "rs_6m" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0 bg-[#0B0E12] border-l border-white/10">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-white/10">
          <SheetTitle className="font-['Syne',sans-serif] text-lg text-foreground pr-8">
            Theme Strength Meter
          </SheetTitle>
          <div className="flex items-baseline justify-between gap-2 mt-1">
            <span className="text-sm text-muted-foreground truncate">{theme.theme_name}</span>
            <span className="text-lg font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: perfColor(theme.performance_pct) }}>
              {sign}{theme.performance_pct.toFixed(2)}%
            </span>
          </div>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          <ThemeStory theme={theme} mode={mode} />
          {/* Key Signal */}
          {(keySignal || aiLoading) && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              <div className="flex-1">
                <div className="text-[9.5px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: DM_MONO }}>Key Signal</div>
                <div className="text-sm font-semibold text-foreground">
                  {aiLoading && !keySignal ? <Loader2 size={12} className="inline animate-spin" /> : keySignal}
                </div>
              </div>
            </div>
          )}

          {/* RS Across Timeframes */}
          <section>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: DM_MONO }}>
              RS Across Timeframes
            </h4>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 size={12} className="animate-spin" /> Loading RS data…
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1.5">
                {rsTimeframes.map(tf => {
                  const val = metrics?.rs[tf.key];
                  const dir = metrics?.accel[tf.accelKey] ?? "na";
                  return (
                    <div key={tf.label} className="rounded-md bg-white/[0.04] border border-white/[0.06] px-1.5 py-2 text-center">
                      <div className="text-[9px] uppercase text-muted-foreground" style={{ fontFamily: DM_MONO }}>{tf.label}</div>
                      <div className="text-base font-bold tabular-nums mt-0.5" style={{ fontFamily: DM_MONO, color: rsColor(val ?? null) }}>
                        {val != null ? Math.round(val) : "—"}
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-0.5 text-[9px]">
                        <AccelIcon dir={dir} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {metrics?.rs.rs_overall != null && (
              <div className="mt-2 text-[11px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                RS Overall: <span className="font-semibold" style={{ color: rsColor(metrics.rs.rs_overall) }}>{Math.round(metrics.rs.rs_overall)}</span>
              </div>
            )}
          </section>

          {/* Breadth & Participation */}
          <section>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: DM_MONO }}>
              Breadth & Participation
            </h4>
            {metrics && (
              <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: metrics.bLabel.color }}>{metrics.bLabel.label}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: metrics.bLabel.color }}>
                    {metrics.breadthPct}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${metrics.breadthPct}%`, background: metrics.bLabel.color }} />
                </div>
              </div>
            )}
          </section>

          {/* Volume Metrics */}
          <section>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: DM_MONO }}>
              Volume Metrics
            </h4>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-2">
                <div className="text-[9px] uppercase text-muted-foreground" style={{ fontFamily: DM_MONO }}>Rel Vol</div>
                <div className="text-sm font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: metrics?.avgRelVol ? relVolColor(metrics.avgRelVol) : "#6b7280" }}>
                  {metrics?.avgRelVol != null ? `${metrics.avgRelVol.toFixed(2)}×` : "—"}
                </div>
              </div>
              <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-2">
                <div className="text-[9px] uppercase text-muted-foreground" style={{ fontFamily: DM_MONO }}>Sustained</div>
                <div className="text-sm font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: metrics?.sustainedVol != null && metrics.sustainedVol >= 0 ? "#00ff88" : metrics?.sustainedVol != null ? "#ff4466" : "#6b7280" }}>
                  {metrics?.sustainedVol != null ? `${metrics.sustainedVol >= 0 ? "+" : ""}${metrics.sustainedVol.toFixed(0)}%` : "—"}
                </div>
              </div>
              <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-2 flex flex-col">
                <div className="text-[9px] uppercase text-muted-foreground" style={{ fontFamily: DM_MONO }}>Trend</div>
                <div className="mt-1">
                  {metrics && metrics.sparkPoints.length >= 2 ? (
                    <VolumeSparkline points={metrics.sparkPoints} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Top 5 Stocks */}
          <section>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2" style={{ fontFamily: DM_MONO }}>
              Top 5 Stocks Today
            </h4>
            <div className="rounded-md bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              {metrics?.top5.map((s) => (
                <div key={s.symbol} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-sm font-semibold text-foreground" style={{ fontFamily: DM_MONO }}>{s.symbol}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums font-semibold" style={{ fontFamily: DM_MONO, color: perfColor(s.pct) }}>
                      {s.pct >= 0 ? "+" : ""}{s.pct.toFixed(2)}%
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold tabular-nums min-w-[28px] text-center"
                      style={{ fontFamily: DM_MONO, background: `${rsColor(s.rs_overall)}22`, color: rsColor(s.rs_overall) }}
                      title="RS Overall"
                    >
                      {s.rs_overall != null ? Math.round(s.rs_overall) : "—"}
                    </span>
                  </div>
                </div>
              ))}
              {metrics && metrics.top5.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No tickers</div>
              )}
            </div>
          </section>

          {/* AI Summary */}
          <section>
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5" style={{ fontFamily: DM_MONO }}>
              <Sparkles size={11} className="text-primary" /> AI Summary
            </h4>
            <div className="rounded-md bg-white/[0.04] border border-white/[0.06] px-3 py-2.5 text-[13px] leading-relaxed text-foreground/90">
              {aiLoading && !aiSummary ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 size={12} className="animate-spin" /> Generating insight…
                </span>
              ) : aiSummary ? (
                aiSummary
              ) : (
                <span className="text-muted-foreground text-xs">No summary available.</span>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
