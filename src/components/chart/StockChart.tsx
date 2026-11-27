import { useMemo, useState } from "react";
import { emaSeries, smaSeries, type Bars } from "@/lib/portfolio/engine";
import { CHART } from "@/components/lens/QuarterlyChart";

/**
 * Daily candle chart used across the app (chart pop-up, Portfolio): volume, 9 EMA, 21 EMA, 200 SMA,
 * a crosshair with the hovered day's numbers, and optional levels (entry, stop, target) and markers
 * (buys, earnings). Averages are computed on the full history, so the 200 SMA is right from the first
 * visible day when enough bars exist.
 */
export const MA = [
  { key: "e9", label: "9 EMA", color: "hsl(190,85%,60%)" },
  { key: "e21", label: "21 EMA", color: "hsl(222,82%,66%)" },
  { key: "s200", label: "200 SMA", color: "hsl(40,90%,58%)" },
] as const;
export type Range = "3M" | "6M" | "1Y" | "2Y";
const RANGE_BARS: Record<Range, number> = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 };

export interface Level { price: number; label: string; color: string; dash?: string }
export interface Marker { date: string; kind: "buy" | "earnings" | "sell"; title?: string }

export function StockChart({ bars, levels = [], markers = [], height = 360, range: rangeProp, onRange, note }: {
  bars: Bars; levels?: Level[]; markers?: Marker[]; height?: number; range?: Range; onRange?: (r: Range) => void; note?: string | null;
}) {
  const [rangeState, setRangeState] = useState<Range>("6M");
  const range = rangeProp ?? rangeState;
  const setRange = onRange ?? setRangeState;
  const [hover, setHover] = useState<number | null>(null);
  const all = useMemo(() => ({ e9: emaSeries(bars.c, 9), e21: emaSeries(bars.c, 21), s200: smaSeries(bars.c, 200) }), [bars]);
  const data = useMemo(() => {
    const start = Math.max(0, bars.c.length - RANGE_BARS[range]);
    return Array.from({ length: bars.c.length - start }, (_, k) => {
      const i = start + k;
      return { d: bars.d[i], o: bars.o[i], h: bars.h[i], l: bars.l[i], c: bars.c[i], v: bars.v[i], prev: i > 0 ? bars.c[i - 1] : null, e9: all.e9[i], e21: all.e21[i], s200: all.s200[i] };
    });
  }, [bars, range, all]);
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">No daily prices.</p>;

  const W = 900, H = height, padL = 6, padR = 64, padT = 8, volH = Math.round(H * 0.16), padB = 18;
  const plotH = H - padT - padB - volH - 6;
  const inView = (v: number | null | undefined) => v != null && Number.isFinite(v);
  const lvl = levels.filter((l) => inView(l.price)).map((l) => l.price);
  const maVals = data.flatMap((b) => [b.e9, b.e21, b.s200].filter(inView) as number[]);
  const dataLo = Math.min(...data.map((x) => x.l)), dataHi = Math.max(...data.map((x) => x.h));
  // averages and levels widen the scale only when they are near the candles (a far 200 SMA shouldn't squash them)
  const near = (v: number) => v >= dataLo * 0.7 && v <= dataHi * 1.3;
  let lo = Math.min(dataLo, ...lvl.filter(near), ...maVals.filter(near)), hi = Math.max(dataHi, ...lvl.filter(near), ...maVals.filter(near));
  const span = hi - lo || 1; lo -= span * 0.04; hi += span * 0.06;
  const step = (W - padL - padR) / data.length;
  const x = (i: number) => padL + step * (i + 0.5);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  const maxV = Math.max(1, ...data.map((b) => b.v));
  const vy = (v: number) => H - padB - (v / maxV) * volH;
  const path = (k: "e9" | "e21" | "s200") => {
    let d = "", pen = false;
    data.forEach((b, i) => { const v = b[k]; if (v == null || v < lo || v > hi) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const idx = new Map(data.map((b, i) => [b.d, i]));
  const monthly = data.map((b, i) => ({ i, m: b.d.slice(0, 7) })).filter((t, k, a) => k === 0 || t.m !== a[k - 1].m).slice(1);
  const ticks = monthly.length > 9 ? monthly.filter((_, k) => k % 2 === 0) : monthly;
  const yTicks = (() => { const n = 5, raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), s = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) ?? raw; const out: number[] = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v); return out; })();
  const fmt = (v: number) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
  const hi_ = hover ?? data.length - 1, hb = data[hi_];
  const chg = hb.prev ? (hb.c / hb.prev - 1) * 100 : null;
  const tag = (v: number, color: string, text: string, key: string, dash?: string, line = true) => v < lo || v > hi ? null : (
    <g key={key}>
      {line && <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={color} strokeWidth={1} strokeDasharray={dash} opacity={0.75} />}
      <rect x={W - padR + 2} y={y(v) - 8} width={padR - 4} height={16} rx={3} fill={color} opacity={0.2} />
      <text x={W - padR + 5} y={y(v) + 4} fontSize={10} fill={color} className="font-mono">{text}</text>
    </g>
  );

  return (
    <div className="select-none" dir="ltr">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <span className="font-mono text-muted-foreground">{new Date(`${hb.d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
        <span className="font-mono">O <b>{fmt(hb.o)}</b> H <b>{fmt(hb.h)}</b> L <b>{fmt(hb.l)}</b> C <b>{fmt(hb.c)}</b>
          {chg != null && <span className="ms-1.5" style={{ color: chg >= 0 ? CHART.positive : CHART.negative }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}</span>
        <span className="font-mono text-muted-foreground">Vol {Intl.NumberFormat("en-US", { notation: "compact" }).format(hb.v)}</span>
        {MA.map((m) => <span key={m.key} className="font-mono" style={{ color: m.color }}>{m.label} {hb[m.key] != null ? fmt(hb[m.key] as number) : "—"}</span>)}
        <div className="ms-auto flex overflow-hidden rounded-md border border-border" role="group" aria-label="Range">
          {(Object.keys(RANGE_BARS) as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} disabled={bars.c.length < RANGE_BARS[r] * 0.6 && r !== "3M"}
              className={`px-2 py-0.5 font-mono text-[11px] disabled:opacity-30 ${range === r ? "bg-primary/20 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
      </div>
      <div className="relative" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily candles with 9 EMA, 21 EMA and 200 SMA">
          {yTicks.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeWidth={0.5} opacity={0.6} />
            <text x={W - padR + 5} y={y(v) + 3} fontSize={9.5} fill="hsl(var(--muted-foreground))" className="font-mono">{fmt(v)}</text></g>)}
          {ticks.map((t) => <text key={t.m} x={x(t.i) - step / 2 + 2} y={H - 4} fontSize={9.5} fill="hsl(var(--muted-foreground))">{new Date(`${t.m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(t.m.endsWith("-01") ? { year: "2-digit" } : {}), timeZone: "UTC" })}</text>)}
          {data.map((b, i) => {
            const up = b.c >= b.o, col = up ? CHART.positive : CHART.negative, bw = Math.max(1, step * 0.66);
            return (
              <g key={b.d}>
                <rect x={x(i) - bw / 2} y={vy(b.v)} width={bw} height={H - padB - vy(b.v)} fill={col} opacity={0.22} />
                <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={step > 4 ? 1 : 0.8} />
                <rect x={x(i) - bw / 2} y={y(Math.max(b.o, b.c))} width={bw} height={Math.max(0.8, Math.abs(y(b.o) - y(b.c)))} fill={up ? "hsl(var(--background))" : col} stroke={col} strokeWidth={step > 4 ? 1 : 0.6} />
              </g>
            );
          })}
          {MA.map((m) => <path key={m.key} d={path(m.key)} fill="none" stroke={m.color} strokeWidth={m.key === "s200" ? 1.6 : 1.3} opacity={0.95} />)}
          {levels.map((l, k) => tag(l.price, l.color, l.label, `l${k}`, l.dash ?? "4 3"))}
          {markers.map((m, k) => {
            const i = idx.get(m.date); if (i == null) return null;
            if (m.kind === "earnings") return <g key={`m${k}`}><title>{m.title ?? `Earnings ${m.date}`}</title><circle cx={x(i)} cy={H - padB - volH - 8} r={6} fill={CHART.growth} opacity={0.25} /><text x={x(i)} y={H - padB - volH - 5} fontSize={8} textAnchor="middle" fill={CHART.growth}>E</text></g>;
            const up = m.kind === "buy";
            return <path key={`m${k}`} d={up ? `M${x(i)},${y(data[i].l) + 5} l-5,9 h10 z` : `M${x(i)},${y(data[i].h) - 5} l-5,-9 h10 z`} fill={up ? "hsl(var(--primary))" : CHART.negative}><title>{m.title ?? m.kind}</title></path>;
          })}
          {hover != null && <>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="hsl(var(--muted-foreground))" strokeWidth={0.6} strokeDasharray="3 3" />
            {tag(hb.c, "hsl(var(--foreground))", fmt(hb.c), "hc", "3 3")}
          </>}
          {hover == null && tag(data[data.length - 1].c, data[data.length - 1].c >= (data[data.length - 1].prev ?? 0) ? CHART.positive : CHART.negative, fmt(data[data.length - 1].c), "last", undefined, false)}
          {data.map((b, i) => <rect key={`h${b.d}`} x={x(i) - step / 2} y={padT} width={step} height={H - padT - padB} fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => hover !== i && setHover(i)} />)}
        </svg>
      </div>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
