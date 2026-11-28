import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, ComposedChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { LensPayload } from "@/lib/lens/types";
import { metricMap } from "@/lib/lens/linked";
import { useLensLang } from "@/lib/lens/i18n";
import { buildScenarios } from "@/lib/lens/valuation";
import { AutoTerms, Term } from "./Term";

/**
 * Pictures for the Fundamentals Lens:
 *  ReturnMap     — the two routes to a high return: margin (across) × revenue per $ of capital (up), with lines of equal
 *                  return on capital; the company, its industry and the whole market as dots.
 *  IndustryBars  — the key measures side by side: the company, its industry, the market.
 *  GrowthAsk     — the growth the price needs in each story, next to the growth it actually delivered.
 */
const BLUE = "hsl(222,82%,66%)", PINK = "hsl(330,72%,60%)", AMBER = "hsl(35,95%,60%)", MUTED = "hsl(220,10%,55%)", TEAL = "hsl(170,60%,50%)";
const axis = { fontSize: 10, fill: MUTED };
const tip = { contentStyle: { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11, borderRadius: 6 }, labelStyle: { color: "hsl(var(--foreground))" } };
const num = (s: string | null | undefined) => { if (!s) return null; const m = s.replace(/[−–]/g, "-").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

export function ReturnMap({ p }: { p: LensPayload }) {
  const he = useLensLang() === "he";
  const v = p.valuation;
  const M = metricMap(p);
  const om = M.get("op_margin")?.value ?? v?.opMargin ?? null, s2c = M.get("sales_to_capital")?.value ?? v?.salesToCapital ?? null;
  if (p.financial || om == null || s2c == null || !v) return null;
  const tax = v.taxRate > 1 ? v.taxRate / 100 : v.taxRate;
  const indM = v.industryOpMargin, indT = v.industrySalesToCapital;
  const mktM = num(M.get("op_margin")?.bench?.market), mktT = num(M.get("sales_to_capital")?.bench?.market);
  const xMax = Math.min(80, Math.max(40, (om ?? 0) * 1.25, (indM ?? 0) * 1.3)), yMax = Math.min(8, Math.max(2.5, s2c * 1.25, (indT ?? 0) * 1.4));
  // lines of equal after-tax return on capital: margin × (1 − tax) × turnover = R
  const levels = [v.costOfCapital, 20, 40].filter((r, i, a) => a.indexOf(r) === i);
  const curve = Array.from({ length: 40 }, (_, i) => {
    const x = 1 + (i * (xMax - 1)) / 39;
    const row: Record<string, number | null> = { x };
    levels.forEach((r, k) => { const y = r / (x * (1 - tax)); row[`r${k}`] = y <= yMax ? y : null; });
    return row;
  });
  const dots = [
    { x: om, y: s2c, name: p.symbol, fill: BLUE },
    ...(indM != null && indT != null ? [{ x: indM, y: indT, name: he ? "הענף" : "Industry", fill: AMBER }] : []),
    ...(mktM != null && mktT != null ? [{ x: mktM, y: mktT, name: he ? "השוק" : "Market", fill: MUTED }] : []),
  ].map((d) => ({ ...d, x: Math.min(xMax, Math.max(0, d.x)), y: Math.min(yMax, Math.max(0, d.y)) }));
  return (
    <div className="px-3 pb-2">
      <div className="text-[11.5px] text-muted-foreground">{<AutoTerms text={he ? "שתי הדרכים לתשואה גבוהה: שיעור רווח (לרוחב) × הכנסות לכל דולר הון (לגובה). הקווים: תשואה שווה על ההון — הנמוך הוא עלות ההון." : "The two routes to a high return: margin (across) × revenue per $ of capital (up). Lines = equal return on capital; the lowest is the cost of capital."}/>}</div>
      <div className="h-56" dir="ltr">
        <ResponsiveContainer>
          <ComposedChart data={curve} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" domain={[0, xMax]} tick={axis} tickFormatter={(x) => `${x.toFixed(0)}%`} />
            <YAxis type="number" domain={[0, yMax]} tick={axis} width={32} tickFormatter={(y) => `${y.toFixed(1)}×`} />
            {levels.map((r, k) => <Line key={k} dataKey={`r${k}`} dot={false} stroke={k === 0 ? PINK : TEAL} strokeDasharray={k === 0 ? "4 3" : undefined} strokeOpacity={0.7} isAnimationActive={false} connectNulls={false} name={`${r.toFixed(0)}%`} />)}
            <Scatter data={dots} dataKey="y" isAnimationActive={false}>
              {dots.map((d, i) => <Cell key={i} fill={d.fill} />)}
              <LabelList dataKey="name" position="right" style={{ fontSize: 10.5, fill: "hsl(var(--foreground))" }} />
            </Scatter>
            <Tooltip {...tip} formatter={(val: number, name: string) => [typeof val === "number" ? val.toFixed(2) : val, name]} labelFormatter={(x) => `${Number(x).toFixed(0)}% margin`} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 text-[10.5px] text-muted-foreground" dir="ltr">
        <span><span className="me-1 inline-block w-4 border-t-2 border-dashed" style={{ borderColor: PINK }} />{levels[0].toFixed(1)}% <Term id="cost_of_capital">{he ? "(עלות ההון)" : "(cost of capital)"}</Term></span>
        {levels.slice(1).map((r) => <span key={r}><span className="me-1 inline-block w-4 border-t-2" style={{ borderColor: TEAL }} />{r}%</span>)}
      </div>
    </div>
  );
}

const KEY_METRICS = ["rev_cagr_3y", "gross_margin", "op_margin", "roic", "sales_to_capital", "reinvestment_rate", "sbc_intensity", "debt_to_ebitda"];

export function IndustryBars({ p }: { p: LensPayload }) {
  const he = useLensLang() === "he";
  const M = metricMap(p);
  const rows = KEY_METRICS.map((id) => M.get(id)).filter((m) => m && m.value != null && m.bench).map((m) => ({
    label: m!.label, unit: m!.unit, company: m!.value as number, industry: num(m!.bench!.display), market: num(m!.bench!.market), better: m!.bench!.position,
  })).filter((r) => r.industry != null);
  if (rows.length < 3) return null;
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{he ? "מול הענף והשוק" : "Against its industry and the market"}</div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const vals = [r.company, r.industry!, r.market ?? 0].map((x) => Math.abs(x));
          const max = Math.max(...vals, 1e-9);
          const fmt = (x: number | null) => (x == null ? "—" : r.unit === "x" ? `${x.toFixed(2)}×` : `${x.toFixed(1)}%`);
          const bar = (x: number | null, color: string, label: string) => (
            <div className="grid grid-cols-[64px_1fr_56px] items-center gap-2 text-[11px]" dir="ltr">
              <span className="text-muted-foreground">{label}</span>
              <span className="relative h-3 overflow-hidden rounded bg-muted/40"><span className="absolute inset-y-0 left-1/2 border-l border-muted-foreground/60"/><span className="absolute h-full rounded" style={{ left: `${x != null && x < 0 ? 50 - Math.abs(x) / max * 50 : 50}%`, width: `${x == null ? 0 : (Math.abs(x) / max) * 50}%`, background: x != null && x < 0 ? PINK : color }} /></span>
              <span className="text-right font-mono">{fmt(x)}</span>
            </div>
          );
          return (
            <div key={r.label}>
              <div className="mb-0.5 text-[12px]"><AutoTerms text={r.label} /></div>
              {bar(r.company, BLUE, p.symbol)}
              {bar(r.industry, AMBER, he ? "ענף" : "Industry")}
              {r.market != null && bar(r.market, MUTED, he ? "שוק" : "Market")}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function GrowthAsk({ p }: { p: LensPayload }) {
  const he = useLensLang() === "he";
  const v = p.valuation;
  if (!v) return null;
  const ev = (v.marketCap + v.debt - v.cash);
  const sc = buildScenarios(v, ev, 4.2);
  const name: Record<string, string> = he ? { cautious: "נוכחית", typical: "ענפית", optimistic: "משופרת" } : { cautious: "Current", typical: "Industry", optimistic: "Stronger" };
  const data = [
    ...(v.pastGrowth3y != null ? [{ k: he ? "בפועל, 3 שנים" : "Delivered (3y)", g: v.pastGrowth3y, kind: "past" }] : []),
    ...(v.industryGrowth5y != null ? [{ k: he ? "הענף, 5 שנים" : "Industry (5y)", g: v.industryGrowth5y, kind: "ind" }] : []),
    ...sc.filter((s) => s.implied.kind === "ok" || s.implied.kind === "shrink").map((s) => ({ k: `${he ? "המחיר צריך" : "Price needs"}: ${name[s.id]}`, g: s.implied.kind === "ok" ? s.implied.growth : -20, kind: "need" })),
  ].map((d) => ({ ...d, real: Math.round(d.g * 10) / 10, g: Math.max(-40, Math.min(80, Math.round(d.g * 10) / 10)) }));   // bars capped at ±, labels show the real value
  if (data.filter((d) => d.kind === "need").length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11.5px] text-muted-foreground"><AutoTerms text={he ? "צמיחת הכנסות בשנה: מה שהמחיר צריך בכל סיפור, מול מה שהחברה והענף עשו." : "Revenue growth a year: what the price needs in each story, against what the company and its industry did."} /></div>
      <div className="h-44" dir="ltr">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 34, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={axis} tickFormatter={(x) => `${x}%`} />
            <YAxis type="category" dataKey="k" tick={{ ...axis, fontSize: 10.5 }} width={130} />
            <ReferenceLine x={0} stroke={MUTED} />
            <Tooltip {...tip} formatter={(_x: number, _n: string, it: { payload?: { real?: number } }) => [`${it?.payload?.real}% a year`, ""]} />
            <Bar dataKey="g" radius={3} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.kind === "need" ? BLUE : d.kind === "past" ? AMBER : MUTED} fillOpacity={d.kind === "need" ? 0.85 : 0.6} />)}
              <LabelList dataKey="real" position="right" formatter={(x: number) => `${x}%`} style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
