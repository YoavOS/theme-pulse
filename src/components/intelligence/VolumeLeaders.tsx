import { useMemo, useState, useEffect } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Zap, TrendingUp, TrendingDown, Minus, ChevronRight } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import TimeframeTabs from "./TimeframeTabs";
import { useTimeframeAvailability, type Timeframe } from "@/hooks/useTimeframeAvailability";
import { useTimeframeLeaders, type VolumeLeaderRow } from "@/hooks/useTimeframeLeaders";
import { useThemeRowToggle } from "./CollapsibleSection";
import ThemeTickersPanel from "./ThemeTickersPanel";

const DM_MONO = "'DM Mono', monospace";
const LS_KEY = "volumeLeaders_tf";

function getRelVolColor(val: number): string {
  if (val > 1.8) return "#00f5c4";
  if (val > 1.4) return "#4ade80";
  if (val >= 1.1) return "#facc15";
  return "currentColor";
}

function perfColor(val: number): string {
  return val > 0 ? "#00f5c4" : val < 0 ? "#f5a623" : "currentColor";
}

function sustainedColor(val: number): string {
  if (val > 20) return "#00f5c4";
  if (val > 0) return "#4ade80";
  if (val < -20) return "#f5a623";
  return "currentColor";
}

function TrendIcon({ trend }: { trend: "building" | "fading" | "flat" }) {
  if (trend === "building") return <TrendingUp size={12} className="text-[#00f5c4]" />;
  if (trend === "fading") return <TrendingDown size={12} className="text-[#f5a623]" />;
  return <Minus size={12} className="text-muted-foreground" />;
}

interface VolumeLeadersProps {
  themes: ThemeIntelData[];
  onSelectTheme: (themeId: string) => void;
  onDrilldownOpen?: (themeName: string) => void;
}

export default function VolumeLeaders({ themes, onSelectTheme, onDrilldownOpen }: VolumeLeadersProps) {
  const { availability } = useTimeframeAvailability();
  const { volumeData, loading, fetchVolume } = useTimeframeLeaders();
  const [tf, setTf] = useState<Timeframe>(() => {
    try { return (localStorage.getItem(LS_KEY) as Timeframe) || "today"; } catch { return "today"; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, tf); } catch {}
    if (tf !== "today" && availability[tf]) fetchVolume(tf);
  }, [tf, availability, fetchVolume]);

  const sorted = useMemo(() => {
    const withVol = themes
      .filter(t => t.avgRelVol !== null)
      .sort((a, b) => (b.avgRelVol ?? 0) - (a.avgRelVol ?? 0));
    const withoutVol = themes.filter(t => t.avgRelVol === null);
    return [...withVol, ...withoutVol];
  }, [themes]);

  const hasAnyVolume = sorted.some(t => t.avgRelVol !== null);
  if (!hasAnyVolume && tf === "today") return null;

  const isHistorical = tf !== "today";
  const histData = isHistorical ? (volumeData[tf] || []) : [];
  const isLoadingHist = isHistorical && (loading[`volume-${tf}`] ?? false);

  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5 sticky top-0 z-10 flex-wrap">
        <Zap size={12} className="text-[#00f5c4]" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#00f5c4]" style={{ fontFamily: "'Syne', sans-serif" }}>
          Volume Leaders
        </span>
        <span className="text-[10px] text-muted-foreground ml-1" style={{ fontFamily: DM_MONO }}>
          {isHistorical ? `${histData.length} themes` : `${sorted.length} themes`}
        </span>
        <div className="ml-auto">
          <TimeframeTabs selected={tf} onSelect={setTf} availability={availability} />
        </div>
      </div>

      {isHistorical ? (
        <HistoricalVolumeList data={histData} isLoading={isLoadingHist} themes={themes} />
      ) : (
        <TodayVolumeList sorted={sorted} onSelectTheme={onSelectTheme} onDrilldownOpen={onDrilldownOpen} />
      )}
    </div>
  );
}

/* ── Today view (original) ──────────────────────────────── */

function TodayVolumeList({
  sorted, onSelectTheme, onDrilldownOpen,
}: { sorted: ThemeIntelData[]; onSelectTheme: (id: string) => void; onDrilldownOpen?: (name: string) => void }) {
  return (
    <div
      className="overflow-y-auto rounded-lg vol-leaders-scroll"
      style={{ maxHeight: "500px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      {sorted.map(t => (
        <TodayVolumeRow key={t.themeId} theme={t} onSelectTheme={onSelectTheme} onDrilldownOpen={onDrilldownOpen} />
      ))}
    </div>
  );
}

