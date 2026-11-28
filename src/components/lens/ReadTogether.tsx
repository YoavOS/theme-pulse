import { useMemo, useState } from "react";
import { BookOpenText, ChevronDown, Link2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { invokeAi } from "@/lib/ai";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { linkedReads, metricMap, type LinkedRead, type ReadTone } from "@/lib/lens/linked";
import { buildScenarios } from "@/lib/lens/valuation";
import { useLensLang } from "@/lib/lens/i18n";
import { touchLab } from "@/lib/labs";
import AiMarkdown from "@/components/ai/AiMarkdown";
import { ReturnMap } from "./LensVisuals";
import { AutoTerms } from "./Term";

/**
 * "Read together": the metrics that only make sense as a set (margin × capital use = return on capital,
 * reinvestment × return = growth, …), explained together for this company — and "The long story",
 * a long, readable walk through all of it written by the AI from the same facts.
 */
const DOT: Record<ReadTone, string> = { good: "bg-[hsl(210,90%,62%)]", mixed: "bg-[hsl(40,90%,58%)]", weak: "bg-[hsl(330,80%,62%)]", neutral: "bg-muted-foreground/60" };

export default function ReadTogether({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const he = useLensLang() === "he";
  const reads = useMemo(() => linkedReads(p, he), [p, he]);
  const [open, setOpen] = useState<string | null>(reads[0]?.id ?? null);
  const [story, setStory] = useState<{ content: string; model: string; created_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  if (!reads.length) return null;

  const loadStory = async (refresh = false) => {
    touchLab("longstory");
    setShow(true);
    if (story && !refresh) return;
    setBusy(true);
    try {
      const facts = buildFacts(p, proven, linkedReads(p, false));
      const data = await invokeAi("ai-analyst", { action: "longstory", symbol: p.symbol, lang: he ? "he" : "en", facts, factsAt: p.computedAt, refresh });
      setStory(data);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); setShow(false); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Link2 size={13} className="text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{he ? "לקרוא ביחד" : "Read together"}</span>
        <button onClick={() => loadStory()} className="ms-auto inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary hover:bg-primary/20">
          <BookOpenText size={13} /> {he ? "הסיפור המלא" : "The long story"}
        </button>
      </div>
      <p className="px-3 pb-1 pt-1 text-[11.5px] text-muted-foreground">{<AutoTerms text={he ? "מדדים שמשמעותם מתבררת רק כשקוראים אותם יחד." : "Metrics that only mean something when read as a set."}/>}</p>
      <ReturnMap p={p} />
      <div className="divide-y divide-border/60">
        {reads.map((r) => <ReadRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
      </div>

      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent dir={he ? "rtl" : "ltr"} className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{he ? `הסיפור המלא של ${p.symbol}` : `The long story of ${p.symbol}`}</DialogTitle></DialogHeader>
          {busy ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 size={15} className="animate-spin text-primary" />{he ? "ה-AI כותב מתוך המספרים של החברה (1–3 דקות)…" : "The AI is writing from the company's numbers (1–3 minutes)…"}</div>
          ) : story ? (
            <div className="space-y-3">
              <AiMarkdown text={story.content} className="text-[14px] leading-relaxed" />
              <div className="flex items-center gap-2 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
                <span>{story.model} · {new Date(story.created_at).toLocaleDateString()}</span>
                <button onClick={() => loadStory(true)} className="ms-auto inline-flex items-center gap-1 hover:text-foreground"><RefreshCw size={11} /> {he ? "לכתוב מחדש" : "Rewrite"}</button>
              </div>
              <p className="text-[11px] text-muted-foreground">{he ? "נכתב על ידי AI מתוך הנתונים שבעדשה בלבד. המספרים נבדקים בקוד, הניסוח לא — אם משהו נשמע מוזר, הכרטיסים בעדשה הם המקור." : "Written by the AI from the Lens figures only. The numbers are computed in code; the wording isn't checked — if something sounds off, the Lens cards are the source."}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReadRow({ r, open, onToggle }: { r: LinkedRead; open: boolean; onToggle: () => void }) {
  return (
    <div className="px-3 py-2">
      <button onClick={onToggle} className="flex w-full items-start gap-2 text-start">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.tone]}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-muted-foreground"><AutoTerms text={r.title} /></span>
          <span className="block text-[13px] font-semibold"><AutoTerms text={r.headline} /></span>
        </span>
        <ChevronDown size={13} className={`mt-1 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 ps-4 text-[12.5px] leading-relaxed">
          {r.body.map((b, i) => <p key={i} className="text-foreground/90"><AutoTerms text={b} /></p>)}
          {r.uses.length > 0 && <div className="flex flex-wrap gap-1 pt-0.5">{r.uses.map((u) => <span key={u.label} dir="ltr" className="rounded bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"><AutoTerms text={u.label} />: <span className="font-mono text-foreground/80"><AutoTerms text={u.display} /></span></span>)}</div>}
        </div>
      )}
    </div>
  );
}

/** Everything the long story may use, as plain facts (English; the AI writes in the reader's language). */
function buildFacts(p: LensPayload, proven: ProvenRow | null, reads: LinkedRead[]) {
  const M = metricMap(p);
  const metrics = [...M.values()].filter((m) => m.display !== "n/a").map((m) => ({
    metric: m.label, value: m.display, period: m.period,
    industry: m.bench ? { name: m.bench.industry, average: m.bench.display, position: m.bench.position, market: m.bench.market } : undefined,
    peers: m.peer ? { group: m.peer.group, percentile: m.peer.pct, median: m.peer.median } : undefined,
  }));
  const v = p.valuation;
  let price: Record<string, unknown> | undefined;
  if (v) {
    const ev = Math.max(1, v.marketCap + v.debt - v.cash);
    const sc = buildScenarios(v, ev, 4.2);
    price = {
      enterpriseValue: ev, marketCap: v.marketCap, costOfCapital: v.costOfCapital, pastGrowth3y: v.pastGrowth3y, industryGrowth5y: v.industryGrowth5y,
      impliedSalesGrowthNext5y: Object.fromEntries(sc.map((s) => [s.id, s.implied.kind === "ok" ? Math.round(s.implied.growth * 10) / 10 : s.implied.kind])),
      note: "implied growth = the yearly revenue growth the price needs under each story (negative = the price works even if revenue shrinks)",
    };
  }
  return {
    company: p.company, symbol: p.symbol, industry: p.classification, damodaranIndustry: p.damodaran?.name, financialCompany: p.financial,
    lifeCycle: p.lifeCycle ? { stage: p.lifeCycle.label, confidence: p.lifeCycle.confidence, keyQuestion: p.lifeCycle.question } : null,
    storyLines: p.story, snapshot: p.snapshot,
    trackRecord: proven ? { label: proven.label, sentence: proven.sentence, yearsAbove: proven.years_above, yearsValid: proven.years_valid, medianSpreadPts: proven.median_spread, track: proven.track, flags: proven.flags,
      byYear: (proven.series ?? []).map((s) => ({ year: s.end?.slice(0, 4), spreadPts: s.spread != null ? Math.round(s.spread * 10) / 10 : null })) } : null,
    readTogether: reads.map((r) => ({ topic: r.title, headline: r.headline, explanation: r.body.join(" ") })),
    metrics, price, secAsOf: p.sec.asOf,
  };
}
