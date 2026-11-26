import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LABEL_TEXT, type ProvenLabel } from "@/lib/proven/types";
import { ltr, useLensLang } from "@/lib/lens/i18n";
import { HE_LABEL_TEXT } from "@/lib/lens/he/proven";
import { AutoTerms } from "@/components/lens/Term";

/**
 * Two reality checks from the app's own 10-K history:
 *  - How rare is a proven record? (calibration of the labels, and the "7 of 10 years" question)
 *  - What is each industry priced for? (Damodaran's "big market delusion", at the industry level)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Rarity { companies: number; above_70pct: number; pct_above_70pct: number; pct_every_year: number; pct_never: number }
interface Calib { industry: string; label: ProvenLabel; n: number; pct: number }
interface Ind { industry: string; n: number; cap_b: number; roic: number | null; cost_of_capital: number | null; earnings_yield: number | null; median_revenue_growth: number | null; implied_growth: number | null; model_status?: string }
interface Fade { above5: number; level: string; n5: number; kept5: number | null; most5: number | null }

export function RarityPanel() {
  const he = useLensLang() === "he";
  const [failed,setFailed] = useState(false), [attempt,setAttempt] = useState(0);
  const [r, setR] = useState<Rarity | null>(null);
  const [c, setC] = useState<Calib[]>([]);
  const [f, setF] = useState<Fade[]>([]);
  useEffect(() => {
    db.from("proven_rarity").select("*").maybeSingle().then(({ data,error }: { data: Rarity | null; error: unknown }) => { if(error)setFailed(true);else setR(data); });
    db.from("proven_calibration").select("*").eq("industry", "(all)").then(({ data,error }: { data: Calib[] | null; error: unknown }) => { if(error)setFailed(true);else setC(data ?? []); });
    db.from("fade_rates").select("above5, level, n5, kept5, most5").then(({ data,error }: { data: Fade[] | null; error: unknown }) => { if(error)setFailed(true);else setF(data ?? []); });
  }, [attempt]);
  if (failed) return <p role="alert" className="rounded-lg border border-border p-3 text-sm">{he?"נתוני ההשוואה אינם זמינים.":"Comparison data is unavailable."} <button className="underline" onClick={()=>{setFailed(false);setAttempt(x=>x+1);}}>{he?"ניסיון נוסף":"Retry"}</button></p>;
  if (!r?.companies) return null;
  const order: ProvenLabel[] = ["elite", "proven", "proven_caveat", "fading", "was_strong", "emerging", "emerging_early", "provisional", "not_proven", "insufficient"];
  const fr = (a: number, l: string) => f.find((x) => x.above5 === a && x.level === l);
  const levels = ["below", "0-5", "5-15", "15+"];
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-[12.5px]">
      <h3 className="text-[15px] font-semibold">{he ? "כמה נדיר רקורד מוכח?" : "How rare is a proven record?"}</h3>
      {he
        ? <p>מתוך <span className="font-semibold">{ltr(r.companies.toLocaleString())}</span> החברות עם {ltr(8)} שנות דוחות או יותר, <span className="font-semibold">{ltr(r.pct_above_70pct + "%")}</span> הרוויחו יותר מעלות ההון שלהן לפחות ב-{ltr(7)} מכל {ltr(10)} שנים; {ltr(r.pct_every_year + "%")} עשו את זה בכל שנה, ו-{ltr(r.pct_never + "%")} אף פעם לא.</p>
        : <p>Of the <span className="font-semibold">{r.companies.toLocaleString()}</span> companies with 8+ years of annual reports, <span className="font-semibold">{r.pct_above_70pct}%</span> earned more than their cost of capital in at least 7 of every 10 years; {r.pct_every_year}% did it every single year, and {r.pct_never}% never did.</p>}
      <div className="flex flex-wrap gap-1.5">
        {order.map((l) => { const x = c.find((y) => y.label === l); return x ? <span key={l} className="rounded-md bg-muted/40 px-2 py-0.5">{he ? HE_LABEL_TEXT[l] ?? LABEL_TEXT[l] : LABEL_TEXT[l]}: <span className="font-semibold" dir="ltr">{x.pct}%</span></span> : null; })}
      </div>
      {f.length > 0 && (
        <>
          <div className="pt-1 text-[12px] font-semibold">{he ? "מד השחיקה — עדיין מעל עלות ההון אחרי חמש שנים" : "Fade meter — still above the cost of capital 5 years later"}</div>
          <div className="overflow-x-auto">
            <table className="text-[12px]">
              <thead><tr className="text-muted-foreground"><th className="pe-3 text-start font-medium">{he ? "שנים מעל (מתוך 5)" : "Years above (of 5)"}</th>{levels.map((l) => <th key={l} className="px-2 text-end font-medium">{l === "below" ? (he ? "מרווח שלילי" : "spread < 0") : he ? <>מרווח {ltr(l)} נק'</> : `spread ${l} pts`}</th>)}</tr></thead>
              <tbody>
                {[5, 4, 3, 2, 1, 0].map((a) => (
                  <tr key={a}><td className="pe-3">{a}</td>{levels.map((l) => { const x = fr(a, l); return <td key={l} dir="ltr" className="px-2 text-end tabular-nums">{x && x.n5 >= 20 ? `${x.kept5}%` : <span className="text-muted-foreground">—</span>}</td>; })}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{<AutoTerms text={he ? "ככל שהרקורד טוב ויציב יותר, כך הוא החזיק יותר פעמים — אבל גם הרקורדים הטובים ביותר נשחקים אצל חלק מהחברות. נספרות רק חברות שעדיין נסחרות (חברות שנכשלו חסרות), ולכן הסיכויים האמיתיים נמוכים יותר. \"—\" = פחות מ-20 מקרים." : "Read across: the better and steadier the record, the more often it lasted — but even the best records fade for some. Only companies still listed are counted (failed ones are missing), so the real odds are lower. \"—\" = fewer than 20 cases."}/>}</p>
        </>
      )}
    </section>
  );
}

export function IndustryRealityPanel() {
  const he = useLensLang() === "he";
  const [failed,setFailed] = useState(false), [attempt,setAttempt] = useState(0);
  const [rows, setRows] = useState<Ind[] | null>(null);
  const [sort, setSort] = useState<"implied" | "gap">("gap");
  useEffect(() => { db.from("industry_reality").select("*").then(({ data,error }: { data: Ind[] | null; error: unknown }) => { if(error)setFailed(true);else setRows(data ?? []); }); }, [attempt]);
  if (failed) return <p role="alert" className="rounded-lg border border-border p-3 text-sm">{he?"נתוני ההשוואה אינם זמינים.":"Comparison data is unavailable."} <button className="underline" onClick={()=>{setFailed(false);setAttempt(x=>x+1);}}>{he?"ניסיון נוסף":"Retry"}</button></p>;
  if (!rows?.length) return null;
  const gap = (x: Ind) => x.implied_growth == null || x.median_revenue_growth == null ? -Infinity : x.implied_growth - x.median_revenue_growth;
  const list = [...rows].sort((a, b) => (sort === "gap" ? gap(b) - gap(a) : (b.implied_growth ?? 0) - (a.implied_growth ?? 0))).slice(0, 25);
  return (
    <section className="space-y-2 rounded-lg border border-border p-3 text-[12.5px]">
      <h3 className="text-[15px] font-semibold">{he ? "לאיזו צמיחה כל ענף מתומחר?" : "What is each industry priced for?"}</h3>
      <p className="text-muted-foreground">{<AutoTerms text={he ? "\"אשליית השוק הגדול\" של דמודרן: כשכל חברה בענף חם מתומחרת כמנצחת, הענף כולו מתומחר ליותר ממה שהשוק יכול לתת. כאן כל החברות בענף יחד: הצמיחה ברווחים שהן יצטרכו לספק, לתמיד, כדי להצדיק את המחיר של היום — לצד הקצב שבו ההכנסות שלהן באמת צמחו." : "Damodaran's \"big market delusion\": when every company in a hot industry is priced as a winner, the industry as a whole is priced for more than the market can give. Here, all the members together: the growth in profits they would have to deliver, forever, to be worth today's price — next to how fast their revenue has actually grown."}/>}</p>
      <div className="flex gap-1 text-[11.5px]">
        <button onClick={() => setSort("gap")} className={`rounded-md border px-2 py-0.5 ${sort === "gap" ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}>{he ? "הפער הגדול קודם" : "Biggest stretch first"}</button>
        <button onClick={() => setSort("implied")} className={`rounded-md border px-2 py-0.5 ${sort === "implied" ? "border-primary/50 text-primary" : "border-border text-muted-foreground"}`}>{he ? "הצמיחה המגולמת הגבוהה קודם" : "Highest priced-in growth"}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-muted-foreground"><tr>{(he ? ["ענף", "חברות", "שווי ($B)", "תשואה על ההון", "עלות ההון", "צמיחה מגולמת, לתמיד", "צמיחה בהכנסות עד כה"] : ["Industry", "Companies", "Value $B", "Return on capital", "Cost of capital", "Priced-in growth, forever", "Revenue growth so far"]).map((h, i) => <th key={h} className={`font-medium ${i ? "text-end" : "text-start"}`}><AutoTerms text={h} /></th>)}</tr></thead>
          <tbody>
            {list.map((x) => {
              const g = gap(x);
              return (
                <tr key={x.industry} className="border-t border-border/50">
                  <td className="py-1 pe-2">{x.industry}</td><td dir="ltr" className="text-end">{x.n}</td><td dir="ltr" className="text-end">{x.cap_b?.toLocaleString()}</td>
                  <td dir="ltr" className="text-end">{x.roic ?? "—"}%</td><td dir="ltr" className="text-end">{x.cost_of_capital ?? "—"}%</td>
                  <td dir="ltr" className={`text-end font-semibold ${g > 3 ? "text-[hsl(330,80%,65%)]" : ""}`}>{x.implied_growth == null ? (he ? "מחוץ לתחום המודל" : "Outside model bounds") : `${x.implied_growth}%`}</td>
                  <td dir="ltr" className="text-end">{x.median_revenue_growth ?? "—"}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{<AutoTerms text={he ? "גס בכוונה: שווי השוק משמש במקום שווי הפעילות (חוב ומזומנים לא נכללים), נספרות רק החברות האמריקאיות הסחירות, והנוסחה מניחה צמיחה קבועה לתמיד. צמיחה לתמיד מעל כ-4–5% (הקצב של הכלכלה לאורך זמן) היא סיפור שרק מעט חברות עומדות בו. זו לא תחזית — זו שאלה שכדאי לשאול." : "Rough by design: market value stands in for enterprise value (debt and cash left out), only the liquid US-listed members count, and the formula assumes steady growth forever. Rates outside the model bounds (including growth at or above the discount rate or 4.2%) are suppressed. Not a forecast — a question to ask."}/>}</p>
    </section>
  );
}
