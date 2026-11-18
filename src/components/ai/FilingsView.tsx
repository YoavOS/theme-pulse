import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, HelpCircle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { fileGet, fileStep, type AiLang, type CompanyFile, type Quoted } from "@/lib/ai";
import { touchLab } from "@/lib/labs";

/**
 * From the filings: what the company says about itself (10-K and the latest earnings release),
 * read by the AI and checked against its numbers. Quotes found word-for-word in the filing get a ✓.
 */
const STEPS: { id: "prepare" | "story" | "risks"; en: string; he: string }[] = [
  { id: "prepare", en: "Downloading the 10-K and the earnings release from the SEC…", he: "מוריד את הדוח השנתי והודעת הרווחים מה-SEC…" },
  { id: "story", en: "The AI is reading the business, management's discussion and the release (1–3 minutes)…", he: "ה-AI קורא את תיאור העסק, דיון ההנהלה וההודעה (1–3 דקות)…" },
  { id: "risks", en: "Comparing the risk factors with last year's…", he: "משווה את גורמי הסיכון לשנה שעברה…" },
];
const tone = (v: string) => (v === "yes" ? "text-[hsl(210,90%,65%)]" : v === "no" ? "text-[hsl(330,80%,65%)]" : "text-[hsl(40,90%,60%)]");

function Quote({ q }: { q: Quoted }) {
  if (!q.quote) return null;
  return (
    <span dir="ltr" className="mt-0.5 block text-[11.5px] italic text-muted-foreground">
      “{q.quote}” <span className="not-italic">({q.source})</span>{" "}
      {q.verified ? <CheckCircle2 size={11} className="inline text-[hsl(210,90%,65%)]" aria-label="found word-for-word in the filing" /> : <HelpCircle size={11} className="inline text-[hsl(40,90%,60%)]" aria-label="not found word-for-word — check the filing" />}
    </span>
  );
}

