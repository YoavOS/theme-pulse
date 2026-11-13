import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STAGE_COLORS, STAGE_TIPS, type StageNum } from "@/lib/stageAnalysis";
import { tint } from "@/lib/colorTint";

// Stage overview in the Deepvue layout: one thick distribution bar, four tinted stage cards,
// a smooth breadth chart (Stage 2 and Stage 4 by default) and a clickable legend.

const STAGES: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
const LINES_KEY = "stage_overview_lines_v1";
const STAGE_NAME: Record<1 | 2 | 3 | 4, string> = { 1: "Basing", 2: "Advancing", 3: "Topping", 4: "Declining" };
const PRESETS: { label: string; ks: StageNum[] }[] = [
  { label: "S2 & S4", ks: [2, 4] },
  { label: "All four", ks: [1, 2, 3, 4] },
  { label: "Bases & tops", ks: [1, 3] },
];

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export default function StageOverview({ n, transition, series, onOpen, footer }: {
  n: Record<StageNum, number>;
  transition: number;
  series: Record<StageNum, number[]>;
  onOpen: (s: StageNum) => void;
  footer?: React.ReactNode;
}) {
  const total = n[1] + n[2] + n[3] + n[4];
  const pct = (k: StageNum) => (total ? (n[k] / total) * 100 : 0);
  const [shown, setShown] = useState<Set<StageNum>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LINES_KEY) ?? "null");
      if (Array.isArray(v) && v.length && v.every((k) => [1, 2, 3, 4].includes(k))) return new Set<StageNum>(v);
    } catch { /* ignore */ }
    return new Set<StageNum>([2, 4]);
  });
  useEffect(() => { try { localStorage.setItem(LINES_KEY, JSON.stringify([...shown])); } catch { /* ignore */ } }, [shown]);
  const same = (ks: StageNum[]) => ks.length === shown.size && ks.every((k) => shown.has(k));
  const toggle = (k: StageNum) => setShown((s) => { const x = new Set(s); if (x.has(k)) { if (x.size > 1) x.delete(k); } else x.add(k); return x; });
  const [hover, setHover] = useState<number | null>(null);

  const len = series[2].length;
  const W = 1000, H = 300, PAD = 18;
  const vis = STAGES.filter((k) => shown.has(k));
  const { lo, hi } = useMemo(() => {
    const vals = vis.flatMap((k) => series[k]);
    if (!vals.length) return { lo: 0, hi: 100 };
    const mn = Math.min(...vals), mx = Math.max(...vals), pad = Math.max(2, (mx - mn) * 0.12);
    return { lo: Math.max(0, mn - pad), hi: Math.min(100, mx + pad) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, shown]);
  const x = (i: number) => (len > 1 ? (i / (len - 1)) * W : 0);
  const y = (v: number) => PAD + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - PAD * 2);

  return (
    <div className="space-y-5">
      {/* distribution bar */}
      <div className="flex h-3.5 overflow-hidden rounded-full bg-muted">
        {STAGES.map((k) => <div key={k} style={{ width: `${pct(k)}%`, background: STAGE_COLORS[k] }} />)}
      </div>

      {/* stage cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STAGES.map((k) => (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <button onClick={() => onOpen(k)} className="rounded-2xl px-3 py-4 text-center transition hover:brightness-125"
                style={{ background: k === 1 ? "hsla(220, 9%, 46%, 0.08)" : tint(STAGE_COLORS[k], 0.09) }}>
                <div className="text-[15px] font-semibold" style={{ color: k === 1 ? "hsl(220, 9%, 58%)" : STAGE_COLORS[k] }}>S{k}</div>
                <div className="mt-1 font-display text-[28px] font-bold leading-none tabular-nums">{pct(k).toFixed(0)}%</div>
                <div className="mt-2 text-[14px] tabular-nums text-muted-foreground">{n[k].toLocaleString("en-US")}</div>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{STAGE_TIPS[k]} Click for the list.</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {transition > 0 && (
        <button onClick={() => onOpen(0)} className="-mt-2 block text-[11px] text-muted-foreground hover:text-foreground" title={STAGE_TIPS[0]}>
          + {transition.toLocaleString("en-US")} in transition between stages (not counted above) — show
        </button>
      )}

      {/* breadth chart */}
      {len < 2 ? (
        <div className="py-10 text-center text-xs text-muted-foreground">History appears after the first scan.</div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[240px] w-full sm:h-[300px]"
            onMouseMove={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); setHover(Math.max(0, Math.min(len - 1, Math.round(((e.clientX - r.left) / r.width) * (len - 1))))); }}
            onMouseLeave={() => setHover(null)} role="img" aria-label="Share of stocks in each stage, weekly">
            {vis.map((k) => (
              <path key={k} d={smooth(series[k].map((v, i) => [x(i), y(v)]))} fill="none" stroke={STAGE_COLORS[k]} strokeWidth={3}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
            {hover !== null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="hsl(var(--muted-foreground))" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.5} />
                {vis.map((k) => <circle key={k} cx={x(hover)} cy={y(series[k][hover])} r={5} fill={STAGE_COLORS[k]} vectorEffect="non-scaling-stroke" />)}
              </>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-1 rounded-md border border-border bg-background/95 px-2.5 py-1.5 font-mono text-[11px]"
              style={{ left: `min(${(hover / (len - 1)) * 100}%, calc(100% - 140px))` }}>
              <div className="text-muted-foreground">{len - 1 - hover === 0 ? "last week" : `${len - 1 - hover}w ago`}</div>
              {STAGES.map((k) => <div key={k} style={{ color: STAGE_COLORS[k] }} className={shown.has(k) ? "" : "opacity-50"}>S{k} {series[k][hover].toFixed(0)}%</div>)}
              <div>S2 − S4 {series[2][hover] - series[4][hover] >= 0 ? "+" : ""}{(series[2][hover] - series[4][hover]).toFixed(0)}</div>
            </div>
          )}
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{len}w ago</span><span>last completed week</span></div>
        </div>
      )}

      {/* line picker: which stages the chart draws */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">Lines</span>
        {STAGES.map((k) => {
          const on = shown.has(k);
          return (
            <button key={k} onClick={() => toggle(k)} aria-pressed={on}
              title={on ? (shown.size > 1 ? `Hide the S${k} line` : "At least one line stays on") : `Show the S${k} line`}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition"
              style={on ? { borderColor: tint(STAGE_COLORS[k], 0.6), background: tint(STAGE_COLORS[k], 0.14), color: "hsl(var(--foreground))" } : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full" style={{ background: on ? STAGE_COLORS[k] : "transparent", border: `1.5px solid ${STAGE_COLORS[k]}` }}>
                {on && <Check size={9} strokeWidth={3.5} className="text-background" />}
              </span>
              S{k}<span className="hidden font-normal text-muted-foreground sm:inline">{STAGE_NAME[k]}</span>
            </button>
          );
        })}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setShown(new Set(p.ks))}
            className={`rounded-full px-2.5 py-1 text-[11.5px] transition ${same(p.ks) ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {p.label}
          </button>
        ))}
      </div>
      {footer && <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
}
