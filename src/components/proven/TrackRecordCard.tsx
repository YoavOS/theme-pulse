import { useState } from "react";
import { Check, ChevronDown, Minus, X as XIcon } from "lucide-react";
import ProvenBadge from "./ProvenBadge";
import { ARCHETYPE_TEXT, FLAG_TEXT, STAGE_LABEL, TRACK_TEXT, type ProvenCheck, type ProvenRow } from "@/lib/proven/types";
import { AutoTerms, Term } from "@/components/lens/Term";
import { ltr, useLensLang } from "@/lib/lens/i18n";
import { HE_ARCHETYPE, HE_FLAG, HE_TRACK_TEXT } from "@/lib/lens/he/proven";
import { HE_STAGE } from "@/lib/lens/he/curriculum";
import type { Stage } from "@/lib/lens/types";

const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} pp`;

/** Spread over the cost of capital, year by year: bars above the line = value created. */
function SpreadChart({ series, hurdle }: { series: NonNullable<ProvenRow["series"]>; hurdle: number | null }) {
  const he = useLensLang() === "he";
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
        <Term id="cost_of_capital">{he ? "עלות ההון" : "cost of capital"}</Term>{hurdle !== null ? <> ({he ? ltr(`${hurdle.toFixed(1)}%`) : `${hurdle.toFixed(1)}%`})</> : ""}
        <span className="ms-auto font-mono" dir="ltr">{pp(hi)} … {pp(lo)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 12}`} className="w-full" role="img" direction="ltr" aria-label={he ? "תשואה על ההון פחות עלות ההון, לפי שנה" : "Return on capital minus cost of capital, by year"}>
        <line x1={0} x2={W} y1={y0} y2={y0} stroke="currentColor" className="text-muted-foreground/60" strokeDasharray="3 3" />
        {series.map((s, i) => {
          const x = 4 + i * ((W - 8) / n) + ((W - 8) / n - bw) / 2;
          if (s.spread === null) return <text key={s.end} x={x + bw / 2} y={y0 - 2} textAnchor="middle" className="fill-muted-foreground text-[8px]">n/a</text>;
          const top = Math.min(y(s.spread), y0), h = Math.max(1, Math.abs(y(s.spread) - y0));
          const pos = s.spread >= 0;
          return (
            <g key={s.end}>
              <title>{he ? `${s.end.slice(0, 4)}: תשואה על ההון ${s.primary?.toFixed(1)}% (${pp(s.spread)})` : `${s.end.slice(0, 4)}: return on capital ${s.primary?.toFixed(1)}% (${pp(s.spread)})`}</title>
              <rect x={x} y={top} width={bw} height={h} rx={1.5} className={pos ? "fill-[hsl(199,85%,60%)]" : "fill-[hsl(35,90%,58%)]"} opacity={0.85} />
              <text x={x + bw / 2} y={H + 10} textAnchor="middle" className="fill-muted-foreground text-[8px]">{`'${s.end.slice(2, 4)}`}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-[10.5px] leading-snug text-muted-foreground">{he ? "העמודות: התשואה על ההון פחות עלות ההון בענף, בכל שנת כספים. מעל הקו העסק יצר ערך באותה שנה; מתחתיו, הוא הרוויח פחות ממה שההון שלו עולה." : "Bars: return on capital minus the industry's cost of capital, each fiscal year. Above the line, the business created value that year; below, it earned less than its capital costs."}</figcaption>
    </figure>
  );
}

function CheckRow({ c }: { c: ProvenCheck }) {
  const icon = c.pass === true ? <Check size={12} className="text-[hsl(199,85%,66%)]" /> : c.pass === false ? <XIcon size={12} className="text-[hsl(35,95%,64%)]" /> : <Minus size={12} className="text-muted-foreground" />;
  return (
    <div className="flex items-start gap-1.5 text-[11.5px] leading-snug">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1"><AutoTerms text={c.label} /></span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.value}</span>
    </div>
  );
}

/** Proven-Strong record for the company in the Lens. */
export default function TrackRecordCard({ row, loading }: { row: ProvenRow | null; loading: boolean }) {
  const he = useLensLang() === "he";
  const [open, setOpen] = useState(false);
  if (loading && !row) return <section className="rounded-lg border border-border p-3 text-xs text-muted-foreground">{he ? "קורא עשר שנים של דוחות שנתיים…" : "Reading ten years of annual reports…"}</section>;
  if (!row) return null;
  if (row.status !== "ok") {
    return <section className="rounded-lg border border-border p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground"><Term id="track_record">{he ? "רקורד" : "Track record"}</Term>: </span>{row.sentence ?? row.error ?? (he ? "לא זמין." : "not available.")}</section>;
  }
  const young = row.track === "young";
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Term id="track_record">{he ? "רקורד" : "Track record"}</Term></span>
        <ProvenBadge row={row} short={false} explain />
      </div>
      <p className="text-[13px] leading-snug"><AutoTerms text={row.sentence} /></p>
      {!young && row.series && <SpreadChart series={row.series} hurdle={row.hurdle} />}
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        <AutoTerms text={he ? (young
          ? "המבחן של דמודרן לעסק טוב הוא להרוויח על ההון יותר ממה שהוא עולה, לאורך שנים. לחברה צעירה עוד לא יכול להיות רקורד כזה — ולכן השאלה היא אם הדרך לשם כבר נראית במספרים."
          : "המבחן של דמודרן לעסק טוב: הוא מרוויח על ההון שלו יותר ממה שההון הזה עולה — וממשיך לעשות את זה. שנה מצוינת אחת מוכיחה מעט; הרקורד הוא הראיה.")
          : young
          ? "Damodaran's test of a good business is earning more on capital than it costs, for years. A young company can't have that record yet — so the question is whether the path toward it is already visible in the numbers."
          : "Damodaran's test of a good business: it earns more on its capital than that capital costs — and keeps doing it. One great year proves little; the record is the evidence."} />
      </p>
      {(row.archetypes?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.archetypes!.map((a) => <span key={a} className="rounded bg-muted/50 px-1.5 py-0.5 text-[10.5px]"><AutoTerms text={(he ? HE_ARCHETYPE : ARCHETYPE_TEXT)[a] ?? a} /></span>)}
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">
        {he ? (young ? "מה אנחנו מחפשים בחברה צעירה" : "איך זה נשפט") : young ? "What we look for in a young company" : "How it was judged"} <ChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground"><AutoTerms text={row.why} /></p>
          {row.track && <div className="text-[10.5px] text-muted-foreground">{he
            ? <>מסלול: {HE_TRACK_TEXT[row.track]}{row.life_stage ? ` · שלב: ${HE_STAGE[row.life_stage as Stage]?.label ?? row.life_stage} — השלב קובע איזה מבחן חל` : ""}</>
            : <>Track: {TRACK_TEXT[row.track]}{row.life_stage ? ` · stage: ${STAGE_LABEL[row.life_stage] ?? row.life_stage} — the stage decides which test applies` : ""}</>}</div>}
          {(row.checks ?? []).length > 0 && <div className="space-y-1">{row.checks!.map((c) => <CheckRow key={c.id} c={c} />)}</div>}
          {!young && (row.gates ?? []).length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-1.5">
              <div className="text-[10.5px] font-semibold text-muted-foreground">{he ? "האם הראיות מוצקות?" : "Is the evidence sound?"}</div>
              {row.gates!.map((c) => <CheckRow key={c.id} c={c} />)}
            </div>
          )}
          {(row.flags ?? []).filter((f) => FLAG_TEXT[f] && !(young && f === "rd_adjusted")).map((f) => <p key={f} className="text-[11px] leading-snug text-[hsl(40,90%,66%)]"><AutoTerms text={(he ? HE_FLAG : FLAG_TEXT)[f]} /></p>)}
          {he ? (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {young ? "השוואות לענף: " : "רף: "}{row.hurdle_source ?? "עלות ההון בענף"}{young ? "" : ", שמוחל על כל שנה"}. נתוני דוחות 10-K שנתיים{row.as_of ? <> עד שנת הכספים {ltr(row.as_of.slice(0, 4))}</> : ""}; הספים הם שיקול הדעת של האפליקציה ויכוילו מחדש.
            {!young && " התשואה על ההון כאן היא הגרסה המותאמת של דמודרן, שנה אחרי שנה — שיעור מס סטנדרטי, חכירות שנספרות כחוב, ומו\"פ שנחשב כהשקעה כשהוא מהותי — ולכן היא יכולה להיות שונה מהנתון של 12 החודשים האחרונים בחלק הרווחיות."}
          </p>
          ) : (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {young ? "Industry comparisons: " : "Hurdle: "}{row.hurdle_source ?? "industry cost of capital"}{young ? "" : ", applied to every year"}. Annual 10-K figures{row.as_of ? ` through FY ${row.as_of.slice(0, 4)}` : ""}; thresholds are the app's judgement and will be recalibrated.
            {!young && " Return on capital here is Damodaran's adjusted, year-by-year version — a standard tax rate, leases counted as debt, and R&D treated as investment where it's material — so it can differ from the trailing-twelve-month figure in the Profitability section."}
          </p>
          )}
        </div>
      )}
    </section>
  );
}
