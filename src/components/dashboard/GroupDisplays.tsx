import { useState, type ReactNode } from "react";
import type { ThemeData } from "@/data/themeData";
import { buildSectorBlocks } from "@/components/dashboard/SectorIndustryHeatmap";
import { fmtPct, niceMax } from "@/lib/groupDisplay";

/**
 * Shared displays for any ranked list of groups (themes, industries, sectors…):
 *  • GroupBars  — one diverging bar per group, strongest first (the Tracker's bars).
 *  • GroupCards — two-column tinted cards with the name and the move (Deepvue's Theme Tracker look).
 * Both accept a Sector + Industry mapping, which groups the industries under their sector.
 */

export const UP = "hsl(166, 100%, 42%)";
export const DOWN = "hsl(344, 100%, 65%)";
const UP_RGB = "166, 100%, 42%";
const DOWN_RGB = "344, 100%, 65%";

const toneClass = (v: number) => (v > 0 ? "text-[hsl(166,100%,42%)]" : v < 0 ? "text-[hsl(344,100%,65%)]" : "text-muted-foreground");
const validOf = (r: ThemeData) => r.valid_count ?? r.up_count + r.down_count;

/* ───────────────────────────── Bars ───────────────────────────── */

const BAR_GRID = "grid w-full grid-cols-[120px_1fr_60px] items-center gap-2.5 rounded-md px-1 py-[3px] text-left hover:bg-accent/40 sm:grid-cols-[190px_1fr_64px_70px]";

/** One bar row. `value` overrides the group's own move (e.g. the Combined view's since-open). */
export function BarRow({ r, scale, onOpen, strong = false, indent = false, value, marker, right, title }: {
  r: ThemeData; scale: number; onOpen: (t: ThemeData) => void; strong?: boolean; indent?: boolean;
  value?: number;
  /** A thin tick on the bar (e.g. where the group opened). */
  marker?: { v: number; title: string };
  /** Right-hand column; defaults to breadth (stocks up / with data). */
  right?: ReactNode;
  title?: string;
}) {
  const v = value ?? r.performance_pct, w = Math.min(50, (Math.abs(v) / scale) * 50), valid = validOf(r);
  const a = strong || !indent ? 1 : 0.75;
  return (
    <button onClick={() => onOpen(r)} className={BAR_GRID}
      title={title ?? `${r.theme_name}: ${fmtPct(v)} average of ${valid} stock${valid === 1 ? "" : "s"}${r.na_count ? ` (${r.na_count} without data)` : ""} — click to open`}>
      <span className={`truncate text-xs ${strong ? "font-semibold" : indent ? "font-medium text-foreground/85" : "font-medium"} ${indent ? "pl-3" : ""}`}>{r.theme_name}</span>
      <span className={`relative rounded-[3px] bg-muted/40 ${strong ? "h-3.5" : indent ? "h-2.5" : "h-3"}`}>
        <span className="absolute -bottom-[3px] -top-[3px] left-1/2 w-px bg-border" />
        <span className="absolute bottom-0 top-0 rounded-[3px]"
          style={v >= 0 ? { left: "50%", width: `${w}%`, background: `hsla(${UP_RGB}, ${a})` } : { right: "50%", width: `${w}%`, background: `hsla(${DOWN_RGB}, ${a})` }} />
        {marker && (
          <span title={marker.title} className="absolute -bottom-[4px] -top-[4px] w-[2px] rounded bg-foreground/80"
            style={{ left: `calc(${50 + Math.max(-50, Math.min(50, (marker.v / scale) * 50))}% - 1px)` }} />
        )}
      </span>
      <span className={`text-right font-mono text-xs ${strong ? "font-semibold" : ""} ${toneClass(v)}`}>{fmtPct(v)}</span>
      <span className="hidden text-right font-mono text-[10.5px] text-muted-foreground sm:block" title={right ? undefined : "Breadth: stocks up / stocks with data"}>
        {right ?? <>{r.up_count}/{valid} ↑</>}
      </span>
    </button>
  );
}

/** Scale header above a bar list. */
export function BarScale({ scale, right }: { scale: number; right?: string }) {
  return (
    <div className="mb-0.5 grid grid-cols-[120px_1fr_60px] gap-2.5 px-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-[190px_1fr_64px_70px]">
      <span />
      <span className="flex justify-between"><span>−{scale}%</span><span>0</span><span>+{scale}%</span></span>
      <span />
      <span className="hidden text-right sm:block">{right ?? ""}</span>
    </div>
  );
}

