import type { ThemeData } from "@/data/themeData";

/**
 * Heatmap display for the Tracker: the same group averages as the bar list, drawn as tiles.
 * Colors are scaled to the timeframe (a 3-month move and a 1-day move use different ranges).
 */

const UP = "166, 85%, 40%";
const DOWN = "344, 85%, 58%";

/** Fill for a value on a ±scale range: faint near zero, saturated at the ends. */
export function heatFill(v: number, scale: number) {
  const t = Math.min(1, Math.abs(v) / (scale || 1));
  if (Math.abs(v) < scale * 0.03) return "hsl(220, 10%, 20%)";
  return `hsla(${v >= 0 ? UP : DOWN}, ${0.18 + 0.72 * Math.sqrt(t)})`;
}

const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const breadth = (r: ThemeData) => {
  const valid = r.valid_count ?? r.up_count + r.down_count;
  return { valid, pct: valid ? Math.round((r.up_count / valid) * 100) : 0 };
};

/** Equal-size tiles, strongest first, so the ranking still reads left to right. */
export function HeatTiles({ rows, scale, onOpen }: { rows: ThemeData[]; scale: number; onOpen: (t: ThemeData) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {rows.map((r) => {
        const b = breadth(r);
        return (
          <button
            key={r.theme_name}
            onClick={() => onOpen(r)}
            title={`${r.theme_name}: ${fmt(r.performance_pct)} · ${r.up_count} of ${b.valid} stocks up — click to open`}
            className="flex min-h-[74px] flex-col justify-between rounded-md p-2 text-left text-white ring-inset transition hover:ring-1 hover:ring-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ background: heatFill(r.performance_pct, scale) }}
          >
            <span className="line-clamp-2 text-[11.5px] font-medium leading-tight">{r.theme_name}</span>
            <span className="flex items-end justify-between gap-1">
              <span className="font-mono text-[15px] font-semibold tabular-nums">{fmt(r.performance_pct)}</span>
              <span className="font-mono text-[10px] opacity-75">{r.up_count}/{b.valid}↑</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Color legend for the tile displays. */
export function HeatLegend({ scale }: { scale: number }) {
  const steps = [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1];
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
      <span>−{scale}%</span>
      <span className="flex overflow-hidden rounded-sm">
        {steps.map((s) => <span key={s} className="h-2 w-5" style={{ background: heatFill(s * scale, scale) }} />)}
      </span>
      <span>+{scale}%</span>
    </div>
  );
}
