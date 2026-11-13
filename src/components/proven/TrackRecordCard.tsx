import { useState } from "react";
import { Check, ChevronDown, Minus, X as XIcon } from "lucide-react";
import ProvenBadge from "./ProvenBadge";
import { ARCHETYPE_TEXT, FLAG_TEXT, STAGE_LABEL, TRACK_TEXT, type ProvenCheck, type ProvenRow } from "@/lib/proven/types";

const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pp`;

/** Spread over the cost of capital, year by year: bars above the line = value created. */
function SpreadChart({ series, hurdle }: { series: NonNullable<ProvenRow["series"]>; hurdle: number | null }) {
  const pts = series.filter((s) => s.spread !== null);
  if (pts.length < 2) return null;
  const W = 300, H = 80, n = series.length;
  const clip = (v: number) => Math.max(-60, Math.min(60, v));
  // scale to the data; keep the cost-of-capital line (0) in view with a little room on the short side
  const hi = Math.max(2, ...pts.map((s) => clip(s.spread!))), lo = Math.min(-2, ...pts.map((s) => clip(s.spread!)));
  const span = hi - lo;
  const y = (v: number) => 4 + ((hi - clip(v)) / span) * (H - 8);
  const y0 = y(0);
  const bw = Math.min(22, (W - 8) / n - 4);
  return (
    <figure className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <svg width="18" height="6" aria-hidden><line x1="0" x2="18" y1="3" y2="3" stroke="currentColor" strokeDasharray="3 3" /></svg>
        cost of capital{hurdle !== null ? ` (${hurdle.toFixed(1)}%)` : ""}
        <span className="ml-auto font-mono">{pp(hi)} … {pp(lo)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 12}`} className="w-full" role="img" aria-label="Return on capital minus cost of capital, by year">
        <line x1={0} x2={W} y1={y0} y2={y0} stroke="currentColor" className="text-muted-foreground/60" strokeDasharray="3 3" />
        {series.map((s, i) => {
          const x = 4 + i * ((W - 8) / n) + ((W - 8) / n - bw) / 2;
          if (s.spread === null) return <text key={s.end} x={x + bw / 2} y={y0 - 2} textAnchor="middle" className="fill-muted-foreground text-[8px]">n/a</text>;
          const top = Math.min(y(s.spread), y0), h = Math.max(1, Math.abs(y(s.spread) - y0));
          const pos = s.spread >= 0;
          return (
            <g key={s.end}>
              <title>{`${s.end.slice(0, 4)}: return on capital ${s.primary?.toFixed(1)}% (${pp(s.spread)})`}</title>
              <rect x={x} y={top} width={bw} height={h} rx={1.5} className={pos ? "fill-[hsl(199,85%,60%)]" : "fill-[hsl(35,90%,58%)]"} opacity={0.85} />
              <text x={x + bw / 2} y={H + 10} textAnchor="middle" className="fill-muted-foreground text-[8px]">{`'${s.end.slice(2, 4)}`}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-[10.5px] leading-snug text-muted-foreground">Bars: return on capital minus the industry's cost of capital, each fiscal year. Above the line, the business created value that year; below, it earned less than its capital costs.</figcaption>
    </figure>
  );
}

function CheckRow({ c }: { c: ProvenCheck }) {
  const icon = c.pass === true ? <Check size={12} className="text-[hsl(199,85%,66%)]" /> : c.pass === false ? <XIcon size={12} className="text-[hsl(35,95%,64%)]" /> : <Minus size={12} className="text-muted-foreground" />;
  return (
    <div className="flex items-start gap-1.5 text-[11.5px] leading-snug">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{c.label}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.value}</span>
    </div>
  );
}

/** Proven-Strong record for the company in the Lens. */
export default function TrackRecordCard({ row, loading }: { row: ProvenRow | null; loading: boolean }) {
  const [open, setOpen] = useState(false);
  if (loading && !row) return <section className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Reading ten years of annual reports…</section>;
  if (!row) return null;
  if (row.status !== "ok") {
    return <section className="rounded-lg border border-border p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Track record: </span>{row.sentence ?? row.error ?? "not available."}</section>;
  }
  const young = row.track === "young";
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Track record</span>
        <ProvenBadge row={row} short={false} />
      </div>
      <p className="text-[13px] leading-snug">{row.sentence}</p>
      {!young && row.series && <SpreadChart series={row.series} hurdle={row.hurdle} />}
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {young
          ? "Damodaran's test of a good business is earning more on capital than it costs, for years. A young company can't have that record yet — so the question is whether the path toward it is already visible in the numbers."
          : "Damodaran's test of a good business: it earns more on its capital than that capital costs — and keeps doing it. One great year proves little; the record is the evidence."}
      </p>
      {(row.archetypes?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.archetypes!.map((a) => <span key={a} className="rounded bg-muted/50 px-1.5 py-0.5 text-[10.5px]">{ARCHETYPE_TEXT[a] ?? a}</span>)}
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">
        {young ? "What we look for in a young company" : "How it was judged"} <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">{row.why}</p>
          {row.track && <div className="text-[10.5px] text-muted-foreground">Track: {TRACK_TEXT[row.track]}{row.life_stage ? ` · stage: ${STAGE_LABEL[row.life_stage] ?? row.life_stage} — the stage decides which test applies` : ""}</div>}
          {(row.checks ?? []).length > 0 && <div className="space-y-1">{row.checks!.map((c) => <CheckRow key={c.id} c={c} />)}</div>}
          {!young && (row.gates ?? []).length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-1.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground">Is the evidence sound?</div>
              {row.gates!.map((c) => <CheckRow key={c.id} c={c} />)}
            </div>
          )}
          {(row.flags ?? []).filter((f) => FLAG_TEXT[f] && !(young && f === "rd_adjusted")).map((f) => <p key={f} className="text-[11px] leading-snug text-[hsl(40,90%,66%)]">{FLAG_TEXT[f]}</p>)}
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {young ? "Industry comparisons: " : "Hurdle: "}{row.hurdle_source ?? "industry cost of capital"}{young ? "" : ", never below 6%, applied to every year"}. Annual 10-K figures{row.as_of ? ` through FY ${row.as_of.slice(0, 4)}` : ""}; thresholds are the app's judgement and will be recalibrated.
          </p>
        </div>
      )}
    </section>
  );
}
