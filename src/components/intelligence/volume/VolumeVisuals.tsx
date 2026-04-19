import { useId } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/* ─────────────────────────────────────────────────────────────
   Reusable visuals for the Volume Leaders section.
   All components are tiny SVG primitives — no external deps,
   no recharts overhead per row, fully scriptable colors.
   ───────────────────────────────────────────────────────────── */

export interface VolumeSparklineProps {
  /** Series of raw volumes (oldest → newest). Will be normalized internally. */
  series: number[];
  width?: number;
  height?: number;
  /** Trend % (drives stroke + fill color). */
  trendPct?: number | null;
  /** Render as bars instead of a smooth line. */
  variant?: "line" | "bars";
}

function trendStroke(trendPct: number | null | undefined): string {
  if (trendPct == null) return "#64748b";
  if (trendPct > 25) return "#00f5c4";
  if (trendPct > 5) return "#4ade80";
  if (trendPct < -10) return "#f87171";
  return "#facc15";
}

export function VolumeSparkline({
  series, width = 70, height = 22, trendPct = null, variant = "line",
}: VolumeSparklineProps) {
  const gradId = useId();
  if (!series || series.length < 2) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[9px] text-muted-foreground">--</div>;
  }
  const max = Math.max(...series, 1);
  const min = 0; // Always start at 0 to give visual sense of magnitude
  const range = max - min || 1;
  const stroke = trendStroke(trendPct);

  if (variant === "bars") {
    const barW = width / series.length;
    return (
      <svg width={width} height={height} className="overflow-visible block">
        {series.map((v, i) => {
          const h = ((v - min) / range) * (height - 2);
          return (
            <rect
              key={i}
              x={i * barW + 0.5}
              y={height - h - 1}
              width={Math.max(barW - 0.8, 0.8)}
              height={Math.max(h, 0.5)}
              fill={stroke}
              opacity={0.55 + (i / series.length) * 0.45}
              rx={0.5}
            />
          );
        })}
      </svg>
    );
  }

  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y];
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${path} L${width.toFixed(1)},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Strength Bar — horizontal gradient bar driven by Rel Vol (×).
   0×–2.5× scale; gradient red → amber → green.
   ───────────────────────────────────────────────────────────── */

