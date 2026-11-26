
import type { ComponentProps } from "react";

const order = [0, 4, 1, 5, 2, 6, 3];
const stages = [0, 0, 1, 1, 2, 2, 3];

export function IncomeFlowWaterfall({ values, labels, format, selected, action, title, zeroLabel }: {
  values: (number | null)[];
  labels: string[];
  format: (value: number | null) => string;
  selected: number;
  action: (index: number, label: string) => ComponentProps<"g">;
  title: string;
  zeroLabel: string;
}) {
  const totals = values.slice(0, 4).filter((v): v is number => v !== null && Number.isFinite(v));
  const low = Math.min(0, ...totals);
  const high = Math.max(0, ...totals);
  const y = (v: number) => 242 - 158 * (v - low) / (high - low || 1);
  const x = (i: number) => 84 + i * 134;
  const zero = y(0);

  return <div className="mt-4 overflow-x-auto" tabIndex={0}>
    <svg viewBox="0 0 980 305" className="min-w-[570px] w-full" role="group" aria-label={title} direction="ltr">
      <line x1="31" x2="958" y1={zero} y2={zero} stroke="currentColor" opacity=".38" strokeDasharray="4 4" />
      <text x="24" y={zero + 4} textAnchor="end" fill="currentColor" opacity=".75" fontSize="12">{zeroLabel}</text>
      {order.map((id, i) => {
        const total = id < 4;
        const value = values[id];
        const stage = stages[i];
        const before = total ? 0 : values[stage];
        const after = total ? value : values[stage + 1];
        const chartable = value !== null && before !== null && after !== null;
        const exit = total ? value : after;
        const next = order[i + 1];
        const linked = next !== undefined && chartable && values[next] !== null &&
          (next < 4 || (values[stages[i + 1]] !== null && values[stages[i + 1] + 1] !== null));
        const color = (total ? (value ?? 0) < 0 : (value ?? 0) > 0) ? "hsl(var(--down))" : "hsl(var(--up))";
        return <g key={id}>
          {linked && exit !== null && <line x1={x(i) + 29} x2={x(i + 1) - 29} y1={y(exit)} y2={y(exit)}
            stroke="currentColor" opacity=".43" strokeDasharray="3 4" />}
          <g {...action(id, labels[id])}>
            <rect x={x(i) - 62} y="8" width="124" height="278" rx="7" fill="currentColor"
              className={selected === id ? "opacity-10" : "opacity-0 group-hover:opacity-10 group-focus-visible:opacity-15"} />
            <text x={x(i)} y="31" textAnchor="middle" fill="currentColor" fontSize="13">{labels[id]}</text>
            <text x={x(i)} y="52" textAnchor="middle" fill={value === null ? "currentColor" : color} fontSize="15">
              {format(total || value === null ? value : -value)}
            </text>
            {chartable
              ? <rect x={x(i) - 29} y={Math.min(y(before), y(after))} width="58"
                  height={Math.max(2, Math.abs(y(after) - y(before)))} rx="3" fill={color} opacity={total ? ".88" : ".62"} />
              : <line x1={x(i) - 12} x2={x(i) + 12} y1="150" y2="150" stroke="currentColor" opacity=".3" />}
          </g>
        </g>;
      })}
    </svg>
  </div>;
}

