import { IndustryRealityPanel, RarityPanel } from "./EvidencePanels";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Lightbulb } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PRINCIPLES, TAKES } from "@/lib/proven/principles";
import { ARCHETYPE_TEXT, LABEL_TEXT, type ProvenRow } from "@/lib/proven/types";
import { valueOf, type Story } from "@/lib/lens/valuation";
import ProvenBadge from "./ProvenBadge";
import { AutoTerms, Term } from "@/components/lens/Term";
import { isoNums, ltr, useLensLang } from "@/lib/lens/i18n";
import { HE_ARCHETYPE, HE_LABEL_TEXT, heSentence } from "@/lib/lens/he/proven";
import { PRINCIPLES_HE, TAKES_HE, heShortDate } from "@/lib/lens/he/ideas";

type Row = Pick<ProvenRow, "symbol" | "label" | "sentence" | "industry" | "archetype" | "archetypes" | "score" | "median_spread" | "series" | "track">;
const GOOD = new Set(["elite", "proven"]);

function useProvenRows(enabled: boolean) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!enabled || rows) return;
    let alive = true;
    (async () => {
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as unknown as SupabaseClient).from("proven_strength")
          .select("symbol, label, sentence, industry, archetype, archetypes, score, median_spread, series, track").eq("status", "ok").range(from, from + 999) as { data: Row[] | null; error: unknown };
        if (error || !data) break;
        out.push(...data);
        if (data.length < 1000) break;
      }
      if (alive) setRows(out);
    })();
    return () => { alive = false; };
  }, [enabled, rows]);
  return rows;
}
const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

/** Growth adds value only when new capital earns more than it costs (Damodaran, Myth 5.3). */
function GrowthLab() {
  const he = useLensLang() === "he";
  const [roic, setRoic] = useState(15), [wacc, setWacc] = useState(9), [g, setG] = useState(12);
  const story = (r: number): Story => ({ revenue: 1000, opMargin: 20, targetMargin: 20, taxRate: 0.25, salesToCapital: r / 15, costOfCapital: wacc, riskFree: 4, terminalEdge: 0 });
  const vg = valueOf(story(roic), g).value, v0 = valueOf(story(roic), 0).value;
  const diff = (vg / v0 - 1) * 100;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="text-[13px] font-semibold">{he ? "מעבדת צמיחה: מתי צמיחה מוסיפה ערך?" : "Growth lab: when does growth add value?"}</div>
      {[[he ? "תשואה על הון חדש" : "Return on new capital", roic, setRoic, 2, 40], [he ? "עלות ההון" : "Cost of capital", wacc, setWacc, 4, 16], [he ? "צמיחה בהכנסות (5 שנים)" : "Revenue growth (5 yrs)", g, setG, 0, 40]].map(([l, v, set, mn, mx]) => (
        <label key={l as string} className="block">
          <div className="flex justify-between text-[11px]"><span className="text-muted-foreground"><AutoTerms text={l as string} /></span><span className="font-mono" dir="ltr">{(v as number).toFixed(0)}%</span></div>
          <input type="range" dir="ltr" min={mn as number} max={mx as number} step={1} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
        </label>
      ))}
      {he ? (
      <p className="text-[13px] leading-snug">
        צמיחה של {ltr(g + "%")} בשנה הופכת את העסק הזה לשווה <span className={`font-mono font-semibold ${diff >= 0 ? "text-[hsl(199,85%,70%)]" : "text-[hsl(35,95%,66%)]"}`}>{ltr(Math.abs(diff).toFixed(0) + "%")}</span> {diff >= 0 ? "יותר" : "פחות"} מאשר אם לא היה צומח בכלל.
      </p>
      ) : (
      <p className="text-[13px] leading-snug">
        Growing {g}% a year makes this business worth <span className={`font-mono font-semibold ${diff >= 0 ? "text-[hsl(199,85%,70%)]" : "text-[hsl(35,95%,66%)]"}`}>{diff >= 0 ? "+" : "−"}{Math.abs(diff).toFixed(0)}%</span> {diff >= 0 ? "more" : "less"} than not growing at all.
      </p>
      )}
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        <AutoTerms text={he
          ? (roic > wacc + 0.5 ? "הון חדש מרוויח יותר ממה שהוא עולה, ולכן כל דולר שמושקע מחדש שווה יותר מדולר — הצמיחה יוצרת ערך." : roic < wacc - 0.5 ? "הון חדש מרוויח פחות ממה שהוא עולה, ולכן ככל שהעסק צומח מהר יותר, הוא הורס יותר ערך. אפשר להעלות את התשואה מעל עלות ההון ולראות מה קורה." : "הון חדש מרוויח בערך את מה שהוא עולה: הצמיחה רק מגדילה את החברה, לא הופכת אותה לשווה יותר.")
          : roic > wacc + 0.5 ? "New capital earns more than it costs, so every reinvested dollar is worth more than a dollar — growth creates value." : roic < wacc - 0.5 ? "New capital earns less than it costs, so the faster it grows, the more value it destroys. Try raising the return above the cost of capital." : "New capital earns about what it costs: growth just makes the company bigger, not more valuable."} />
      </p>
    </div>
  );
}

