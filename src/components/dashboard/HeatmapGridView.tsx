import { useMemo, useState, useCallback } from "react";
import { Info } from "lucide-react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals, TickerVolume } from "@/hooks/useVolumeData";

const DM_MONO = "'DM Mono', monospace";
const TOOLTIP_WIDTH = 280;
const TOOLTIP_HEIGHT = 230;

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

/** Full names wrap onto up to 3 lines; only very long names are shortened. */
function truncateThemeName(name: string): string {
  return name.length > 48 ? name.slice(0, 47).trimEnd() + "…" : name;
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
  onInfoClick,
  getThemeSignals,
  volumeMap,
  dimmedThemes,
}: {
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  onInfoClick?: (theme: ThemeData) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  volumeMap?: Record<string, TickerVolume>;
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
      <div
        className="grid gap-1"
        // 8 columns on wide screens; fewer, wider tiles on narrow ones so names stay readable.
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(104px, calc((100% - 28px) / 8)), 1fr))" }}
      >
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

          // Top 3 movers by absolute performance — uses cached data only.
          const topMovers = isHovered
            ? [...validTickers]
                .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
                .slice(0, 3)
                .map(tk => {
                  const v = volumeMap?.[tk.symbol];
                  const relVol = v && v.avg_20d > 0 && v.today_vol > 0 ? v.today_vol / v.avg_20d : null;
                  return { symbol: tk.symbol, pct: tk.pct, relVol };
                })
            : [];
          const leader = topMovers[0] ?? null;

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
                <span className="text-[10px] font-medium text-white/70 leading-tight line-clamp-3 [overflow-wrap:anywhere]" title={t.theme_name}>
                  {truncateThemeName(t.theme_name)}
                </span>
                <span
                  className="text-sm font-bold text-white mt-0.5"
                  style={{ fontFamily: DM_MONO }}
                >
                  {sign}{t.performance_pct.toFixed(1)}%
                </span>
              </div>

              {/* "i" Info button — opens the Theme Momentum Index slide-in */}
              {onInfoClick && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInfoClick(t);
                  }}
                  className="absolute top-0.5 right-0.5 z-20 rounded p-0.5 text-white/55 hover:text-white hover:bg-white/15 transition-colors"
                  title="Theme Strength Meter"
                  aria-label={`Open Theme Strength Meter for ${t.theme_name}`}
                >
                  <Info size={11} />
                </button>
              )}

              {/* Fixed position tooltip */}
              {isHovered && tooltipPos && (
                <div
                  className="fixed z-[100] rounded-lg px-3 py-2.5 text-xs shadow-xl pointer-events-none"
                  style={{
                    background: "rgba(10,10,15,0.96)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    backdropFilter: "blur(16px)",
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    width: TOOLTIP_WIDTH,
                  }}
                >
                  <div className="font-['Syne',sans-serif] font-semibold text-foreground text-sm truncate">{t.theme_name}</div>
                  {leader && (
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground truncate" style={{ fontFamily: DM_MONO }}>
                      Led by <span className="text-foreground font-semibold">{leader.symbol}</span>{" "}
                      <span style={{ color: getPerfColor(leader.pct) }}>
                        {leader.pct >= 0 ? "+" : ""}{leader.pct.toFixed(2)}%
                      </span>
                    </div>
                  )}
                  <div className="mt-1.5 space-y-0.5" style={{ fontFamily: DM_MONO }}>
                    <div className="text-muted-foreground">Perf: <span style={{ color: getPerfColor(t.performance_pct) }}>{sign}{t.performance_pct.toFixed(2)}%</span></div>
                    <div className="text-muted-foreground">Breadth: <span style={{ color: getBreadthColor(breadthPct) }}>{breadthPct}%</span> ({up}/{total})</div>
                    <div className="text-muted-foreground">Rel Vol: {signals?.relVol != null ? <span style={{ color: getRelVolColor(signals.relVol) }}>{signals.relVol.toFixed(1)}×</span> : "—"}</div>
                    <div className="text-muted-foreground">Sustained Vol: {signals?.sustainedVol != null ? <span style={{ color: getSustainedVolColor(signals.sustainedVol) }}>{signals.sustainedVol >= 0 ? "+" : ""}{signals.sustainedVol.toFixed(0)}%</span> : "—"}</div>
                  </div>
                  {topMovers.length > 0 && (
                    <div className="mt-2 pt-1.5 border-t border-white/10">
                      <div className="text-[9.5px] uppercase tracking-widest text-muted-foreground mb-1" style={{ fontFamily: DM_MONO }}>Top Movers</div>
                      <div className="space-y-0.5" style={{ fontFamily: DM_MONO }}>
                        {topMovers.map((m, i) => (
                          <div key={m.symbol} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className={`font-semibold truncate ${i === 0 ? "text-[#00f5c4]" : "text-foreground/90"}`}>{m.symbol}</span>
                            <span className="flex items-center gap-2 tabular-nums">
                              <span style={{ color: getPerfColor(m.pct) }}>
                                {m.pct >= 0 ? "+" : ""}{m.pct.toFixed(2)}%
                              </span>
                              {m.relVol != null && m.relVol >= 1.2 && (
                                <span style={{ color: getRelVolColor(m.relVol) }}>{m.relVol.toFixed(1)}×</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}