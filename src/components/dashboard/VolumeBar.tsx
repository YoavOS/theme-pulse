import type { VolumeStrength } from "@/lib/groupSignals";

/** Thin bar at the bottom of a tile: how heavy volume is vs normal (mark = normal, full = 3×). */
export default function VolumeBar({ v }: { v: VolumeStrength }) {
  const w = Math.min(v.ratio, 3) / 3 * 100;
  const strong = v.ratio >= 1.5;
  const light = v.ratio < 0.85;
  return (
    <div className="absolute inset-x-1.5 bottom-1.5" aria-label={`Volume ${v.ratio.toFixed(1)} times normal`}>
      <div className="relative h-[3px] rounded-full bg-black/30">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${strong ? "bg-white" : light ? "bg-white/40" : "bg-white/75"}`}
          style={{ width: `${w}%` }}
        />
        <div className="absolute -top-[2px] h-[7px] w-px bg-white/60" style={{ left: "33.333%" }} />
      </div>
    </div>
  );
}
