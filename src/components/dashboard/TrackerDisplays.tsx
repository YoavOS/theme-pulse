import { useMemo } from "react";
import type { ThemeData } from "@/data/themeData";

/**
 * Alternative displays for the Tracker: the same group averages as the bar list,
 * drawn as a heatmap of tiles or as a treemap sized by how many stocks each group holds.
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

interface Rect { x: number; y: number; w: number; h: number }
/** Squarified treemap (Bruls, Huizing & van Wijk) on a W×H box; values must be positive. */
function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const area = box.w * box.h;
  const items = values.map((v, i) => ({ i, a: (v / total) * area }));
  const out: Rect[] = new Array(values.length);
  let rect = { ...box };
  let row: { i: number; a: number }[] = [];
  const worst = (r: { a: number }[], side: number) => {
    const s = r.reduce((t, x) => t + x.a, 0), mx = Math.max(...r.map((x) => x.a)), mn = Math.min(...r.map((x) => x.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layout = (r: { i: number; a: number }[]) => {
    const s = r.reduce((t, x) => t + x.a, 0);
    if (rect.w >= rect.h) {
      const w = s / rect.h; let y = rect.y;
      for (const x of r) { const h = x.a / w; out[x.i] = { x: rect.x, y, w, h }; y += h; }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = s / rect.w; let x0 = rect.x;
      for (const x of r) { const w = x.a / h; out[x.i] = { x: x0, y: rect.y, w, h }; x0 += w; }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };
  for (const it of items) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else { layout(row); row = [it]; }
  }
  if (row.length) layout(row);
  return out;
}

/** Treemap: tile area = stocks in the group, color = the group's average move. */
export function TreemapView({ rows, scale, onOpen }: { rows: ThemeData[]; scale: number; onOpen: (t: ThemeData) => void }) {
  const W = 1000, H = 560;
  const sorted = useMemo(() => [...rows].sort((a, b) => breadth(b).valid - breadth(a).valid), [rows]);
  const rects = useMemo(() => squarify(sorted.map((r) => Math.max(1, breadth(r).valid)), { x: 0, y: 0, w: W, h: H }), [sorted]);
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-muted/20" style={{ aspectRatio: `${W} / ${H}`, minHeight: 320 }}>
      {sorted.map((r, k) => {
        const q = rects[k];
        if (!q || q.w <= 0 || q.h <= 0) return null;
        const big = q.w > 90 && q.h > 46, mid = q.w > 55 && q.h > 26;
        const b = breadth(r);
        return (
          <button
            key={r.theme_name}
            onClick={() => onOpen(r)}
            title={`${r.theme_name}: ${fmt(r.performance_pct)} · ${b.valid} stocks, ${b.pct}% up — click to open`}
            className="absolute overflow-hidden border border-background/80 p-1.5 text-left text-white transition hover:z-10 hover:outline hover:outline-1 hover:outline-white/70 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            style={{ left: `${(q.x / W) * 100}%`, top: `${(q.y / H) * 100}%`, width: `${(q.w / W) * 100}%`, height: `${(q.h / H) * 100}%`, background: heatFill(r.performance_pct, scale) }}
          >
            {mid && <span className={`block truncate font-medium leading-tight ${big ? "text-[12px]" : "text-[10px]"}`}>{r.theme_name}</span>}
            {mid && <span className={`block font-mono tabular-nums ${big ? "text-[13px] font-semibold" : "text-[10px]"}`}>{fmt(r.performance_pct)}</span>}
            {big && <span className="block font-mono text-[10px] opacity-75">{b.valid} stocks · {b.pct}% up</span>}
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
