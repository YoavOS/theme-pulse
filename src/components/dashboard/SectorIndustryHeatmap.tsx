import { useMemo } from "react";
import type { ThemeData } from "@/data/themeData";
import { heatFill } from "@/components/dashboard/TrackerDisplays";

/**
 * Sector + Industry heatmap: one row per sector (ranked by its stock-weighted average move),
 * its industries as tiles inside the row, tile width by how many stocks the industry holds.
 * Click a sector name for all of its stocks, a tile for that industry's.
 */

export interface SectorBlock { name: string; avg: number; stocks: number; up: number; industries: ThemeData[]; theme: ThemeData }

const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const validOf = (t: ThemeData) => t.valid_count ?? t.up_count + t.down_count;

/** Groups industry rows under their sector; sectors and the industries inside them strongest first. */
export function buildSectorBlocks(industries: ThemeData[], sectorOf: (industry: string) => string): SectorBlock[] {
  const m = new Map<string, ThemeData[]>();
  for (const t of industries) {
    const s = sectorOf(t.theme_name);
    m.set(s, [...(m.get(s) ?? []), t]);
  }
  const out: SectorBlock[] = [];
  m.forEach((inds, name) => {
    const stocks = inds.reduce((a, t) => a + validOf(t), 0);
    if (!stocks) return;
    const avg = inds.reduce((a, t) => a + t.performance_pct * validOf(t), 0) / stocks;
    const up = inds.reduce((a, t) => a + t.up_count, 0);
    const tickers = inds.flatMap((t) => t.tickers).sort((a, b) => Number(!!a.skipped) - Number(!!b.skipped) || b.pct - a.pct);
    out.push({
      name, avg, stocks, up,
      industries: [...inds].sort((a, b) => b.performance_pct - a.performance_pct),
      theme: {
        theme_name: name, performance_pct: Math.round(avg * 100) / 100, up_count: up, down_count: stocks - up,
        na_count: inds.reduce((a, t) => a + (t.na_count ?? 0), 0), valid_count: stocks, tickers, dataSource: "real",
      },
    });
  });
  return out.sort((a, b) => b.avg - a.avg);
}

/** A readable color range for the current numbers (1-day moves and 3-month moves differ a lot). */
export function heatScale(values: number[]) {
  const a = values.map(Math.abs).sort((x, y) => x - y);
  const p90 = a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : 1;
  const steps = [0.5, 1, 1.5, 2, 3, 4, 5, 8, 10, 15, 20, 30, 50, 100];
  return steps.find((s) => s >= p90) ?? 100;
}

export default function SectorIndustryHeatmap({ industries, sectorOf, onOpen, label = "%" }: {
  industries: ThemeData[];
  sectorOf: (industry: string) => string;
  onOpen: (t: ThemeData) => void;
  label?: string;
}) {
  const blocks = useMemo(() => buildSectorBlocks(industries, sectorOf), [industries, sectorOf]);
  const scale = useMemo(() => heatScale(industries.map((t) => t.performance_pct)), [industries]);
  if (!blocks.length) return <div className="py-10 text-center text-sm text-muted-foreground">No industry data yet — run a Full Scan.</div>;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-end gap-1.5 font-mono text-[10px] text-muted-foreground">
        <span>−{scale}{label}</span>
        <span className="flex overflow-hidden rounded-sm">
          {[-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1].map((s) => <span key={s} className="h-2 w-5" style={{ background: heatFill(s * scale, scale) }} />)}
        </span>
        <span>+{scale}{label}</span>
      </div>
      {blocks.map((b) => (
        <div key={b.name} className="grid grid-cols-1 gap-1.5 border-b border-border/40 pb-1.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-2.5">
          <button
            onClick={() => onOpen(b.theme)}
            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/40 sm:flex-col sm:items-start sm:justify-center"
            title={`${b.name}: all ${b.stocks} stocks — click to open`}
          >
            <span className="text-[12.5px] font-semibold leading-tight">{b.name}</span>
            <span className="flex items-baseline gap-2">
              <span className={`font-mono text-xs font-semibold ${b.avg > 0.005 ? "text-[hsl(166,100%,42%)]" : b.avg < -0.005 ? "text-[hsl(344,100%,65%)]" : "text-muted-foreground"}`}>{fmt(b.avg)}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{b.stocks} stocks · {Math.round((b.up / b.stocks) * 100)}% up</span>
            </span>
          </button>
          <div className="flex flex-wrap gap-1">
            {b.industries.map((t) => {
              const n = validOf(t);
              return (
                <button
                  key={t.theme_name}
                  onClick={() => onOpen(t)}
                  title={`${t.theme_name}: ${fmt(t.performance_pct)} · ${t.up_count} of ${n} stocks up — click to open`}
                  className="flex h-[58px] min-w-0 flex-col justify-between rounded-md px-2 py-1.5 text-left text-white ring-inset transition hover:ring-1 hover:ring-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ flex: `${Math.max(1, n)} 1 ${Math.min(220, 96 + n * 3)}px`, background: heatFill(t.performance_pct, scale) }}
                >
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight">{t.theme_name}</span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="font-mono text-[13px] font-semibold tabular-nums">{fmt(t.performance_pct)}</span>
                    <span className="font-mono text-[9.5px] opacity-75">{t.up_count}/{n}↑</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