export function StrengthBar({
  value, width = 56, height = 6,
}: { value: number | null; width?: number; height?: number }) {
  if (value == null) {
    return <div style={{ width, height }} className="rounded-full bg-white/5" />;
  }
  // Map 0..2.5× to 0..100%
  const pct = Math.max(0, Math.min(100, (value / 2.5) * 100));
  const color =
    value > 1.8 ? "#00f5c4" :
    value > 1.4 ? "#4ade80" :
    value >= 1.1 ? "#facc15" :
    value < 0.9 ? "#f87171" :
    "#94a3b8";

  return (
    <div className="relative rounded-full overflow-hidden" style={{ width, height, background: "rgba(255,255,255,0.06)" }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}80, ${color})`,
          boxShadow: value > 1.4 ? `0 0 6px ${color}90` : undefined,
          transition: "width 220ms ease-out",
        }}
      />
      {/* 1.0× tick marker */}
      <div className="absolute top-0 bottom-0 w-px bg-white/30" style={{ left: `${(1.0 / 2.5) * 100}%` }} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sustained Gauge — segmented bar (5 segments).
   Each segment lights up depending on score relative to 1.0.
   <0.9 = red  |  0.9–1.05 = neutral  |  1.05–1.2 = light green  |  >1.2 = strong green
   ───────────────────────────────────────────────────────────── */

export function SustainedGauge({
  score, width = 56, segments = 5,
}: { score: number | null; width?: number; segments?: number }) {
  if (score == null) {
    return (
      <div style={{ width }} className="flex gap-[2px]">
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} className="h-[6px] flex-1 rounded-sm bg-white/5" />
        ))}
      </div>
    );
  }
  // Map score 0.5..1.5 → 0..segments lit. Center anchor at 1.0.
  const litRaw = ((score - 0.5) / 1.0) * segments;
  const lit = Math.max(0, Math.min(segments, Math.round(litRaw)));
  const baseColor =
    score >= 1.2 ? "#00f5c4" :
    score >= 1.05 ? "#4ade80" :
    score >= 0.9 ? "#facc15" :
    "#f87171";

  return (
    <div style={{ width }} className="flex gap-[2px]" title={`Sustained score: ${score.toFixed(2)}`}>
      {Array.from({ length: segments }).map((_, i) => {
        const active = i < lit;
        return (
          <div
            key={i}
            className="h-[6px] flex-1 rounded-sm"
            style={{
              background: active ? baseColor : "rgba(255,255,255,0.08)",
              opacity: active ? 0.55 + (i / segments) * 0.45 : 1,
              boxShadow: active && score >= 1.2 ? `0 0 4px ${baseColor}80` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Volume Heat Badge — pill summarizing the regime.
   Drives off (sustainedScore, volTrendPct, relVol).
   ───────────────────────────────────────────────────────────── */

export type VolumeHeat = "surge" | "build" | "steady" | "fading" | "weak" | "neutral";

export function classifyVolumeHeat(
  relVol: number | null,
  trendPct: number | null,
  sustained: number | null,
): VolumeHeat {
  if (relVol == null && trendPct == null && sustained == null) return "neutral";
  const rv = relVol ?? 0;
  const tr = trendPct ?? 0;
  const su = sustained ?? 1;

  if (rv > 1.6 && tr > 15 && su > 1.15) return "surge";
  if (su >= 1.05 && tr > 0 && rv >= 1.0) return "build";
  if (su < 0.9 || tr < -15) return "fading";
  if (rv < 0.8 && tr < 0) return "weak";
  return "steady";
}

interface HeatStyle { label: string; tip: string; fg: string; bg: string; dot: string; }
const HEAT_STYLES: Record<VolumeHeat, HeatStyle> = {
  surge:   { label: "Volume Surge", tip: "Strong recent volume spike — Rel Vol > 1.6×, trend > +15%, sustained > 1.15. Likely institutional accumulation.", fg: "#022c1f", bg: "linear-gradient(90deg, #00f5c4, #34d399)", dot: "#022c1f" },
  build:   { label: "Steady Build", tip: "Consistent and growing volume — sustained ≥ 1.05 with positive trend. Healthy accumulation pattern.",            fg: "#052e16", bg: "rgba(74,222,128,0.18)",                    dot: "#4ade80" },
  steady:  { label: "Steady",       tip: "Stable volume with no clear directional trend. Neither accumulating nor distributing.",                          fg: "#fef9c3", bg: "rgba(250,204,21,0.14)",                    dot: "#facc15" },
  fading:  { label: "Fading",       tip: "Volume is declining — sustained < 0.9 or trend < -15%. Demand is drying up.",                                    fg: "#fee2e2", bg: "rgba(248,113,113,0.18)",                   dot: "#f87171" },
  weak:    { label: "Weak",         tip: "Below-average activity — Rel Vol < 0.8× and negative trend. Low participation.",                                 fg: "#cbd5e1", bg: "rgba(148,163,184,0.18)",                   dot: "#94a3b8" },
  neutral: { label: "No data",      tip: "Volume metrics unavailable for this row.",                                                                       fg: "#94a3b8", bg: "rgba(255,255,255,0.04)",                   dot: "#475569" },
};

export function VolumeHeatBadge({ heat, compact = false }: { heat: VolumeHeat; compact?: boolean }) {
  const s = HEAT_STYLES[heat];
  const isStrong = heat === "surge";
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase whitespace-nowrap cursor-help ${compact ? "px-2 py-[2px] text-[10px] tracking-wide" : "px-2.5 py-[3px] text-[10.5px] tracking-wide"}`}
          style={{
            background: s.bg,
            color: isStrong ? s.fg : s.dot,
            border: isStrong ? "none" : `1px solid ${s.dot}55`,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 6, height: 6, background: s.dot,
              boxShadow: isStrong ? `0 0 5px ${s.dot}` : undefined,
              animation: isStrong ? "pulse 1.6s ease-in-out infinite" : undefined,
            }}
          />
          {s.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[240px] text-xs leading-snug">
        <div className="font-semibold mb-0.5" style={{ color: s.dot }}>{s.label}</div>
        <div className="text-muted-foreground">{s.tip}</div>
      </TooltipContent>
    </Tooltip>
  );
}