/** Two companies in the same industry — one proven, one not. Predict before you look. */
function ComparePairs({ rows, onOpen }: { rows: Row[]; onOpen: (s: string) => void }) {
  const he = useLensLang() === "he";
  const pairs = useMemo(() => {
    const byInd = new Map<string, Row[]>();
    for (const r of rows) if (r.industry && r.track !== "young" && r.track !== "financial") { if (!byInd.has(r.industry)) byInd.set(r.industry, []); byInd.get(r.industry)!.push(r); }
    const out: { industry: string; a: Row; b: Row }[] = [];
    for (const [industry, rs] of byInd) {
      const good = rs.filter((r) => GOOD.has(r.label ?? "")).sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
      const weak = rs.filter((r) => r.label === "not_proven").sort((x, y) => (x.median_spread ?? 0) - (y.median_spread ?? 0));
      if (good.length && weak.length) out.push({ industry, a: good[0], b: weak[0] });
    }
    return out.sort((x, y) => x.industry.localeCompare(y.industry));
  }, [rows]);
  const [idx, setIdx] = useState(0);
  const [guess, setGuess] = useState("");
  const [shown, setShown] = useState(false);
  const pair = pairs[idx];
  // show them in a fixed but arbitrary order so the proven one isn't always first
  const [first, second] = useMemo(() => (pair ? (pair.a.symbol < pair.b.symbol ? [pair.a, pair.b] : [pair.b, pair.a]) : [null, null]), [pair]);
  if (!pairs.length || !first || !second) return <p className="text-xs text-muted-foreground">{he ? "ההשוואות יופיעו כשמספיק חברות יקבלו ציון (העבודה הלילית ממלאת את זה)." : "Comparisons appear once enough companies have been scored (the nightly job fills this in)."}</p>;
  const prof = (r: Row) => ({ margin: med((r.series ?? []).map((s) => s.margin)), turn: med((r.series ?? []).map((s) => s.turnover)) });
  const pa = prof(pair.a), pb = prof(pair.b);
  const route = pa.margin !== null && pb.margin !== null && pa.turn !== null && pb.turn !== null
    ? (pa.margin / Math.max(0.1, pb.margin) >= pa.turn / Math.max(0.01, pb.turn)
      ? (he ? "שיעור רווח — היא שומרת הרבה יותר מכל דולר הכנסות (כוח תמחור, בידול, יתרונות גודל)" : "margin — it keeps much more of each dollar of revenue (pricing power, differentiation, scale costs)")
      : (he ? "יעילות הון — היא צריכה הרבה פחות הון על כל דולר הכנסות" : "capital efficiency — it needs far less capital for each dollar of revenue"))
    : null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{he ? "השוואה בין שתי חברות" : "Compare two companies"}</span>
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setShown(false); setGuess(""); }} className="ms-auto rounded border border-border bg-background px-1.5 py-0.5 text-xs">
          {pairs.map((p, i) => <option key={p.industry} value={i}>{p.industry}</option>)}
        </select>
      </div>
      <p className="text-[12.5px] leading-snug">{he
        ? <>שתיהן בענף <span className="font-semibold">{pair.industry}</span>. אחת הרוויחה יותר מעלות ההון שלה במשך שנים; השנייה לא. אפשר להסתכל על שני הגרפים בעדשה — ואז להחליט איזו, ו<em>למה</em>, לפני החשיפה.</>
        : <>Both are in <span className="font-semibold">{pair.industry}</span>. One has earned more than its cost of capital for years; the other hasn't. Look at both charts in the Lens if you like — then decide which, and <em>why</em>, before revealing.</>}</p>
      <div className="flex gap-2">
        {[first, second].map((r) => <button key={r.symbol} onClick={() => onOpen(r.symbol)} className="rounded border border-border px-2 py-1 font-mono text-sm font-bold hover:bg-muted/40">{r.symbol}</button>)}
      </div>
      <textarea value={guess} onChange={(e) => setGuess(e.target.value)} rows={2} placeholder={he ? "הניחוש שלי ולמה…" : "My guess and why…"} className="w-full rounded-md border border-border bg-muted/20 p-2 text-[12.5px]" />
      {!shown ? (
        <button onClick={() => setShown(true)} disabled={guess.trim().length < 3} className="rounded-md bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-40">{he ? "חשיפה" : "Reveal"}</button>
      ) : (
        <div className="space-y-1.5">
          {[pair.a, pair.b].map((r) => (
            <div key={r.symbol} className="text-[12px] leading-snug"><span className="font-mono font-bold">{r.symbol}</span> <ProvenBadge row={r} short={false} explain /> <span className="text-muted-foreground"><AutoTerms text={he ? heSentence(r.sentence) : r.sentence} /></span></div>
          ))}
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            <span /> <span className="text-center font-mono">{pair.a.symbol}</span><span className="text-center font-mono">{pair.b.symbol}</span>
            <span className="text-muted-foreground"><Term id="operating_margin">{he ? "שיעור רווח אחרי מס" : "after-tax margin"}</Term></span><span className="text-center font-mono">{pa.margin?.toFixed(1) ?? "n/a"}%</span><span className="text-center font-mono">{pb.margin?.toFixed(1) ?? "n/a"}%</span>
            <span className="text-muted-foreground"><Term id="sales_to_capital">{he ? "הכנסות לכל דולר הון" : "revenue per $ of capital"}</Term></span><span className="text-center font-mono">{pa.turn?.toFixed(2) ?? "n/a"}×</span><span className="text-center font-mono">{pb.turn?.toFixed(2) ?? "n/a"}×</span>
          </div>
          {route && (he
            ? <p className="text-[12.5px] leading-snug"><span className="font-semibold">העיקרון: </span>תשואה על ההון = שיעור רווח × יעילות הון. {ltr(pair.a.symbol)} מנצחת בעיקר ב{route}. אותו ענף, אותה עלות הון — ההבדל הוא העסק.</p>
            : <p className="text-[12.5px] leading-snug"><span className="font-semibold">The principle: </span>return on capital = margin × capital efficiency. {pair.a.symbol} wins mainly on {route}. Same industry, same cost of capital — the difference is the business.</p>)}
        </div>
      )}
    </div>
  );
}

