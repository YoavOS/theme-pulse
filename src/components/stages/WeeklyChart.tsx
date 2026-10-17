import { STAGE_COLORS, type StageNum } from "@/lib/stageAnalysis";

export interface WeeklySeries {
  o?: number[];
  h: number[];
  l: number[];
  c: number[];
  ma: (number | null)[];
}

/**
 * Compact weekly chart (log scale): high–low bars, close line, 30-week MA.
 * Optional shaded window (a base), horizontal levels (pivot / stop) and a stage strip
 * (one character per week, oldest → newest, right-aligned like the stage history).
 */
export default function WeeklyChart({
  s, shadeFrom, levels = [], strip, stripEnd, height = 120, label,
}: {
  s: WeeklySeries;
  shadeFrom?: number;
  levels?: { y: number; color: string; dash?: string }[];
  strip?: string;
  /** index of the week the strip's last character belongs to (default: the last bar) */
  stripEnd?: number;
  height?: number;
  label: string;
}) {
  const n = s.c.length;
  if (n < 3) return null;
  const W = 300, H = height, PAD = 4, STRIP = strip ? 7 : 0;
  const vals = [...s.h, ...s.l, ...levels.map((x) => x.y)].filter((x) => Number.isFinite(x) && x > 0);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const plotH = H - 2 * PAD - STRIP;
  const y = (p: number) => PAD + (1 - (Math.log(p) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1)) * plotH;
  const step = (W - 2 * PAD) / n;
  const x = (k: number) => PAD + k * step + step / 2;
  const pts = (arr: (number | null)[]) => arr.map((v, k) => (v ? `${x(k).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean).join(" ");
  const from = shadeFrom !== undefined ? Math.max(0, Math.min(n - 1, shadeFrom)) : null;
  const end = stripEnd !== undefined && stripEnd >= 0 ? Math.min(n - 1, stripEnd) : n - 1;
  const stripChars = strip ? strip.slice(-(end + 1)) : "";
  const stripOff = end + 1 - stripChars.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full rounded bg-background/60" style={{ height }} role="img" aria-label={label}>
      {from !== null && <rect x={PAD + from * step} y={PAD} width={(n - from) * step} height={plotH} fill="hsl(var(--primary) / 0.08)" />}
      {s.h.map((h, k) => (
        <line key={k} x1={x(k)} x2={x(k)} y1={y(h)} y2={y(s.l[k])}
          stroke={(s.o ? s.c[k] < s.o[k] : k > 0 && s.c[k] < s.c[k - 1]) ? "hsl(344,70%,60%)" : "hsl(160,60%,50%)"}
          strokeWidth={Math.max(1, step * 0.45)} strokeOpacity={0.55} />
      ))}
      <polyline points={pts(s.c)} fill="none" stroke="hsl(var(--foreground) / 0.8)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polyline points={pts(s.ma)} fill="none" stroke="hsl(280,60%,72%)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {levels.map((lv, k) => (
        <line key={k} x1={from !== null ? PAD + from * step : PAD} x2={W - PAD} y1={y(lv.y)} y2={y(lv.y)} stroke={lv.color} strokeDasharray={lv.dash ?? "3 2"} vectorEffect="non-scaling-stroke" />
      ))}
      {stripChars.split("").map((ch, k) => {
        const st = (ch === "T" ? 0 : Number(ch)) as StageNum;
        return <rect key={k} x={PAD + (stripOff + k) * step} y={H - PAD - STRIP + 2} width={step + 0.3} height={STRIP - 2} fill={STAGE_COLORS[st] ?? "#555"} opacity={0.8} />;
      })}
    </svg>
  );
}
