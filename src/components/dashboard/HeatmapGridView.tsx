import { useMemo, useState, useCallback } from "react";
import { Info } from "lucide-react";
import { ThemeData } from "@/data/themeData";
import { ThemeDemandSignals, TickerVolume } from "@/hooks/useVolumeData";
import {
  groupVolume, readBreadth, volumeBasisFor, BREADTH_LABEL, BREADTH_HELP,
  type BreadthKind, type VolumeStrength,
} from "@/lib/groupSignals";
import VolumeBar from "@/components/dashboard/VolumeBar";

type BreadthFilter = "all" | "broad-up" | "narrow-up" | "broad-down";
const FILTERS: { key: BreadthFilter; label: string; tip: string }[] = [
  { key: "all", label: "All", tip: "Show every group" },
  { key: "broad-up", label: "Broad rallies", tip: BREADTH_HELP["broad-up"] },
  { key: "narrow-up", label: "Led by a few", tip: BREADTH_HELP["narrow-up"] },
  { key: "broad-down", label: "Broad selling", tip: BREADTH_HELP["broad-down"] },
];


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
  timeframe = "Today",
}: {
  themes: ThemeData[];
  onCardClick?: (theme: ThemeData) => void;
  onInfoClick?: (theme: ThemeData) => void;
  getThemeSignals?: (symbols: string[]) => ThemeDemandSignals;
  volumeMap?: Record<string, TickerVolume>;
  dimmedThemes?: Set<string> | null;
  timeframe?: string;
}) {
  const [breadthFilter, setBreadthFilter] = useState<BreadthFilter>("all");
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);

  const sorted = useMemo(() => {
    return [...themes].sort((a, b) => b.performance_pct - a.performance_pct);
  }, [themes]);

  // Breadth read + volume strength per group (median stock, so one outlier can't dominate).
  const signals = useMemo(() => {
    const m = new Map<string, { breadth: ReturnType<typeof readBreadth>; vol: VolumeStrength | null }>();
    for (const t of themes) {
      const valid = t.tickers.filter(tk => !tk.skipped);
      m.set(t.theme_name, {
        breadth: readBreadth(valid.map(tk => tk.pct), t.performance_pct),
        vol: groupVolume(valid.map(tk => tk.symbol), volumeMap, timeframe),
      });
    }
    return m;
  }, [themes, volumeMap, timeframe]);

  const summary = useMemo(() => {
    let groupsUp = 0, stocksUp = 0, stocks = 0;
    const counts: Record<BreadthKind, number> = { "broad-up": 0, "narrow-up": 0, "broad-down": 0, "narrow-down": 0, mixed: 0 };
    for (const t of themes) {
      if (t.performance_pct > 0) groupsUp++;
      const b = signals.get(t.theme_name)?.breadth;
      if (!b) continue;
      stocksUp += b.up; stocks += b.total;
      if (b.kind) counts[b.kind]++;
    }
    return { groupsUp, stocksPct: stocks ? Math.round((stocksUp / stocks) * 100) : 0, counts };
  }, [themes, signals]);
  const hasVolume = useMemo(() => [...signals.values()].some(x => x.vol), [signals]);
  const volBasis = volumeBasisFor(timeframe);

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
        {hasVolume && (
          <span className="ml-3 hidden sm:inline-flex items-center gap-1.5" title={volBasis === "today" ? "Bar at the bottom of each box: today's volume vs its 20-day average (median stock). The tick marks normal volume; a full bar is 3× or more." : "Bar at the bottom of each box: the last 2 weeks' volume vs the 3-month average (median stock). The tick marks normal; a full bar is 3× or more."}>
            <span className="relative inline-block h-[3px] w-10 rounded-full bg-white/15">
              <span className="absolute inset-y-0 left-0 w-[60%] rounded-full bg-white/75" />
              <span className="absolute -top-[2px] h-[7px] w-px bg-white/60" style={{ left: "33.333%" }} />
            </span>
            {volBasis === "today" ? "Volume vs 20-day avg" : "2-week volume vs 3-month avg"} · tick = normal
          </span>
        )}
      </div>

      {/* Breadth: how many groups / stocks are rising, and which moves are broad vs carried by a few */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <span className="text-[11px] text-muted-foreground">
          <span className="text-foreground font-medium">{summary.groupsUp}</span> of {themes.length} groups up ·{" "}
          <span className="text-foreground font-medium">{summary.stocksPct}%</span> of their stocks rising
        </span>
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5" role="group" aria-label="Breadth filter">
          {FILTERS.map(f => {
            const n = f.key === "all" ? null : summary.counts[f.key];
            const on = breadthFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                title={f.tip}
                aria-pressed={on}
                onClick={() => setBreadthFilter(f.key)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {f.label}{n !== null && <span className="ml-1 opacity-70" style={{ fontFamily: DM_MONO }}>{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid gap-1"
        // 8 columns on wide screens; fewer, wider tiles on narrow ones so names stay readable.
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(104px, calc((100% - 28px) / 8)), 1fr))" }}
      >
        {sorted.map((t) => {
          const sig = signals.get(t.theme_name);
          const kind = sig?.breadth.kind ?? null;
          const isDimmed = (dimmedThemes ? !dimmedThemes.has(t.theme_name.toLowerCase()) : false)
            || (breadthFilter !== "all" && kind !== breadthFilter);
          const isHovered = hoveredTheme === t.theme_name;
          const validTickers = t.tickers.filter(tk => !tk.skipped);
          const total = validTickers.length;
          const up = validTickers.filter(tk => tk.pct > 0).length;
          const breadthPct = total > 0 ? Math.round((up / total) * 100) : 0;
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
              <div className={`flex flex-col items-center justify-center h-full p-1.5 text-center ${sig?.vol ? "pb-4" : ""}`}>
                <span className="text-[10px] font-medium text-white/70 leading-tight line-clamp-3 [overflow-wrap:anywhere]" title={t.theme_name}>
                  {truncateThemeName(t.theme_name)}
                </span>
                <span
                  className="text-sm font-bold text-white mt-0.5"
                  style={{ fontFamily: DM_MONO }}
                >
                  {sign}{t.performance_pct.toFixed(1)}%
                </span>
                {(total > 0 || sig?.vol) && (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-white/65 tabular-nums" style={{ fontFamily: DM_MONO }}>
                    {total > 0 && <span title={`${up} of ${total} stocks up`}>{up}/{total} up</span>}
                    {sig?.vol && <span title="Volume vs normal (median stock)">· {sig.vol.ratio.toFixed(1)}×</span>}
                  </span>
                )}
              </div>
              {sig?.vol && <VolumeBar v={sig.vol} />}

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
                    {kind && <div className="text-muted-foreground">Read: <span className="text-foreground">{BREADTH_LABEL[kind]}</span></div>}
                    {sig?.breadth.medianPct != null && <div className="text-muted-foreground">Typical stock: <span style={{ color: getPerfColor(sig.breadth.medianPct) }}>{sig.breadth.medianPct >= 0 ? "+" : ""}{sig.breadth.medianPct.toFixed(2)}%</span></div>}
                    <div className="text-muted-foreground">Volume: {sig?.vol ? <span style={{ color: getRelVolColor(sig.vol.ratio) }}>{sig.vol.ratio.toFixed(1)}× {sig.vol.basis === "today" ? "20-day avg" : "3-month avg (2 wk)"}</span> : "—"}</div>
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