function TodayVolumeRow({ theme: t, onSelectTheme, onDrilldownOpen }: {
  theme: ThemeIntelData; onSelectTheme: (id: string) => void; onDrilldownOpen?: (name: string) => void;
}) {
  const { open, toggle } = useThemeRowToggle(`volleaders-today-${t.themeId}`);
  const hasVol = t.avgRelVol !== null;
  const isHot = hasVol && (t.avgRelVol ?? 0) > 1.8;
  return (
    <div className="border-b border-[rgba(255,255,255,0.04)]">
      <div
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="relative flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-all duration-150 cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
      >
        <ChevronRight size={11} className="text-muted-foreground transition-transform duration-200 shrink-0" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
        <button
          onClick={(e) => { e.stopPropagation(); onSelectTheme(t.themeId); onDrilldownOpen?.(t.themeName); }}
          className={`font-semibold text-[12px] leading-tight truncate min-w-0 flex-1 text-left ${hasVol ? "text-foreground hover:text-[#00f5c4]" : "text-muted-foreground"}`}
          style={{ fontFamily: "'Syne', sans-serif", maxWidth: "200px" }}
        >
          {t.themeName}
        </button>
        <div className="w-14 text-right shrink-0">
          {hasVol ? (
            <span className="text-base font-bold leading-none" style={{ fontFamily: DM_MONO, color: getRelVolColor(t.avgRelVol!) }}>{t.avgRelVol!.toFixed(1)}×</span>
          ) : (
            <span className="text-sm text-muted-foreground" style={{ fontFamily: DM_MONO }}>--</span>
          )}
        </div>
        <div className="w-16 text-right shrink-0">
          {hasVol && t.sustainedVol !== null ? (
            <span className="text-[11px] font-medium" style={{ fontFamily: DM_MONO, color: sustainedColor(t.sustainedVol) }}>
              {t.sustainedVol > 0 ? "+" : ""}{t.sustainedVol.toFixed(0)}% sus
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>--</span>
          )}
        </div>
        <div className="w-16 text-right shrink-0">
          <span className={`text-[11px] font-medium ${!hasVol ? "text-muted-foreground" : ""}`} style={{ fontFamily: DM_MONO, color: hasVol ? perfColor(t.perf_1d) : undefined }}>
            {t.perf_1d > 0 ? "+" : ""}{t.perf_1d.toFixed(2)}%
          </span>
        </div>
        <div className="w-10 text-right shrink-0">
          <span className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{t.breadthUp}/{t.breadthTotal}</span>
        </div>
        <div className="w-5 shrink-0 flex justify-center">
          {isHot && <Zap size={12} className="text-[#00f5c4] opacity-60" />}
        </div>
      </div>
      {open && (
        <div className="px-3.5 pb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
          <ThemeTickersPanel theme={t} />
        </div>
      )}
    </div>
  );
}

/* ── Historical view ────────────────────────────────────── */

function HistoricalVolumeList({ data, isLoading, themes }: { data: VolumeLeaderRow[]; isLoading: boolean; themes: ThemeIntelData[] }) {
  if (isLoading) {
    return (
      <div className="space-y-1 rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg py-8 text-center text-sm text-muted-foreground" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        No volume history data for this period yet
      </div>
    );
  }

  const themeByName = new Map(themes.map(t => [t.themeName, t]));

  return (
    <div className="overflow-y-auto rounded-lg" style={{ maxHeight: "500px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-3.5 py-2 text-[10px] text-muted-foreground border-b border-[rgba(255,255,255,0.08)]" style={{ fontFamily: DM_MONO }}>
        <span className="w-3 shrink-0" />
        <span className="flex-1 min-w-0">Theme</span>
        <span className="w-14 text-right">Avg Rel Vol</span>
        <span className="w-16 text-right">Sustained</span>
        <span className="w-12 text-right">Trend</span>
        <span className="w-14 text-right">Weeks</span>
      </div>
      {data.map(row => (
        <HistoricalVolumeRow key={row.themeName} row={row} theme={themeByName.get(row.themeName)} />
      ))}
    </div>
  );
}

function HistoricalVolumeRow({ row, theme }: { row: VolumeLeaderRow; theme: ThemeIntelData | undefined }) {
  const { open, toggle } = useThemeRowToggle(`volleaders-hist-${row.themeName}`);
  return (
    <div className="border-b border-[rgba(255,255,255,0.04)]">
      <div
        onClick={toggle}
        className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
      >
        <ChevronRight size={11} className="text-muted-foreground transition-transform duration-200 shrink-0" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
        <div className="font-semibold text-[12px] leading-tight truncate min-w-0 flex-1 text-foreground" style={{ fontFamily: "'Syne', sans-serif", maxWidth: "200px" }}>
          {row.themeName}
          {row.consistent && (
            <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00f5c4] bg-[#00f5c4]/10 px-1.5 py-0.5 rounded-full">Consistent</span>
          )}
        </div>
        <div className="w-14 text-right shrink-0">
          <span className="text-base font-bold" style={{ fontFamily: DM_MONO, color: getRelVolColor(row.avgRelVol) }}>{row.avgRelVol.toFixed(1)}×</span>
        </div>
        <div className="w-16 text-right shrink-0">
          <span className="text-[11px] font-medium" style={{ fontFamily: DM_MONO, color: sustainedColor(row.avgSustainedVol) }}>
            {row.avgSustainedVol > 0 ? "+" : ""}{row.avgSustainedVol.toFixed(0)}%
          </span>
        </div>
        <div className="w-12 flex justify-end shrink-0">
          <TrendIcon trend={row.trend} />
        </div>
        <div className="w-14 text-right shrink-0">
          <span className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{row.weekCount}w</span>
        </div>
      </div>
      {open && (
        <div className="px-3.5 pb-3" style={{ background: "rgba(0,0,0,0.2)" }}>
          {theme ? (
            <ThemeTickersPanel theme={theme} />
          ) : (
            <div className="rounded-md py-3 px-3 text-center text-[11px] text-muted-foreground" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
              Ticker data unavailable for this historical period.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