export default function FilingsView({ lang }: { lang: AiLang }) {
  const he = lang === "he";
  const [input, setInput] = useState("");
  const [symbol, setSymbol] = useState("");
  const [file, setFile] = useState<{ data: CompanyFile; model: string | null; created_at: string } | null | undefined>(undefined);
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { touchLab("filings"); }, []);
  useEffect(() => { if (!symbol) return; setFile(undefined); fileGet(symbol, lang).then((r) => setFile(r.file)).catch(() => setFile(null)); }, [symbol, lang]);
  const run = async () => {
    try {
      for (let i = 0; i < STEPS.length; i++) { setStep(i); await fileStep(symbol, lang, STEPS[i].id); }
      setFile((await fileGet(symbol, lang)).file);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setStep(null); }
  };
  const d = file?.data;
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); const s = input.trim().toUpperCase(); if (s) setSymbol(s); }} className="flex flex-wrap items-center gap-2">
        <span className="relative"><Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Ticker" className="h-9 w-40 rounded-md border border-border bg-muted/30 pl-7 pr-2 font-mono text-[13px] uppercase" /></span>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-[13px] hover:border-primary/50">{he ? "פתח" : "Open"}</button>
        {symbol && <button type="button" onClick={run} disabled={step !== null} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">{step !== null && <Loader2 size={13} className="animate-spin" />}{d ? (he ? "לקרוא שוב" : "Read again") : (he ? "לקרוא את הדוחות" : "Read the filings")}</button>}
      </form>
      {!symbol && <p className="text-[13px] text-muted-foreground">{he ? "מה החברה אומרת על עצמה — בדוח השנתי (10-K) ובהודעת הרווחים האחרונה — נקרא על ידי ה-AI ונבדק מול המספרים שלה." : "What the company says about itself — in its annual report (10-K) and latest earnings release — read by the AI and checked against its numbers."}</p>}
      {step !== null && <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-[13px] text-muted-foreground"><Loader2 size={14} className="animate-spin text-primary" />{he ? STEPS[step].he : STEPS[step].en}</div>}
      {symbol && file === null && step === null && <div className="rounded-lg border border-dashed border-border p-5 text-center text-[13px] text-muted-foreground">{he ? `עוד לא נקראו דוחות של ${symbol}.` : `${symbol}'s filings haven't been read yet.`}</div>}
      {d && (
        <div dir={he ? "rtl" : "ltr"} className="space-y-3 text-[13px]">
          <div className="flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
            {d.sources?.tenK && <a href={d.sources.tenK.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink size={11} /> 10-K {d.sources.tenK.filed}</a>}
            {d.sources?.release && <a href={d.sources.release.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink size={11} /> {he ? "הודעת רווחים" : "Earnings release"} {d.sources.release.filed}</a>}
            {file?.model && <span>{file.model}</span>}
          </div>
          <Card title={he ? "העסק במילים פשוטות" : "The business in plain words"}>
            <p>{d.story}</p>
            {!!d.segments?.length && <ul className="mt-1.5 space-y-0.5">{d.segments.map((x) => <li key={x.name}><span className="font-semibold">{x.name}</span> — {x.what}</li>)}</ul>}
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Card title={he ? "מתחרים שהדוח מזכיר" : "Competitors the filing names"}><p>{d.competitors?.length ? d.competitors.join(", ") : (he ? "לא מוזכרים בשמם" : "none named")}</p></Card>
            <Card title={he ? "תלות בלקוחות גדולים" : "Dependence on big customers"}><p>{d.customers?.concentration}</p>{d.customers && <Quote q={d.customers} />}</Card>
          </div>
          {!!d.edge_claims?.length && <Card title={he ? "מה החברה אומרת שמייחד אותה" : "What the company says sets it apart"}><ul className="space-y-1.5">{d.edge_claims.map((c, i) => <li key={i}>{c.claim}<Quote q={c} /></li>)}</ul><p className="mt-1.5 text-[11.5px] text-muted-foreground">{he ? "אלה טענות של ההנהלה, לא הוכחה. ההוכחה היא תשואה מעל עלות ההון לאורך שנים." : "These are management's claims, not proof. The proof is returns above the cost of capital, year after year."}</p></Card>}
          {d.three_p && <Card title={he ? "שלוש השאלות של דמודרן על הסיפור" : "Damodaran's three questions about the story"}>
            {(["possible", "plausible", "probable"] as const).map((k) => <p key={k} className="mb-1"><span className="font-semibold">{he ? { possible: "אפשרי?", plausible: "סביר?", probable: "מסתבר?" }[k] : { possible: "Possible?", plausible: "Plausible?", probable: "Probable?" }[k]}</span> <span className={tone(d.three_p![k]?.verdict)}>{d.three_p![k]?.verdict}</span> — {d.three_p![k]?.why}</p>)}
          </Card>}
          {!!d.words_vs_numbers?.length && <Card title={he ? "מילים מול מספרים" : "Words vs numbers"}>
            <ul className="space-y-2">{d.words_vs_numbers.map((w, i) => <li key={i}><span className={`font-semibold ${tone(w.agrees)}`}>{w.agrees === "yes" ? (he ? "מתאים" : "Agrees") : w.agrees === "no" ? (he ? "לא מתאים" : "Disagrees") : (he ? "חלקית" : "Partly")}</span> · {w.claim}<Quote q={w} /><span className="block text-[12px] text-foreground/80">{he ? "המספרים: " : "The numbers: "}{w.numbers_say}</span></li>)}</ul>
          </Card>}
          <div className="grid gap-3 md:grid-cols-2">
            {d.guidance && <Card title={he ? "תחזית ההנהלה" : "Management's outlook"}><p>{d.guidance.text}</p><Quote q={d.guidance} /></Card>}
            {d.backlog && <Card title={he ? "צבר הזמנות" : "Backlog"}><p>{d.backlog}</p></Card>}
          </div>
          {d.riskChanges && <Card title={he ? `מה השתנה בגורמי הסיכון${d.riskChanges.since ? ` מאז ${d.riskChanges.since}` : ""}` : `What changed in the risk factors${d.riskChanges.since ? ` since ${d.riskChanges.since}` : ""}`}>
            {d.riskChanges.summary ? <p>{d.riskChanges.summary}</p> : <p className="text-muted-foreground">{he ? "לא נמצאו שינויים משמעותיים." : "No meaningful changes found."}</p>}
            {!!d.riskChanges.notable?.length && <ul className="mt-1.5 space-y-1">{d.riskChanges.notable.map((n, i) => <li key={i}><span className={n.kind === "new" ? "text-[hsl(330,80%,65%)]" : "text-muted-foreground"}>{n.kind === "new" ? (he ? "חדש" : "New") : (he ? "הוסר" : "Dropped")}</span> · <span dir="ltr" className="italic">{n.heading}</span><span className="block text-[12px] text-foreground/80">{n.why}</span></li>)}</ul>}
          </Card>}
          {!!d.watch?.length && <Card title={he ? "מה לבדוק בדוחות הבאים" : "What to check in the next reports"}><ul className="list-disc space-y-0.5 ps-5">{d.watch.map((w) => <li key={w}>{w}</li>)}</ul></Card>}
          <p className="text-[11.5px] text-muted-foreground">{he ? "ההנהלה מציגה את החברה באור טוב, וה-AI יכול לטעות. ✓ = הציטוט נמצא מילה במילה בדוח; ? = לא נמצא, כדאי לבדוק במקור." : "Management presents the company in its best light, and the AI can misread. ✓ = the quote was found word-for-word in the filing; ? = not found, check the source."}</p>
        </div>
      )}
    </div>
  );
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border bg-card p-3.5"><h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>
);
