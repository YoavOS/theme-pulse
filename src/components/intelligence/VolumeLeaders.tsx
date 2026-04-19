import { useMemo, useState, useEffect } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Zap, ChevronRight } from "lucide-react";
import TimeframeTabs from "./TimeframeTabs";
import { useTimeframeAvailability, type Timeframe } from "@/hooks/useTimeframeAvailability";
import { useSmartVolumeMetrics, type ThemeSmartVolume } from "@/hooks/useSmartVolumeMetrics";
import { useThemeRowToggle } from "./CollapsibleSection";
import ThemeTickersPanel from "./ThemeTickersPanel";
import {
  VolumeSparkline, StrengthBar, SustainedGauge, VolumeHeatBadge, classifyVolumeHeat,
} from "./volume/VolumeVisuals";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ThemeVolumeDashboard from "./volume/ThemeVolumeDashboard";

function HeaderCell({ label, tip, className, align = "center" }: { label: string; tip: string; className?: string; align?: "left" | "center" | "right" }) {
  const alignCls = align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center";
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className={`${className ?? ""} ${alignCls} cursor-help underline decoration-dotted decoration-white/20 underline-offset-2`}>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">{tip}</TooltipContent>
    </Tooltip>
  );
}

const DM_MONO = "'DM Mono', monospace";
const LS_KEY = "volumeLeaders_tf";

function trendColor(v: number | null): string {
  if (v === null) return "currentColor";
  if (v > 25) return "#00f5c4";
  if (v > 5) return "#4ade80";
  if (v < -10) return "#f87171";
  return "currentColor";
}

