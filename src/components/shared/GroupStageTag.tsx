import { useContext } from "react";
import type { GroupMode } from "@/lib/groupColors";
import { GroupStageModeContext, groupStageColor, groupStageOf, useGroupStagesVersion } from "@/lib/groupStage";

/**
 * " - S2" after a group's name: the stage of the whole group (every stock of it in the universe),
 * tinted with the stage colors; hover for the breakdown. `onFill` = on a colored heat tile. Renders nothing for themes, unknown groups
 * or groups with fewer than 5 classified stocks. `badge` = a compact pill for dense tiles.
 */
export default function GroupStageTag({ name, mode, badge = false, onFill = false, className = "" }: { name: string | null | undefined; mode?: GroupMode; badge?: boolean; onFill?: boolean; className?: string }) {
  useGroupStagesVersion();
  const ctx = useContext(GroupStageModeContext);
  const g = groupStageOf(name?.replace(/ — since the open$/, ""), mode ?? ctx);
  if (!g) return null;
  const color = groupStageColor(g);
  if (badge) {
    return (
      <span title={g.tip} className={`ml-1 inline-flex shrink-0 items-center rounded px-1 align-middle text-[9.5px] font-bold leading-[14px] tabular-nums ${className}`}
        style={onFill
          ? { color: `color-mix(in srgb, ${color} 55%, white)`, background: "rgba(0,0,0,0.42)", border: "1px solid rgba(255,255,255,0.18)" }
          : { color, background: `color-mix(in srgb, ${color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 35%, transparent)` }}>
        {g.label}
      </span>
    );
  }
  return (
    <span title={g.tip} className={`whitespace-nowrap font-semibold ${className}`} style={{ color }}>
      <span className="font-normal text-muted-foreground"> - </span>{g.label}
    </span>
  );
}
