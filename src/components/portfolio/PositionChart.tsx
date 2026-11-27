import { useMemo, useState } from "react";
import { emaSeries, smaSeries, type Bars, type PositionRow } from "@/lib/portfolio/engine";
import { CHART } from "@/components/lens/QuarterlyChart";

/**
 * Daily candles for one holding (last ~6 months) with the 21-day EMA and 50-day average, your entry
 * (and each extra lot), the stop and target, past and next earnings. Hover a day for its numbers.
 */
export function PositionChart({ bars, lots, stop, target, earnings, nextEarnings, livePrice, height = 280 }: {
  bars: Bars; lots: PositionRow[]; stop: number | null; target: number | null;
  earnings: string[]; nextEarnings: string | null; livePrice: number | null; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const N = 130;
  const data = useMemo(() => {
    const e21 = emaSeries(bars.c, 21), s50 = smaSeries(bars.c, 50);
    const start = Math.max(0, bars.c.length - N);
    return Array.from({ length: bars.c.length - start }, (_, k) => {
      const i = start + k;
      return { d: bars.d[i], o: bars.o[i], h: bars.h[i], l: bars.l[i], c: bars.c[i], v: bars.v[i], e21: e21[i], s50: s50[i], prev: i > 0 ? bars.c[i - 1] : null };
    });
  }, [bars]);
  if (!data.length) return null;

  const W = 760, H = height, padL = 8, padR = 74, padT = 10, volH = 40, padB = 18;
  const plotH = H - padT - padB - volH - 6;
  const levels = [stop, target, livePrice, ...lots.map((l) => l.entry_price)].filter((x): x is number => x != null && Number.isFinite(x));
  let lo = Math.min(...data.map((x) => x.l), ...levels), hi = Math.max(...data.map((x) => x.h), ...levels);
  const span = hi - lo || 1; lo -= span * 0.04; hi += span * 0.04;
  const step = (W - padL - padR) / data.length;
  const x = (i: number) => padL + step * (i + 0.5);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  const maxV = Math.max(1, ...data.map((b) => b.v));
  const vy = (v: number) => H - padB - (v / maxV) * volH;
  const line = (k: "e21" | "s50") => data.map((b, i) => (b[k] == null ? null : `${x(i).toFixed(1)},${y(b[k] as number).toFixed(1)}`)).filter(Boolean).join(" ");
  const idx = new Map(data.map((b, i) => [b.d, i]));
  const ticks = data.map((b, i) => ({ i, m: b.d.slice(0, 7) })).filter((t, k, a) => k === 0 || t.m !== a[k - 1].m).slice(1);
  const hb = hover != null ? data[hover] : null;
  const level = (v: number | null, color: string, label: string, dash?: string) => v == null || v < lo || v > hi ? null : (
    <g key={label + v}>
      <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={color} strokeWidth={1} strokeDasharray={dash} opacity={0.8} />
      <rect x={W - padR + 2} y={y(v) - 8} width={padR - 4} height={16} rx={3} fill={color} opacity={0.18} />
      <text x={W - padR + 6} y={y(v) + 4} fontSize={10} fill={color} className="font-mono">{label}</text>
    </g>
  );
  const fmt = (v: number) => v >= 1000 ? v.toFixed(0) : v.toFixed(2);

  return (
    <div className="relative" dir="ltr" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily price chart with your entry, stop and averages">
        {ticks.map((t) => <g key={t.m}><line x1={x(t.i) - step / 2} x2={x(t.i) - step / 2} y1={padT} y2={H - padB} stroke="hsl(var(--border))" strokeWidth={0.5} />
          <text x={x(t.i) - step / 2 + 3} y={H - 4} fontSize={9} fill="hsl(var(--muted-foreground))">{new Date(`${t.m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</text></g>)}
        {hover != null && <rect x={x(hover) - step / 2} y={padT} width={step} height={H - padT - padB} fill="hsl(var(--muted-foreground))" opacity={0.1} />}
        {data.map((b, i) => {
          const up = b.c >= b.o, col = up ? CHART.positive : CHART.negative;
          return (
            <g key={b.d}>
              <rect x={x(i) - step * 0.35} y={vy(b.v)} width={step * 0.7} height={H - padB - vy(b.v)} fill={col} opacity={0.25} />
              <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - step * 0.32} y={y(Math.max(b.o, b.c))} width={step * 0.64} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} fill={up ? "transparent" : col} stroke={col} strokeWidth={1} />
            </g>
          );
        })}
        <polyline points={line("e21")} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.3} opacity={0.9} />
        <polyline points={line("s50")} fill="none" stroke={CHART.growth} strokeWidth={1.3} opacity={0.9} />
        {level(stop, CHART.negative, `stop ${fmt(stop ?? 0)}`, "4 3")}
        {level(target, CHART.positive, `tgt ${fmt(target ?? 0)}`, "4 3")}
        {lots.map((l) => level(l.entry_price, "hsl(var(--foreground))", `in ${fmt(l.entry_price)}`, "2 3"))}
        {lots.map((l) => { const i = idx.get(l.entry_date); return i == null ? null : <path key={l.id} d={`M${x(i)},${y(data[i].l) + 4} l-5,9 h10 z`} fill="hsl(var(--primary))" />; })}
        {earnings.map((d) => { const i = idx.get(d); return i == null ? null : <g key={d}><circle cx={x(i)} cy={padT + 6} r={6} fill={CHART.growth} opacity={0.25} /><text x={x(i)} y={padT + 9} fontSize={8} textAnchor="middle" fill={CHART.growth}>E</text></g>; })}
        {nextEarnings && <text x={W - padR - 4} y={padT + 10} fontSize={10} textAnchor="end" fill={CHART.growth}>next report {nextEarnings} →</text>}
        {data.map((b, i) => <rect key={b.d} x={x(i) - step / 2} y={padT} width={step} height={H - padT - padB} fill="transparent" onPointerEnter={() => setHover(i)} />)}
      </svg>
      {hb && (
        <div role="tooltip" className="pointer-events-none absolute top-2 z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
          style={{ left: `${Math.min(70, Math.max(2, ((x(hover!) / W) * 100) + 2))}%` }}>
          <p className="font-medium">{new Date(`${hb.d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</p>
          <p className="font-mono">O {fmt(hb.o)} · H {fmt(hb.h)} · L {fmt(hb.l)} · C {fmt(hb.c)}</p>
          {hb.prev != null && <p className="font-mono" style={{ color: hb.c >= hb.prev ? CHART.positive : CHART.negative }}>{hb.c >= hb.prev ? "+" : ""}{((hb.c / hb.prev - 1) * 100).toFixed(2)}%</p>}
          <p className="font-mono text-muted-foreground">Vol {Intl.NumberFormat("en-US", { notation: "compact" }).format(hb.v)}</p>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><span className="me-1 inline-block h-0.5 w-3 align-middle" style={{ background: "hsl(var(--primary))" }} />21-day EMA</span>
        <span><span className="me-1 inline-block h-0.5 w-3 align-middle" style={{ background: CHART.growth }} />50-day average</span>
        <span><span className="me-1 text-primary">▲</span>your buys</span>
        <span><span className="me-1" style={{ color: CHART.growth }}>E</span>earnings</span>
      </div>
    </div>
  );
}
