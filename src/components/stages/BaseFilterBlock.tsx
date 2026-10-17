import { Link } from "react-router-dom";
import { Slider } from "@/components/ui/slider";
import { ALL_LABELS, LABEL_NAMES, isBaseFilterActive, type BaseFilter, type BaseLabel } from "@/lib/bases";

const STATE_OPTIONS: { value: BaseFilter["state"]; label: string }[] = [
  { value: "any", label: "Any state" },
  { value: "ready", label: "Ready only" },
  { value: "ready_triggered", label: "Ready or triggered" },
  { value: "not_failed", label: "Not failed" },
];

/** "Base Scanner" filter block used in list builders (Custom TV List, Analyze List…). */
export default function BaseFilterBlock({
  value, onChange, available,
}: {
  value: BaseFilter;
  onChange: (f: BaseFilter) => void;
  available: boolean;
}) {
  const active = isBaseFilterActive(value);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">
          <span className="font-medium text-foreground">Base setup</span>
          <span className="block text-[10px] text-muted-foreground">
            {available
              ? "Stage 2 bases from the Base Scanner · stocks without a qualifying base are excluded when active"
              : <>No base data yet — run a Full Scan or open <Link to="/bases" className="underline">Bases</Link>.</>}
          </span>
        </span>
        {active && (
          <button type="button" onClick={() => onChange({ minScore: 0, label: "any", state: "any" })} className="text-[10px] text-muted-foreground underline hover:text-foreground">
            reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value.label}
          disabled={!available}
          onChange={(e) => onChange({ ...value, label: e.target.value as BaseLabel | "any" })}
          className={`h-7 rounded border bg-background px-2 text-xs ${value.label !== "any" ? "border-primary text-primary" : "border-border"}`}
        >
          <option value="any">Any pattern</option>
          {ALL_LABELS.map((lb) => <option key={lb} value={lb}>{LABEL_NAMES[lb]}</option>)}
        </select>
        <select
          value={value.state}
          disabled={!available}
          onChange={(e) => onChange({ ...value, state: e.target.value as BaseFilter["state"] })}
          className={`h-7 rounded border bg-background px-2 text-xs ${value.state !== "any" ? "border-primary text-primary" : "border-border"}`}
        >
          {STATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="whitespace-nowrap">Min base score</span>
        <Slider min={0} max={95} step={5} value={[value.minScore]} onValueChange={(v) => onChange({ ...value, minScore: v[0] })} disabled={!available} className="flex-1" />
        <span className="w-6 text-right font-mono text-primary">{value.minScore}</span>
      </div>
    </div>
  );
}