/** Proven companies grouped by how they earn their spread. */
function Gallery({ rows, onOpen }: { rows: Row[]; onOpen: (s: string) => void }) {
  const he = useLensLang() === "he";
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) if (GOOD.has(r.label ?? "") && r.archetype) { if (!m.has(r.archetype)) m.set(r.archetype, []); m.get(r.archetype)!.push(r); }
    return [...m.entries()].map(([k, rs]) => [k, rs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8)] as const).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  if (!groups.length) return <p className="text-xs text-muted-foreground">{he ? "חברות מוכחות יופיעו כאן אחרי שהעבודה הלילית תיתן להן ציון." : "Proven companies appear here once the nightly job has scored them."}</p>;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {groups.map(([k, rs]) => (
        <div key={k} className="rounded-lg border border-border p-3">
          <div className="text-[13px] font-semibold"><AutoTerms text={(he ? HE_ARCHETYPE : ARCHETYPE_TEXT)[k] ?? k} /></div>
          <div className="mt-1.5 space-y-1">
            {rs.map((r) => (
              <button key={r.symbol} onClick={() => onOpen(r.symbol)} title={(he ? heSentence(r.sentence) : r.sentence) ?? ""} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-muted/40">
                <span className="w-14 font-mono text-xs font-bold">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{r.industry}</span>
                <span className="font-mono text-[11px]" dir="ltr">{r.median_spread !== null ? `+${r.median_spread.toFixed(0)} pp` : ""}</span>
                <span className="text-[10px] text-muted-foreground">{r.label ? (he ? HE_LABEL_TEXT[r.label].replace("מוכחת · ", "") : LABEL_TEXT[r.label].replace("Proven · ", "")) : ""}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Damodaran's ideas" — the principles behind every card in the Lens, taught through real companies. */
export default function IdeasView({ onOpen, active = true }: { onOpen: (symbol: string) => void; active?: boolean }) {
  const rows = useProvenRows(active);
  const he = useLensLang() === "he";
  const [openP, setOpenP] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-4 py-5 sm:px-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Lightbulb size={18} className="text-[hsl(40,90%,60%)]" /> {he ? "לחשוב כמו דמודרן" : "Think like Damodaran"}</h2>
        <p className="max-w-3xl text-[13px] leading-snug text-muted-foreground">{he
          ? <>שתים-עשרה שאלות ש<Term id="damodaran">הוא</Term> שואל על כל חברה. כל כרטיס אומר איפה האפליקציה מראה את זה. ללמוד את השאלות, לא את המספרים — השאלות עובדות על כל חברה, בכל גיל.</>
          : <>Twelve questions <Term id="damodaran">he</Term> asks of every company. Each card says where the app shows it. Learn the questions, not the numbers — the questions work on any company, at any age.</>}</p>
      </header>

      <section className="grid items-start gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {PRINCIPLES.map((p0, i) => {
          const h = he ? PRINCIPLES_HE[p0.id] : null;
          const p = h ? { ...p0, ...h } : p0;
          const open = openP === p.id;
          return (
            <article key={p.id} className="rounded-lg border border-border p-3">
              <button onClick={() => setOpenP(open ? null : p.id)} className="w-full text-start">
                <div className="text-[10.5px] font-semibold text-muted-foreground">{i + 1}</div>
                <div className="text-[14px] font-semibold leading-snug"><AutoTerms text={p.question} /></div>
              </button>
              {open ? (
                <div className="mt-2 space-y-1.5 text-[12.5px] leading-snug">
                  <p><AutoTerms text={p.idea} /></p>
                  <p><span className="font-semibold">{he ? "איפה רואים את זה: " : "See it: "}</span><span className="text-muted-foreground"><AutoTerms text={p.seeIt} /></span></p>
                  <p><span className="font-semibold">{he ? "המלכודת: " : "The trap: "}</span><span className="text-muted-foreground"><AutoTerms text={p.trap} /></span></p>
                  <div className="space-y-0.5 pt-1">
                    {p.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-[11px] text-primary hover:underline">
                        <ExternalLink size={11} className="mt-0.5 shrink-0" /> <span dir="ltr">{s.title}</span> ({he ? heShortDate(s.date) : s.date}){s.note ? ` — ${he && s.note === "second-hand summary" ? "סיכום ממקור משני" : s.note}` : ""}
                      </a>
                    ))}
                  </div>
                </div>
              ) : <button onClick={() => setOpenP(p.id)} className="mt-1 text-[11px] text-primary hover:underline">{he ? "פתיחה" : "Open"}</button>}
            </article>
          );
        })}
      </section>

      <section className="grid items-start gap-3 lg:grid-cols-2">
        <GrowthLab />
        {rows ? <ComparePairs rows={rows} onOpen={onOpen} /> : <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">{he ? "טוען חברות…" : "Loading companies…"}</div>}
      </section>

      <section className="grid items-start gap-3 lg:grid-cols-2">
        <RarityPanel />
        <IndustryRealityPanel />
      </section>

      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">{he ? "חברות מוכחות, לפי הדרך שבה הן מרוויחות" : "Proven companies, by how they earn it"}</h3>
        <p className="max-w-3xl text-[12px] text-muted-foreground"><AutoTerms text={he
          ? "תשואה על ההון = שיעור רווח × יעילות הון, ולכן יש יותר מדרך אחת לעסק נהדר. לחץ על חברה כדי לפתוח אותה בעדשה ולראות את הרקורד שלה. חברות טובות אינן אוטומטית השקעות טובות — כדאי לבדוק על מה המחיר מהמר."
          : "Return on capital = margin × capital efficiency, so there's more than one route to a great business. Click a company to open it in the Lens and see its record. Good companies aren't automatically good investments — check what the price is betting on."} /></p>
        {rows ? <Gallery rows={rows} onOpen={onOpen} /> : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">{he ? "בניתוחים שלו" : "In his own analysis"}</h3>
        <p className="max-w-3xl text-[12px] text-muted-foreground">{he ? "תמונות מצב מתוארכות של חברות שהוא כתב עליהן — הדעות שלו משתנות כשהמחירים משתנים. במילים של האפליקציה; המקור בקישור." : "Dated snapshots of companies he has written about — his views change as prices do. In the app's words; read the originals."}</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {TAKES.map((t) => (
            <div key={t.date + t.tickers[0]} className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-1">
                {t.tickers.filter((x) => !x.includes(".") && x !== "GOOG").map((x) => <button key={x} onClick={() => onOpen(x)} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-bold hover:bg-muted">{x}</button>)}
                <span className="ms-auto text-[10.5px] text-muted-foreground">{he ? heShortDate(t.date) : t.date}</span>
              </div>
              <p className="text-[12.5px] leading-snug"><AutoTerms text={he ? TAKES_HE[`${t.tickers[0]}|${t.date}`] ?? t.text : t.text} /></p>
              <a href={t.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><ExternalLink size={11} /> <span dir="ltr">{t.source.title}</span></a>
            </div>
          ))}
        </div>
      </section>

      <p className="pb-4 text-[10.5px] text-muted-foreground">{he ? "רעיונות של אסוואת' דמודרן (NYU Stern), מסוכמים במילים של האפליקציה עם קישורים לכתבים שלו (באנגלית). לימודי — לא ייעוץ השקעות." : "Ideas from Aswath Damodaran (NYU Stern), summarised in the app's own words with links to his writing. Educational — not investment advice."}</p>
    </div>
  );
}
