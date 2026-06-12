import { useState } from "react";
import { Settings2, RotateCcw } from "lucide-react";

export interface DashboardWeights {
  w1d: number;
  w1w: number;
  w1m: number;
  w3m: number;
}

// Defaults match the spirit of the RS Alpha Overall weights
// (RS Alpha = 1M:50, 3M:30, 6M:20 → normalized to 4 buckets, 6M dropped).
export const DEFAULT_DASHBOARD_WEIGHTS: DashboardWeights = {
  w1d: 0,
  w1w: 0,
  w1m: 60,
  w3m: 40,
};

export function normalizeDashboardWeights(w: DashboardWeights): DashboardWeights {
  const total = w.w1d + w.w1w + w.w1m + w.w3m;
  if (total <= 0) return { ...DEFAULT_DASHBOARD_WEIGHTS };
  const f = 100 / total;
  return {
    w1d: Math.round(w.w1d * f),
    w1w: Math.round(w.w1w * f),
    w1m: Math.round(w.w1m * f),
    w3m: Math.round(w.w3m * f),
  };
}

interface Props {
  weights: DashboardWeights;
  onChange: (w: DashboardWeights) => void;
  onReset: () => void;
}

export default function DashboardWeightsPanel({ weights, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const total = weights.w1d + weights.w1w + weights.w1m + weights.w3m;
  const norm = normalizeDashboardWeights(weights);

  const update = (key: keyof DashboardWeights, val: number) => {
    onChange({ ...weights, [key]: Math.max(0, Math.min(100, val)) });
  };

  const Row = ({ label, k }: { label: string; k: keyof DashboardWeights }) => (
    <div className="flex items-center gap-3">
      <span className="w-12 text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={weights[k]}
        onChange={(e) => update(k, Number(e.target.value))}
        className="flex-1 accent-primary"
      />
      <input
        type="number"
        min={0}
        max={100}
        value={weights[k]}
        onChange={(e) => update(k, Number(e.target.value))}
        className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right text-xs"
      />
      <span className="w-10 text-right text-[11px] text-muted-foreground">{norm[k]}%</span>
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Customize Overall Best Themes weights"
      >
        <Settings2 size={12} /> Overall Weights
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-[360px] rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Overall Best Themes — Weights</h3>
              <button
                onClick={onReset}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                title="Reset to defaults"
              >
                <RotateCcw size={11} /> Reset
              </button>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Weights auto-normalize to 100%. Calculation runs entirely client-side from the cached
              Full Scan results — no Cloud usage.
            </p>
            <div className="space-y-2.5">
              <Row label="1 Day" k="w1d" />
              <Row label="1 Week" k="w1w" />
              <Row label="1 Month" k="w1m" />
              <Row label="3 Month" k="w3m" />
            </div>
            <div className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
              Raw total: <span className="font-mono text-foreground">{total}</span> · normalized to 100%
            </div>
          </div>
        </>
      )}
    </div>
  );
}