function fmtPct(v: number | null, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}
function fmtX(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)}×`;
}

interface VolumeLeadersProps {
  themes: ThemeIntelData[];
  onSelectTheme: (themeId: string) => void;
  onDrilldownOpen?: (themeName: string) => void;
}

export default function VolumeLeaders({ themes, onSelectTheme, onDrilldownOpen }: VolumeLeadersProps) {
  const { availability } = useTimeframeAvailability();
  const [tf, setTf] = useState<Timeframe>(() => {
    try { return (localStorage.getItem(LS_KEY) as Timeframe) || "today"; } catch { return "today"; }
  });
  const [dashTheme, setDashTheme] = useState<ThemeIntelData | null>(null);

  const smart = useSmartVolumeMetrics(tf);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, tf); } catch {}
    const allSymbols = Array.from(new Set(themes.flatMap(t => t.symbols)));
    if (allSymbols.length > 0) smart.fetchMetrics(allSymbols);
  }, [tf, themes, smart]);

  // Composite "Volume Action Score" — blends all four smart-volume metrics into a
  // single 0..1 ranking signal. Each component is normalized to 0..1 then weighted.
  // Weights tilt by timeframe: shorter = lean on Rel Vol + Trend; longer = lean on
  // Consistency + Sustained.
  const rows = useMemo(() => {
    const W: Record<Timeframe, { rv: number; tr: number; co: number; su: number }> = {
      today: { rv: 0.40, tr: 0.20, co: 0.10, su: 0.30 },
      "1W":  { rv: 0.30, tr: 0.30, co: 0.15, su: 0.25 },
      "1M":  { rv: 0.20, tr: 0.30, co: 0.20, su: 0.30 },
      "3M":  { rv: 0.15, tr: 0.25, co: 0.25, su: 0.35 },
    };
    const w = W[tf];
    const norm = {
      relVol:    (v: number | null) => v == null ? 0 : Math.max(0, Math.min(1, (v - 0.5) / 2.0)),    // 0.5×→0, 2.5×→1
      trend:     (v: number | null) => v == null ? 0 : Math.max(0, Math.min(1, (v + 20) / 70)),       // -20%→0, +50%→1
      cons:      (v: number | null) => v == null ? 0 : Math.max(0, Math.min(1, v / 100)),             // 0..100% direct
      sustained: (v: number | null) => v == null ? 0 : Math.max(0, Math.min(1, (v - 0.7) / 0.8)),    // 0.7→0, 1.5→1
    };
    return themes
      .map(t => {
        const m = smart.getThemeMetrics(t.symbols);
        const score =
          norm.relVol(m.relVol)       * w.rv +
          norm.trend(m.volTrendPct)   * w.tr +
          norm.cons(m.volConsistency) * w.co +
          norm.sustained(m.sustainedScore) * w.su;
        // Demote rows with no data so they sink to the bottom
        const hasData = m.relVol != null || m.volTrendPct != null || m.sustainedScore != null;
        return { theme: t, metrics: m, score: hasData ? score : -1 };
      })
      .sort((a, b) => b.score - a.score);
  }, [themes, smart, tf]);

  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5 sticky top-0 z-10 flex-wrap">
        <Zap size={12} className="text-[#00f5c4]" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#00f5c4]" style={{ fontFamily: "'Syne', sans-serif" }}>
          Volume Leaders
        </span>
        <span className="text-[10px] text-muted-foreground ml-1" style={{ fontFamily: DM_MONO }}>
          {rows.length} themes · {tf === "today" ? "Today" : tf}
        </span>
        <div className="ml-auto">
          <TimeframeTabs selected={tf} onSelect={setTf} availability={availability} />
        </div>
      </div>

      <div
        className="overflow-y-auto rounded-lg vol-leaders-scroll"
        style={{ maxHeight: "560px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center gap-4 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-[rgba(255,255,255,0.08)]"
          style={{ fontFamily: DM_MONO, background: "rgba(15,18,25,0.95)" }}
        >
          <span className="w-3 shrink-0" />
          <span className="flex-1 min-w-0">Theme</span>
          <HeaderCell className="w-[88px]" label="Trend" tip="30-day volume sparkline. Color reflects trend direction: teal/green = increasing, yellow = flat, red = decreasing." />
          <HeaderCell className="w-[130px]" label="Strength" tip="Today's volume divided by the average for the selected timeframe (Rel Vol). Bar fills 0×–2.5×; tick marks 1.0× baseline." />
          <HeaderCell className="w-16" label="Vol Δ" align="right" tip="Percent change in average daily volume across the selected period (second half vs first half). Positive = accelerating demand." />
          <HeaderCell className="w-[88px]" label="Sustained" tip="(10d avg / 30d avg) × (20d avg / 60d avg). Values > 1.2 indicate strong, multi-window sustained accumulation." />
          <HeaderCell className="w-[120px]" label="Regime" align="right" tip="Quick classification combining Rel Vol, Trend %, and Sustained score. Hover any badge for the full definition." />
        </div>

        {rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No volume data yet — fetching…</div>
        ) : (
          rows.map(({ theme, metrics }) => (
            <SmartVolumeRow
              key={theme.themeId}
              theme={theme}
              metrics={metrics}
              period={tf}
              onSelectTheme={onSelectTheme}
              onDrilldownOpen={onDrilldownOpen}
              smart={smart}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SmartVolumeRow({
  theme: t, metrics, period, onSelectTheme, onDrilldownOpen, smart,
}: {
  theme: ThemeIntelData;
  metrics: ThemeSmartVolume;
  period: Timeframe;
  onSelectTheme: (id: string) => void;
  onDrilldownOpen?: (name: string) => void;
  smart: ReturnType<typeof useSmartVolumeMetrics>;
}) {
  const { open, toggle } = useThemeRowToggle(`volleaders-smart-${period}-${t.themeId}`);
  const heat = classifyVolumeHeat(metrics.relVol, metrics.volTrendPct, metrics.sustainedScore);
  const isLoading = metrics.loading && metrics.relVol === null;

  return (
    <div className="border-b border-[rgba(255,255,255,0.04)]">
      <div
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="relative flex w-full items-center gap-4 px-4 py-3 text-left transition-all duration-150 cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
      >
        <ChevronRight size={12} className="text-muted-foreground transition-transform duration-200 shrink-0" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
        <button
          onClick={(e) => { e.stopPropagation(); onSelectTheme(t.themeId); onDrilldownOpen?.(t.themeName); }}
          className="font-semibold text-[13.5px] leading-tight truncate min-w-0 flex-1 text-left text-foreground hover:text-[#00f5c4]"
          style={{ fontFamily: "'Syne', sans-serif", maxWidth: "240px" }}
        >
          {t.themeName}
        </button>

        {/* Sparkline */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <div className="w-[88px] flex justify-center shrink-0 cursor-help">
              {isLoading ? (
                <div className="h-[24px] w-[80px] rounded bg-white/5 animate-pulse" />
              ) : metrics.sparkline.length > 1 ? (
                <VolumeSparkline series={metrics.sparkline} trendPct={metrics.volTrendPct} variant="bars" width={80} height={24} />
              ) : (
                <span className="text-[12px] text-muted-foreground">—</span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            <div className="font-semibold mb-0.5">Volume Trend (30 days)</div>
            <div className="text-muted-foreground">Daily volume bars normalized across the theme's tickers. Color reflects trend direction — teal/green rising, yellow flat, red falling.</div>
          </TooltipContent>
        </Tooltip>

        {/* Strength bar + numeric Rel Vol */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <div className="w-[130px] flex items-center gap-2.5 shrink-0 cursor-help">
              <StrengthBar value={metrics.relVol} width={70} height={7} />
              <span className="text-[12px] font-bold tabular-nums text-foreground w-[44px] text-right" style={{ fontFamily: DM_MONO }}>
                {isLoading ? "…" : fmtX(metrics.relVol)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            <div className="font-semibold mb-0.5">Strength · Rel Vol</div>
            <div className="text-muted-foreground">Today's volume ÷ average volume for the selected timeframe. <b className="text-foreground">1.0×</b> = normal · <b className="text-foreground">&gt;1.4×</b> elevated · <b className="text-foreground">&gt;1.8×</b> strong surge.</div>
          </TooltipContent>
        </Tooltip>

        {/* Vol trend % */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <div className="w-16 text-right shrink-0 cursor-help">
              <span className="text-[12.5px] font-bold tabular-nums" style={{ fontFamily: DM_MONO, color: trendColor(metrics.volTrendPct) }}>
                {isLoading ? "…" : fmtPct(metrics.volTrendPct)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            <div className="font-semibold mb-0.5">Volume Δ %</div>
            <div className="text-muted-foreground">Change in average daily volume across the period: <b className="text-foreground">(2nd half avg ÷ 1st half avg − 1)</b>. Positive = accelerating demand.</div>
          </TooltipContent>
        </Tooltip>

        {/* Sustained gauge */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <div className="w-[88px] flex flex-col items-center gap-1 shrink-0 cursor-help">
              <SustainedGauge score={metrics.sustainedScore} width={72} />
              <span className="text-[11px] font-semibold tabular-nums text-foreground/80" style={{ fontFamily: DM_MONO }}>
                {isLoading ? "…" : metrics.sustainedScore != null ? metrics.sustainedScore.toFixed(2) : "—"}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
            <div className="font-semibold mb-0.5">Sustained Score</div>
            <div className="text-muted-foreground"><b className="text-foreground">(10d avg ÷ 30d avg) × (20d avg ÷ 60d avg)</b>. &gt;1.2 = strong multi-window accumulation · ~1.0 = stable · &lt;0.9 = drying up.</div>
          </TooltipContent>
        </Tooltip>

        {/* Heat badge */}
        <div className="w-[120px] flex justify-end shrink-0">
          {isLoading ? (
            <div className="h-[18px] w-[88px] rounded-full bg-white/5 animate-pulse" />
          ) : (
            <VolumeHeatBadge heat={heat} />
          )}
        </div>
      </div>
      {open && (
        <div className="px-4 pb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
          <ThemeTickersPanel theme={t} smartVolumeData={smart.data} smartVolumePeriod={period} />
        </div>
      )}
    </div>
  );
}
