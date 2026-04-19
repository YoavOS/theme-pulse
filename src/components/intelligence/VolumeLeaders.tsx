import { useMemo, useState, useEffect } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Zap, ChevronRight } from "lucide-react";
import TimeframeTabs from "./TimeframeTabs";
import { useTimeframeAvailability, type Timeframe } from "@/hooks/useTimeframeAvailability";
import { useSmartVolumeMetrics, type ThemeSmartVolume } from "@/hooks/useSmartVolumeMetrics";
import { useThemeRowToggle } from "./CollapsibleSection";
import ThemeTickersPanel from "./ThemeTickersPanel";

const DM_MONO = "'DM Mono', monospace";
const LS_KEY = "volumeLeaders_tf";

/* ── Color helpers ─────────────────────────────────────── */

function relVolColor(v: number | null): string {
  if (v === null) return "currentColor";
  if (v > 1.8) return "#00f5c4";   // strong green
  if (v > 1.4) return "#4ade80";   // light green
  if (v >= 1.1) return "#facc15";  // amber
  if (v < 0.9) return "#f87171";   // red
  return "currentColor";
}
function trendColor(v: number | null): string {
  if (v === null) return "currentColor";
  if (v > 25) return "#00f5c4";
  if (v > 5) return "#4ade80";
  if (v < -10) return "#f87171";
  return "currentColor";
}
function consistencyColor(v: number | null): string {
  if (v === null) return "currentColor";
  if (v >= 70) return "#00f5c4";
  if (v >= 50) return "#4ade80";
  if (v < 30) return "#f87171";
  return "currentColor";
}
function sustainedColor(v: number | null): string {
  if (v === null) return "currentColor";
  if (v >= 1.2) return "#00f5c4";
  if (v >= 1.05) return "#4ade80";
  if (v < 0.9) return "#f87171";
  return "currentColor";
}

function fmtPct(v: number | null, digits = 1): string {
  if (v === null) return "--";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}
function fmtX(v: number | null): string {
  if (v === null) return "--";
  return `${v.toFixed(2)}×`;
}
function fmtScore(v: number | null): string {
  if (v === null) return "--";
  return v.toFixed(2);
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

  // Fetch metrics for ALL theme symbols whenever themes/tf change
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, tf); } catch {}
    const allSymbols = Array.from(new Set(themes.flatMap(t => t.symbols)));
    if (allSymbols.length > 0) smart.fetchMetrics(allSymbols);
  }, [tf, themes, smart]);

  // Build per-theme aggregated metrics
  const rows = useMemo(() => {
    return themes
      .map(t => ({ theme: t, metrics: smart.getThemeMetrics(t.symbols) }))
      .sort((a, b) => {
        // Sort by sustained score primarily, then rel vol
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
        {/* Header row */}
        <div
          className="sticky top-0 z-10 flex items-center gap-3 px-3.5 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-[rgba(255,255,255,0.08)]"
          style={{ fontFamily: DM_MONO, background: "rgba(15,18,25,0.95)" }}
        >
          <span className="w-3 shrink-0" />
          <span className="flex-1 min-w-0">Theme</span>
          <span className="w-14 text-right" title="Today's volume vs the average for the selected period">Rel Vol</span>
          <span className="w-16 text-right" title="% change in average daily volume across the selected period">Vol Trend</span>
          <span className="w-16 text-right" title="% of days in the period where volume was above the 60-day average">Consistency</span>
          <span className="w-16 text-right" title="(10d/30d) × (20d/60d) — values >1.2 indicate accelerating sustained demand">Sustained</span>
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
  const isHot = (metrics.sustainedScore ?? 0) > 1.2 && (metrics.relVol ?? 0) > 1.4;
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
          {isHot && <Zap size={11} className="inline ml-1 text-[#00f5c4] opacity-70" />}
        </button>

        <div className="w-14 text-right shrink-0">
          <span className="text-[12px] font-bold leading-none" style={{ fontFamily: DM_MONO, color: relVolColor(metrics.relVol) }}>
            {isLoading ? "…" : fmtX(metrics.relVol)}
          </span>
        </div>
        <div className="w-16 text-right shrink-0">
          <span className="text-[11px] font-medium" style={{ fontFamily: DM_MONO, color: trendColor(metrics.volTrendPct) }}>
            {isLoading ? "…" : fmtPct(metrics.volTrendPct)}
          </span>
        </div>
        <div className="w-16 text-right shrink-0">
          <span className="text-[11px] font-medium" style={{ fontFamily: DM_MONO, color: consistencyColor(metrics.volConsistency) }}>
            {isLoading ? "…" : metrics.volConsistency === null ? "--" : `${metrics.volConsistency}%`}
          </span>
        </div>
        <div className="w-16 text-right shrink-0">
          <span className="text-[11px] font-bold" style={{ fontFamily: DM_MONO, color: sustainedColor(metrics.sustainedScore) }}>
            {isLoading ? "…" : fmtScore(metrics.sustainedScore)}
          </span>
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
