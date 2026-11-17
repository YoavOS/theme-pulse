import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LABEL_TEXT, type ProvenLabel } from "@/lib/proven/types";

/**
 * Two reality checks from the app's own 10-K history:
 *  - How rare is a proven record? (calibration of the labels, and the "7 of 10 years" question)
 *  - What is each industry priced for? (Damodaran's "big market delusion", at the industry level)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Rarity { companies: number; above_70pct: number; pct_above_70pct: number; pct_every_year: number; pct_never: number }
interface Calib { industry: string; label: ProvenLabel; n: number; pct: number }
interface Ind { industry: string; n: number; cap_b: number; roic: number | null; cost_of_capital: number | null; earnings_yield: number | null; median_revenue_growth: number | null; implied_growth: number | null }
interface Fade { above5: number; level: string; n5: number; kept5: number | null; most5: number | null }

export function RarityPanel() {
  const [r, setR] = useState<Rarity | null>(null);
  const [c, setC] = useState<Calib[]>([]);
  const [f, setF] = useState<Fade[]>([]);
  useEffect(() => {
    db.from("proven_rarity").select("*").maybeSingle().then(({ data }: { data: Rarity | null }) => setR(data));
    db.from("proven_calibration").select("*").eq("industry", "(all)").then(({ data }: { data: Calib[] | null }) => setC(data ?? []));
    db.from("fade_rates").select("above5, level, n5, kept5, most5").then(({ data }: { data: Fade[] | null }) => setF(data ?? []));
  }, []);
  if (!r?.companies) return null;
  const order: ProvenLabel[] = ["elite", "proven", "proven_caveat", "fading", "was_strong", "emerging", "emerging_early", "provisional", "not_proven", "insufficient"];
  const fr = (a: number, l: string) => f.find((x) => x.above5 === a && x.level === l);
  const levels = ["below", "0-5", "5-15", "15+"];
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-[12.5px]">
      <h3 className="text-[15px] font-semibold">How rare is a proven record?</h3>
      <p>Of the <span className="font-semibold">{r.companies.toLocaleString()}</span> companies with 8+ years of annual reports, <span className="font-semibold">{r.pct_above_70pct}%</span> earned more than their cost of capital in at least 7 of every 10 years; {r.pct_every_year}% did it every single year, and {r.pct_never}% never did.</p>
      <div className="flex flex-wrap gap-1.5">
        {order.map((l) => { const x = c.find((y) => y.label === l); return x ? <span key={l} className="rounded-md bg-muted/40 px-2 py-0.5">{LABEL_TEXT[l]}: <span className="font-semibold">{x.pct}%</span></span> : null; })}
      </div>
      {f.length > 0 && (
        <>
          <div className="pt-1 text-[12px] font-semibold">Fade meter — still above the cost of capital 5 years later</div>
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <thead><tr className="text-muted-foreground"><th className="pr-3 text-left font-medium">Years above (of 5)</th>{levels.map((l) => <th key={l} className="px-2 text-right font-medium">{l === "below" ? "spread < 0" : `spread ${l} pts`}</th>)}</tr></thead>
              <tbody>
                {[5, 4, 3, 2, 1, 0].map((a) => (
                  <tr key={a}><td className="pr-3">{a}</td>{levels.map((l) => { const x = fr(a, l); return <td key={l} className="px-2 text-right tabular-nums">{x && x.n5 >= 20 ? `${x.kept5}%` : <span className="text-muted-foreground">—</span>}</td>; })}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">Read across: the better and steadier the record, the more often it lasted — but even the best records fade for some. Only companies still listed are counted (failed ones are missing), so the real odds are lower. "—" = fewer than 20 cases.</p>
        </>
      )}
    </section>
  );
}

export function IndustryRealityPanel() {
  const [rows, setRows] = useState<Ind[] | null>(null);
  const [sort, setSort] = useState<"implied" | "gap">("gap");
  useEffect(() => { db.from("industry_reality").select("*").then(({ data }: { data: Ind[] | null }) => setRows(data ?? [])); }, []);
  if (!rows?.length) return null;
  const gap = (x: Ind) => (x.implied_growth ?? NaN) - (x.median_revenue_growth ?? NaN);
  const list = [...rows].filter((x) => x.implied_growth != null).sort((a, b) => (sort === "gap" ? gap(b) - gap(a) : (b.implied_growth ?? 0) - (a.implied_growth ?? 0))).slice(0, 25);
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-[12.5px]">
      <h3 className="text-[15px] font-semibold">What is each industry priced for?</h3>
      <p className="text-muted-foreground">Damodaran's "big market delusion": when every company in a hot industry is priced as a winner, the industry as a whole is priced for more than the market can give. Here, all the members together: the growth in profits they would have to deliver, forever, to be worth today's price — next to how fast their revenue has actually grown.</p>
      <div className="flex gap-1 text-[11.5px]">
        <button onClick={() => setSort("gap")} className={`rounded-md border px-2 py-0.5 ${sort === "gap" ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}>Biggest stretch first</button>
        <button onClick={() => setSort("implied")} className={`rounded-md border px-2 py-0.5 ${sort === "implied" ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}>Highest priced-in growth</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Industry</th><th className="text-right font-medium">Companies</th><th className="text-right font-medium">Value $B</th><th className="text-right font-medium">Return on capital</th><th className="text-right font-medium">Cost of capital</th><th className="text-right font-medium">Priced-in growth, forever</th><th className="text-right font-medium">Revenue growth so far</th></tr></thead>
          <tbody>
            {list.map((x) => {
              const g = gap(x);
              return (
                <tr key={x.industry} className="border-t border-border/50">
                  <td className="py-1 pr-2">{x.industry}</td><td className="text-right">{x.n}</td><td className="text-right">{x.cap_b?.toLocaleString()}</td>
                  <td className="text-right">{x.roic ?? "—"}%</td><td className="text-right">{x.cost_of_capital ?? "—"}%</td>
                  <td className={`text-right font-semibold ${g > 3 ? "text-[hsl(330,80%,65%)]" : ""}`}>{x.implied_growth}%</td>
                  <td className="text-right">{x.median_revenue_growth ?? "—"}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Rough by design: market value stands in for enterprise value (debt and cash left out), only the liquid US-listed members count, and the formula assumes steady growth forever. A forever-growth rate above ~4–5% (the economy's long-run pace) is a story only a few companies can live up to. Not a forecast — a question to ask.</p>
    </section>
  );
}
