import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Charts for the Minervini tab: the profile scores at a glance (radar), revenue / EPS / margin by quarter,
 * earnings surprises, and how the score is built. Colors follow the app: blue = good, pink = weak.
 */
const BLUE = "hsl(222,82%,66%)", PINK = "hsl(330,72%,60%)", AMBER = "hsl(35,95%,60%)", MUTED = "hsl(220,10%,55%)";
const axis = { fontSize: 10, fill: MUTED };
const tip = { contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11, borderRadius: 6 }, labelStyle: { color: "hsl(var(--foreground))" } };
const qLabel = (d: string) => { const [y, m] = d.split("-").map(Number); return `Q${Math.ceil(m / 3)} '${String(y).slice(2)}`; };

export function ProfileRadar({ profiles }: { profiles: { label: string; score: number | null }[] }) {
  const data = profiles.filter((p) => p.score !== null).map((p) => ({ k: p.label.replace(/ \(.*\)$/, ""), v: p.score }));
  if (data.length < 3) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 text-[12px] font-semibold">The profile at a glance <span className="font-normal text-muted-foreground">· score 0–100 per lens</span></div>
      <div className="h-56">
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey="k" tick={{ ...axis, fontSize: 10.5 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="v" stroke={BLUE} fill={BLUE} fillOpacity={0.3} />
            <Tooltip {...tip} formatter={(v: number) => [`${v}`, "score"]} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface Q { date: string; revenue: number | null; eps: number | null; revenueYoY: number | null; epsYoY: number | null; margin: number | null; turnaround: boolean }

/** Revenue (bars) and EPS (line) per quarter, and the net margin trend. */
export function QuarterTrends({ quarters }: { quarters: Q[] }) {
  const rows = [...quarters].reverse().map((q) => ({ q: qLabel(q.date), rev: q.revenue != null ? q.revenue / 1e6 : null, eps: q.eps, margin: q.margin }));
  if (rows.filter((r) => r.rev != null).length < 3) return null;
  const marginRows = rows.filter((r) => r.margin != null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-1 text-[12px] font-semibold">Revenue and EPS by quarter <span className="font-normal text-muted-foreground">· bars = revenue ($M), line = EPS</span></div>
        <div className="h-52">
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="q" tick={axis} />
              <YAxis yAxisId="r" tick={axis} width={44} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}B` : `${v.toFixed(0)}`)} />
              <YAxis yAxisId="e" orientation="right" tick={axis} width={36} />
              <Tooltip {...tip} formatter={(v: number, n: string) => (n === "rev" ? [`$${v.toFixed(0)}M`, "Revenue"] : [v?.toFixed(2), "EPS"])} />
              <Bar yAxisId="r" dataKey="rev" fill={BLUE} fillOpacity={0.55} radius={[3, 3, 0, 0]} />
              <Line yAxisId="e" dataKey="eps" stroke={AMBER} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              <ReferenceLine yAxisId="e" y={0} stroke={MUTED} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      {marginRows.length >= 3 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1 text-[12px] font-semibold">Net margin by quarter <span className="font-normal text-muted-foreground">· rising margins are one of Minervini's "Code 33" signs</span></div>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={marginRows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="q" tick={axis} />
                <YAxis tick={axis} width={36} tickFormatter={(v) => `${v}%`} />
                <Tooltip {...tip} formatter={(v: number) => [`${v.toFixed(1)}%`, "Net margin"]} />
                <ReferenceLine y={0} stroke={MUTED} />
                <Bar dataKey="margin" radius={[3, 3, 0, 0]}>
                  {marginRows.map((r, i) => <Cell key={i} fill={(r.margin ?? 0) < 0 ? PINK : i > 0 && (r.margin ?? 0) > (marginRows[i - 1].margin ?? 0) ? BLUE : "hsla(222,60%,66%,0.5)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/** Earnings (and revenue) surprises, oldest → newest: blue = beat, pink = miss. */
export function SurpriseBars({ eps, rev }: { eps: number[]; rev?: number[] }) {
  if (!eps?.length) return null;
  // newest first in the data → oldest on the left here
  const n = Math.min(8, eps.length);
  const data = Array.from({ length: n }, (_, k) => { const i = n - 1 - k; return { i: i === 0 ? "latest" : `-${i}`, eps: eps[i] ?? null, rev: rev?.[i] ?? null }; });
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1 text-[12px] font-semibold">Surprises, last {n} reports <span className="font-normal text-muted-foreground">· % vs the estimate; oldest → latest; blue = beat, pink = miss</span></div>
      <div className="h-40">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="i" tick={axis} />
            <YAxis tick={axis} width={36} tickFormatter={(v) => `${v}%`} />
            <Tooltip {...tip} formatter={(v: number, k: string) => [`${v?.toFixed(1)}%`, k === "eps" ? "EPS surprise" : "Revenue surprise"]} />
            <ReferenceLine y={0} stroke={MUTED} />
            <Bar dataKey="eps" radius={[3, 3, 0, 0]}>{data.map((d, i) => <Cell key={i} fill={(d.eps ?? 0) >= 0 ? BLUE : PINK} />)}</Bar>
            {rev?.length ? <Bar dataKey="rev" radius={[3, 3, 0, 0]} fillOpacity={0.45}>{data.map((d, i) => <Cell key={i} fill={(d.rev ?? 0) >= 0 ? BLUE : PINK} />)}</Bar> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** The score as one stacked bar: each part's points earned, against what was possible. */
export function ScoreStack({ parts }: { parts: { label: string; earned: number; max: number }[] }) {
  if (!parts?.length) return null;
  const total = parts.reduce((s, p) => s + p.max, 0) || 1, got = parts.reduce((s, p) => s + p.earned, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[12px]"><span className="font-semibold">Points earned</span><span className="font-mono text-muted-foreground">{got} / {total}</span></div>
      <div className="flex h-4 overflow-hidden rounded bg-muted">
        {parts.map((p, i) => (
          <div key={p.label} title={`${p.label}: ${p.earned}/${p.max}`} className="h-full border-r border-background/60 last:border-r-0" style={{ width: `${(p.max / total) * 100}%`, background: "hsl(var(--muted))" }}>
            <div className="h-full" style={{ width: `${(p.earned / Math.max(1, p.max)) * 100}%`, background: `hsl(${222 - i * 9},${70 - (i % 3) * 8}%,${62 + (i % 2) * 6}%)` }} />
          </div>
        ))}
      </div>
      <div className="text-[10.5px] text-muted-foreground">Each segment is one part, as wide as its maximum points; the filled share is what this stock earned. Hover for details.</div>
    </div>
  );
}
