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

export default function VolumeLeaders({ themes, onSelectTheme }: VolumeLeadersProps) {
  const leaders = useMemo(() => {
    return themes
      .filter(t => t.avgRelVol !== null)
      .sort((a, b) => (b.avgRelVol ?? 0) - (a.avgRelVol ?? 0))
      .slice(0, 5);
  }, [themes]);

  if (leaders.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Zap size={12} className="text-[#00f5c4]" />
        <span
          className="text-[11px] font-semibold uppercase tracking-widest text-[#00f5c4]"
          style={{ fontFamily: "'Syne', sans-serif" }}
        >
          Volume Leaders
        </span>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${leaders.length}, 1fr)` }}>
        {leaders.map(t => {
          const isHot = (t.avgRelVol ?? 0) > 1.8;
          return (
            <button
              key={t.themeId}
              onClick={() => onSelectTheme(t.themeId)}
              className="relative overflow-hidden rounded-lg p-3 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(12px)",
              }}
            >
              {/* Hot watermark */}
              {isHot && (
                <Zap
                  size={48}
                  className="absolute -right-2 -bottom-2 opacity-[0.04] pointer-events-none"
                  style={{ color: "#00f5c4" }}
                />
              )}

              {/* Theme name */}
              <div
                className="font-semibold text-foreground text-[12px] leading-tight truncate mb-2"
                style={{ fontFamily: "'Syne', sans-serif" }}
              >
                {t.themeName}
              </div>

              {/* Rel Vol hero */}
              <div className="flex items-baseline gap-0.5 mb-1">
                <span
                  className="text-xl font-bold leading-none"
                  style={{ fontFamily: DM_MONO, color: getRelVolColor(t.avgRelVol!) }}
                >
                  {t.avgRelVol!.toFixed(1)}×
                </span>
              </div>

              {/* Sustained Vol */}
              <div className="flex items-center gap-2 mt-1.5">
                {t.sustainedVol !== null && (
                  <span
                    className="text-[11px] font-medium"
                    style={{ fontFamily: DM_MONO, color: sustainedColor(t.sustainedVol) }}
                  >
                    {t.sustainedVol > 0 ? "+" : ""}{t.sustainedVol.toFixed(0)}% sus
                  </span>
                )}
              </div>

              {/* Bottom row: 1D perf + breadth */}
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[rgba(255,255,255,0.06)]">
                <span
                  className="text-[11px] font-medium"
                  style={{ fontFamily: DM_MONO, color: perfColor(t.perf_1d) }}
                >
                  {t.perf_1d > 0 ? "+" : ""}{t.perf_1d.toFixed(2)}%
                </span>
                <span
                  className="text-[10px] text-muted-foreground"
                  style={{ fontFamily: DM_MONO }}
                >
                  {t.breadthUp}/{t.breadthTotal}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