/** Every group as one bar, strongest first. Long lists can show the top and bottom 15 only. */
export function GroupBars({ rows, onOpen, sectorOf, showAll: showAllProp, onShowAll, value, marker, right, title }: {
  rows: ThemeData[];
  onOpen: (t: ThemeData) => void;
  sectorOf?: (industry: string) => string;
  /** Controlled "show all"; when left out the list keeps its own state. */
  showAll?: boolean;
  onShowAll?: (v: boolean) => void;
  value?: (r: ThemeData) => number;
  marker?: (r: ThemeData) => { v: number; title: string } | undefined;
  right?: (r: ThemeData) => ReactNode;
  title?: (r: ThemeData) => string;
}) {
  const [own, setOwn] = useState(true);
  const showAll = showAllProp ?? own;
  const setShowAll = onShowAll ?? setOwn;
  const val = value ?? ((r: ThemeData) => r.performance_pct);
  const sorted = [...rows].sort((a, b) => val(b) - val(a));
  const long = sorted.length > 30 && !sectorOf;
  const shown = long && !showAll ? [...sorted.slice(0, 15), ...sorted.slice(-15)] : sorted;
  const scale = niceMax(Math.max(0, ...shown.map((r) => Math.abs(val(r))), ...(marker ? shown.map((r) => Math.abs(marker(r)?.v ?? 0)) : [])));
  const rowProps = (r: ThemeData) => ({ value: value ? val(r) : undefined, marker: marker?.(r), right: right?.(r), title: title?.(r) });

  if (sectorOf) {
    return (
      <div className="space-y-2">
        <BarScale scale={scale} />
        {buildSectorBlocks(rows, sectorOf).map((b) => (
          <div key={b.name} className="rounded-md border border-border/50 bg-background/30 px-1.5 py-1">
            <BarRow r={b.theme} scale={scale} onOpen={onOpen} strong />
            {b.industries.map((r) => <BarRow key={r.theme_name} r={r} scale={scale} onOpen={onOpen} indent {...rowProps(r)} />)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <BarScale scale={scale} />
      {shown.map((r, i) => (
        <div key={r.theme_name}>
          {long && !showAll && i === 15 && <div className="my-1 border-t border-dashed border-border text-center text-[10px] text-muted-foreground">⋯</div>}
          <BarRow r={r} scale={scale} onOpen={onOpen} {...rowProps(r)} />
        </div>
      ))}
      {long && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
          {showAll ? "Top & bottom 15" : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── Cards ───────────────────────────── */

/** One tinted card: name on the left, the move on the right. */
export function GroupCard({ r, onOpen, value, sub, strong = false, title }: {
  r: ThemeData; onOpen: (t: ThemeData) => void; value?: number; sub?: ReactNode; strong?: boolean; title?: string;
}) {
  const v = value ?? r.performance_pct, valid = validOf(r);
  const c = Math.abs(v) < 0.005 ? null : v > 0 ? UP_RGB : DOWN_RGB;
  return (
    <button onClick={() => onOpen(r)}
      title={title ?? `${r.theme_name}: ${fmtPct(v)} · ${r.up_count} of ${valid} stocks up — click to open`}
      className="flex min-w-0 items-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-left transition hover:brightness-125 sm:gap-2 sm:px-4 sm:py-3"
      style={c ? { background: `hsla(${c}, 0.06)`, borderColor: `hsla(${c}, 0.32)` } : { background: "hsl(var(--muted) / 0.25)", borderColor: "hsl(var(--border))" }}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] tracking-tight sm:text-[15px] sm:tracking-normal ${strong ? "font-bold" : "font-semibold"}`}>{r.theme_name}</span>
        {sub && <span className="block truncate text-[10.5px] text-muted-foreground">{sub}</span>}
      </span>
      <span className={`shrink-0 text-[12.5px] font-bold tabular-nums tracking-tight sm:text-[15px] ${toneClass(v)}`}>{fmtPct(v)}</span>
    </button>
  );
}

const CARD_GRID = "grid grid-cols-2 gap-1.5 sm:gap-2.5 md:grid-cols-3 xl:grid-cols-4";

/** Every group as a tinted card, strongest first. With a sector mapping, one section per sector. */
export function GroupCards({ rows, onOpen, sectorOf, value, sub, title }: {
  rows: ThemeData[];
  onOpen: (t: ThemeData) => void;
  sectorOf?: (industry: string) => string;
  value?: (r: ThemeData) => number;
  sub?: (r: ThemeData) => ReactNode;
  title?: (r: ThemeData) => string;
}) {
  const val = value ?? ((r: ThemeData) => r.performance_pct);
  const cardProps = (r: ThemeData) => ({ value: value ? val(r) : undefined, sub: sub?.(r), title: title?.(r) });
  if (sectorOf) {
    return (
      <div className="space-y-4">
        {buildSectorBlocks(rows, sectorOf).map((b) => (
          <section key={b.name}>
            <button onClick={() => onOpen(b.theme)} className="mb-1.5 flex w-full items-baseline gap-2 px-1 text-left hover:opacity-80" title={`${b.name}: ${fmtPct(b.avg)} across ${b.stocks} stocks — click for all of them`}>
              <span className="text-[13px] font-bold">{b.name}</span>
              <span className={`font-mono text-[12px] font-semibold ${toneClass(b.avg)}`}>{fmtPct(b.avg)}</span>
              <span className="text-[10.5px] text-muted-foreground">{b.industries.length} industries · {b.up}/{b.stocks} up</span>
            </button>
            <div className={CARD_GRID}>
              {[...b.industries].sort((x, y) => val(y) - val(x)).map((r) => <GroupCard key={r.theme_name} r={r} onOpen={onOpen} {...cardProps(r)} />)}
            </div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className={CARD_GRID}>
      {[...rows].sort((a, b) => val(b) - val(a)).map((r) => <GroupCard key={r.theme_name} r={r} onOpen={onOpen} {...cardProps(r)} />)}
    </div>
  );
}
