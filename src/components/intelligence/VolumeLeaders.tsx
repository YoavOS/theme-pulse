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

  const smart = useSmartVolumeMetrics(tf);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, tf); } catch {}
    const allSymbols = Array.from(new Set(themes.flatMap(t => t.symbols)));
    if (allSymbols.length > 0) smart.fetchMetrics(allSymbols);
  }, [tf, themes, smart]);

  const rows = useMemo(() => {
    return themes
      .map(t => ({ theme: t, metrics: smart.getThemeMetrics(t.symbols) }))
      .sort((a, b) => {
        const aScore = (a.metrics.sustainedScore ?? 0) * 1.5 + (a.metrics.relVol ?? 0);
        const bScore = (b.metrics.sustainedScore ?? 0) * 1.5 + (b.metrics.relVol ?? 0);
        return bScore - aScore;
      });
  }, [themes, smart]);

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
          className="sticky top-0 z-10 flex items-center gap-3 px-3.5 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-[rgba(255,255,255,0.08)]"
          style={{ fontFamily: DM_MONO, background: "rgba(15,18,25,0.95)" }}
        >
          <span className="w-3 shrink-0" />
          <span className="flex-1 min-w-0">Theme</span>
          <span className="w-[78px] text-center" title="30-day volume sparkline (color = trend direction)">Trend</span>
          <span className="w-[110px] text-center" title="Today's volume vs the period average">Strength</span>
          <span className="w-14 text-right" title="% change in average daily volume across the selected period">Vol Δ</span>
          <span className="w-[78px] text-center" title="(10d/30d) × (20d/60d) — values >1.2 = accelerating sustained demand">Sustained</span>
          <span className="w-[100px] text-right" title="Quick regime classification">Regime</span>
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
        className="relative flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-all duration-150 cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
      >
        <ChevronRight size={11} className="text-muted-foreground transition-transform duration-200 shrink-0" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
        <button
          onClick={(e) => { e.stopPropagation(); onSelectTheme(t.themeId); onDrilldownOpen?.(t.themeName); }}
          className="font-semibold text-[12px] leading-tight truncate min-w-0 flex-1 text-left text-foreground hover:text-[#00f5c4]"
          style={{ fontFamily: "'Syne', sans-serif", maxWidth: "220px" }}
        >
          {t.themeName}
        </button>

        {/* Sparkline */}
        <div className="w-[78px] flex justify-center shrink-0">
          {isLoading ? (
            <div className="h-[22px] w-[70px] rounded bg-white/5 animate-pulse" />
          ) : (
            <VolumeSparkline series={metrics.sparkline} trendPct={metrics.volTrendPct} variant="bars" />
          )}
        </div>

        {/* Strength bar + numeric Rel Vol */}
        <div className="w-[110px] flex items-center gap-2 shrink-0">
          <StrengthBar value={metrics.relVol} />
          <span className="text-[10.5px] tabular-nums text-muted-foreground w-9 text-right" style={{ fontFamily: DM_MONO }}>
            {isLoading ? "…" : fmtX(metrics.relVol)}
          </span>
        </div>

        {/* Vol trend % */}
        <div className="w-14 text-right shrink-0">
          <span className="text-[11px] font-medium" style={{ fontFamily: DM_MONO, color: trendColor(metrics.volTrendPct) }}>
            {isLoading ? "…" : fmtPct(metrics.volTrendPct)}
          </span>
        </div>

        {/* Sustained gauge */}
        <div className="w-[78px] flex flex-col items-center gap-0.5 shrink-0">
          <SustainedGauge score={metrics.sustainedScore} width={64} />
          <span className="text-[9.5px] tabular-nums text-muted-foreground" style={{ fontFamily: DM_MONO }}>
            {isLoading ? "…" : metrics.sustainedScore != null ? metrics.sustainedScore.toFixed(2) : "--"}
          </span>
        </div>

        {/* Heat badge */}
        <div className="w-[100px] flex justify-end shrink-0">
          {isLoading ? (
            <div className="h-[16px] w-[70px] rounded-full bg-white/5 animate-pulse" />
          ) : (
            <VolumeHeatBadge heat={heat} />
          )}
        </div>
      </div>
      {open && (
        <div className="px-3.5 pb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
          <ThemeTickersPanel theme={t} smartVolumeData={smart.data} smartVolumePeriod={period} />
        </div>
      )}
    </div>
  );
}
