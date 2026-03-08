import { useMemo } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { Zap } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

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

interface VolumeLeadersProps {
  themes: ThemeIntelData[];
  onSelectTheme: (themeId: string) => void;
  onDrilldownOpen?: (themeName: string) => void;
}

export default function VolumeLeaders({ themes, onSelectTheme, onDrilldownOpen }: VolumeLeadersProps) {
  const sorted = useMemo(() => {
    const withVol = themes
      .filter(t => t.avgRelVol !== null)
      .sort((a, b) => (b.avgRelVol ?? 0) - (a.avgRelVol ?? 0));
    const withoutVol = themes.filter(t => t.avgRelVol === null);
    return [...withVol, ...withoutVol];
  }, [themes]);

  const hasAnyVolume = sorted.some(t => t.avgRelVol !== null);
  if (!hasAnyVolume) return null;

  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5 sticky top-0 z-10">
        <Zap size={12} className="text-[#00f5c4]" />
        <span
          className="text-[11px] font-semibold uppercase tracking-widest text-[#00f5c4]"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          Volume Leaders
        </span>
        <span className="text-[10px] text-muted-foreground ml-1" style={{ fontFamily: DM_MONO }}>
          {sorted.length} themes
        </span>
      </div>

      <div
        className="overflow-y-auto rounded-lg vol-leaders-scroll"
        style={{
          maxHeight: "400px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {sorted.map(t => {
          const hasVol = t.avgRelVol !== null;
          const isHot = hasVol && (t.avgRelVol ?? 0) > 1.8;

          return (
            <button
              key={t.themeId}
              onClick={() => {
                onSelectTheme(t.themeId);
                onDrilldownOpen?.(t.themeName);
              }}
              className="relative flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-all duration-150 cursor-pointer border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.04)]"
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = "inset 0 0 12px rgba(0,245,196,0.08)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {/* Theme name */}
              <div
                className={`font-semibold text-[12px] leading-tight truncate min-w-0 flex-1 ${
                  hasVol ? "text-foreground" : "text-muted-foreground"
                }`}
                style={{ fontFamily: "'Syne', sans-serif", maxWidth: "200px" }}
              >
                {t.themeName}
              </div>

              {/* Rel Vol */}
              <div className="w-14 text-right shrink-0">
                {hasVol ? (
                  <span
                    className="text-base font-bold leading-none"
                    style={{ fontFamily: DM_MONO, color: getRelVolColor(t.avgRelVol!) }}
                  >
                    {t.avgRelVol!.toFixed(1)}×
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground" style={{ fontFamily: DM_MONO }}>--</span>
                )}
              </div>

              {/* Sustained Vol */}
              <div className="w-16 text-right shrink-0">
                {hasVol && t.sustainedVol !== null ? (
                  <span
                    className="text-[11px] font-medium"
                    style={{ fontFamily: DM_MONO, color: sustainedColor(t.sustainedVol) }}
                  >
                    {t.sustainedVol > 0 ? "+" : ""}{t.sustainedVol.toFixed(0)}% sus
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>--</span>
                )}
              </div>

              {/* 1D perf */}
              <div className="w-16 text-right shrink-0">
                <span
                  className={`text-[11px] font-medium ${!hasVol ? "text-muted-foreground" : ""}`}
                  style={{ fontFamily: DM_MONO, color: hasVol ? perfColor(t.perf_1d) : undefined }}
                >
                  {t.perf_1d > 0 ? "+" : ""}{t.perf_1d.toFixed(2)}%
                </span>
              </div>

              {/* Breadth */}
              <div className="w-10 text-right shrink-0">
                <span
                  className="text-[10px] text-muted-foreground"
                  style={{ fontFamily: DM_MONO }}
                >
                  {t.breadthUp}/{t.breadthTotal}
                </span>
              </div>

              {/* Hot icon */}
              <div className="w-5 shrink-0 flex justify-center">
                {isHot && (
                  <Zap size={12} className="text-[#00f5c4] opacity-60" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
