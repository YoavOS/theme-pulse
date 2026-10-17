import { Link } from "react-router-dom";
import { Slider } from "@/components/ui/slider";
import { STAGE_FILTER_OPTIONS, type StageFilterMode } from "@/lib/stageAnalysis";

/** "Weinstein Stage" filter block used in list builders (Custom TV List, Analyze List…). */
export default function StageFilterBlock({
  mode, minConfidence, onMode, onMinConfidence, available, asOf,
}: {
  mode: StageFilterMode;
  minConfidence: number;
  onMode: (m: StageFilterMode) => void;
  onMinConfidence: (n: number) => void;
  available: boolean;
  asOf?: string | null;
}) {
  const active = mode !== "any" || minConfidence > 0;
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">
          <span className="font-medium text-foreground">Weinstein Stage</span>
          <span className="block text-[10px] text-muted-foreground">
            {available
              ? `Weekly 30-week MA stages${asOf ? ` · week ending ${asOf}` : ""} · unclassified stocks are excluded when active`
              : <>No stage data yet — run a Full Scan or <Link to="/stages" className="underline">Scan Stages</Link>.</>}
          </span>
        </span>
        <select
          value={mode}
          disabled={!available}
          onChange={(e) => onMode(e.target.value as StageFilterMode)}
          className={`h-7 rounded border bg-background px-2 text-xs ${active ? "border-primary text-primary" : "border-border"}`}
        >
          {STAGE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="whitespace-nowrap">Min stage confidence</span>
        <Slider min={0} max={95} step={5} value={[minConfidence]} onValueChange={(v) => onMinConfidence(v[0])} disabled={!available} className="flex-1" />
        <span className="w-6 text-right font-mono text-primary">{minConfidence}</span>
      </div>
    </div>
  );
}
