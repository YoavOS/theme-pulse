import { useMemo, useState, useCallback } from "react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals } from "@/hooks/useVolumeData";

const DM_MONO = "'DM Mono', monospace";
const TOOLTIP_WIDTH = 220;
const TOOLTIP_HEIGHT = 120;

interface TooltipPosition {
  x: number;
  y: number;
}

function getHeatColor(pct: number): string {
  if (pct > 4) return "hsl(170, 90%, 45%)";
  if (pct > 2) return "hsl(170, 70%, 35%)";
  if (pct > 0.5) return "hsl(170, 50%, 25%)";
  if (pct >= -0.5) return "hsl(220, 10%, 18%)";
  if (pct >= -2) return "hsl(30, 60%, 25%)";
  if (pct >= -4) return "hsl(15, 70%, 30%)";
  return "hsl(0, 70%, 35%)";
}

function truncateThemeName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length <= 2) return name;
  return words.slice(0, 2).join(" ");
}

function getPerfColor(pct: number) {
  if (pct > 0.1) return "#00ff88";
  if (pct < -0.1) return "#ff4466";
  return "#9ca3af";
}

function getBreadthColor(pct: number) {
  if (pct >= 70) return "#00ff88";
  if (pct >= 40) return "#f59e0b";
  return "#ff4466";
}

function getRelVolColor(val: number) {
  if (val >= 2.0) return "#00ff88";
  if (val >= 1.2) return "#22c55e";
  if (val >= 0.8) return "#9ca3af";
  return "#f59e0b";
}

function getSustainedVolColor(val: number) {
  if (val >= 15) return "#00ff88";
  if (val >= 5) return "#22c55e";
  if (val >= -5) return "#9ca3af";
  if (val >= -15) return "#f59e0b";
  return "#ff4466";
}

export default function HeatmapGridView({
  themes,
  onCardClick,
  getThemeSignals,
  dimmedThemes,
}: {
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  dimmedThemes?: Set<string> | null;
}) {
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);

  const sorted = useMemo(() => {
    return [...themes].sort((a, b) => b.performance_pct - a.performance_pct);
  }, [themes]);

  const handleMouseMove = useCallback((e: React.MouseEvent, themeName: string) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Get header height dynamically (fallback to 120 if not found)
    const headerHeight = document.querySelector('.dashboard-header')?.getBoundingClientRect().height ?? 120;

    // Smart vertical positioning - check if tooltip would be behind header
    const spaceAbove = mouseY - headerHeight;
    const spaceBelow = window.innerHeight - mouseY;
    
    let tooltipY: number;
    if (spaceAbove < TOOLTIP_HEIGHT + 20) {
      // Not enough space above (would be behind header), show below
      tooltipY = mouseY + 15;
    } else if (spaceBelow < TOOLTIP_HEIGHT + 20) {
      // Not enough space below, show above
      tooltipY = mouseY - TOOLTIP_HEIGHT - 10;
    } else {
      // Prefer above by default
      tooltipY = mouseY - TOOLTIP_HEIGHT - 10;
    }

    // Smart horizontal positioning
    const spaceRight = window.innerWidth - mouseX;
    const tooltipX = spaceRight < TOOLTIP_WIDTH + 20 ? mouseX - TOOLTIP_WIDTH - 10 : mouseX + 15;

    // Clamp to viewport (but never behind header)
    const clampedX = Math.max(10, Math.min(tooltipX, window.innerWidth - TOOLTIP_WIDTH - 10));
    const clampedY = Math.max(headerHeight + 10, Math.min(tooltipY, window.innerHeight - TOOLTIP_HEIGHT - 10));

    setHoveredTheme(themeName);
    setTooltipPos({ x: clampedX, y: clampedY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredTheme(null);
    setTooltipPos(null);
  }, []);

  return (
    <div>
      {/* Color legend */}
      <div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground px-1" style={{ fontFamily: DM_MONO }}>
        <span>Strong ↓</span>
        <div className="flex h-3 flex-1 max-w-[200px] rounded overflow-hidden">
          {[
            "hsl(0, 70%, 35%)",
            "hsl(15, 70%, 30%)",
            "hsl(30, 60%, 25%)",
            "hsl(220, 10%, 18%)",
            "hsl(170, 50%, 25%)",
            "hsl(170, 70%, 35%)",
            "hsl(170, 90%, 45%)",
          ].map((c, i) => (
            <div key={i} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <span>↑ Strong</span>
      </div>

      {/* Grid */}
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
        {sorted.map((t) => {
          const isDimmed = dimmedThemes ? !dimmedThemes.has(t.theme_name.toLowerCase()) : false;
          const isHovered = hoveredTheme === t.theme_name;
          const validTickers = t.tickers.filter(tk => !tk.skipped);
          const total = validTickers.length;
          const up = validTickers.filter(tk => tk.pct > 0).length;
          const breadthPct = total > 0 ? Math.round((up / total) * 100) : 0;
          const symbols = t.tickers.map(tk => tk.symbol);
          const signals = getThemeSignals ? getThemeSignals(symbols) : null;
          const sign = t.performance_pct >= 0 ? "+" : "";

          return (
            <div
              key={t.theme_name}
              className="relative rounded cursor-pointer transition-all hover:ring-1 hover:ring-primary/40 hover:z-10"
              style={{
                background: getHeatColor(t.performance_pct),
                minHeight: 80,
                opacity: isDimmed ? 0.3 : 1,
                filter: isDimmed ? "grayscale(60%)" : undefined,
              }}
              onClick={() => onCardClick?.(t)}
              onMouseMove={(e) => handleMouseMove(e, t.theme_name)}
              onMouseLeave={handleMouseLeave}
            >
              <div className="flex flex-col items-center justify-center h-full p-1.5 text-center">
                <span className="text-[10px] font-medium text-white/70 leading-tight line-clamp-1">
                  {truncateThemeName(t.theme_name)}
                </span>
                <span
                  className="text-sm font-bold text-white mt-0.5"
                  style={{ fontFamily: DM_MONO }}
                >
                  {sign}{t.performance_pct.toFixed(1)}%
                </span>
              </div>

              {/* Fixed position tooltip */}
              {isHovered && tooltipPos && (
                <div
                  className="fixed z-[100] rounded-lg px-3 py-2 text-xs shadow-xl whitespace-nowrap pointer-events-none"
                  style={{
                    background: "rgba(10,10,15,0.95)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    backdropFilter: "blur(16px)",
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    minWidth: TOOLTIP_WIDTH,
                  }}
                >
                  <div className="font-['Syne',sans-serif] font-semibold text-foreground text-sm">{t.theme_name}</div>
                  <div className="mt-1 space-y-0.5 text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                    <div>Perf: <span className={t.performance_pct >= 0 ? "text-primary" : "text-destructive"}>{sign}{t.performance_pct.toFixed(2)}%</span></div>
                    <div>Breadth: {breadthPct}% ({up}/{total})</div>
                    {signals?.relVol != null && <div>Rel Vol: {signals.relVol.toFixed(1)}×</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}