import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { READING_GUIDE } from "@/lib/lens/readingGuide";

/**
 * "What the numbers can't tell you" — Damodaran's point that numbers need a story: for this company,
 * where its numbers are least reliable, the odds its edge lasts (from the 10-K history of every company),
 * and the questions only its story can answer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Fade { above5: number; level: string; n5: number; kept5: number | null; most5: number | null; n3: number; kept3: number | null }
interface Base { k: number; kept_pct: number; strong_pct: number; all_kept_pct: number }

let fadeCache: Fade[] | null = null;
function useFade(symbol: string) {
  const [fade, setFade] = useState<Fade[] | null>(fadeCache);
  const [base, setBase] = useState<Base | null>(null);
  useEffect(() => {
    let alive = true;
    if (!fadeCache) db.from("fade_rates").select("*").then(({ data }: { data: Fade[] | null }) => { fadeCache = data ?? []; if (alive) setFade(fadeCache); });
    db.from("lookalike_base").select("k, kept_pct, strong_pct, all_kept_pct").eq("symbol", symbol).maybeSingle().then(({ data }: { data: Base | null }) => { if (alive) setBase(data); });
    return () => { alive = false; };
  }, [symbol]);
  return { fade, base };
}

export default function LimitsCard({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const { fade, base } = useFade(p.symbol);

  const warnings = useMemo(() => {
    const w: { title: string; text: string }[] = [];
    const stage = p.lifeCycle?.stage;
    const flags = new Set(proven?.flags ?? []);
    const a = p.adjust;
    if (p.financial || proven?.track === "financial") w.push({ title: "A bank or insurer", text: "For financial companies debt is raw material, so return on capital, margins and debt ratios don't mean what they mean elsewhere. Look at return on equity against the cost of equity, and book value." });
    if (stage === "startup" || stage === "young_growth" || proven?.track === "young") w.push({ title: "Young company", text: "Its past numbers say little about its future — the value rests almost entirely on the story (how big it can get, what margins it can reach). Losses now can be fine; the question is whether the story is plausible." });
    if (a?.rndTtm && a.revenueTtm && a.rndTtm / a.revenueTtm >= 0.08) w.push({ title: `Heavy R&D (${Math.round((100 * a.rndTtm) / a.revenueTtm)}% of revenue)`, text: "Accounting treats R&D as an expense, though it builds future products. Reported profit is understated and return on capital overstated; the R&D card shows Damodaran's correction." });
    if (proven?.track === "cyclical" || flags.has("cyclical_by_volatility")) w.push({ title: "Cyclical", text: "Its returns swing with the economy or commodity prices. One year — good or bad — is not the normal level; use the multi-year average." });
    if (flags.has("ex_goodwill_better")) w.push({ title: "Acquisitions", text: "A large part of its capital is goodwill from acquisitions. The business itself earns much more than the total return shows — the question is whether it overpaid." });
    if (a?.leaseNow && a.icBase && a.leaseNow / a.icBase > 0.2) w.push({ title: "Big lease commitments", text: "Leases are debt in disguise; the Lens counts them, which lowers return on capital and raises debt compared with the reported figures." });
    if (flags.has("stale_filings")) w.push({ title: "Old filings", text: "No annual report in about two years — the numbers may be out of date." });
    if ((proven?.years_valid ?? 10) < 7 && proven?.status === "ok") w.push({ title: `Only ${proven?.years_valid} years of data`, text: "Too few years to tell a lasting edge from a good run." });
    return w;
  }, [p, proven]);

  // this company's record → the matching fade-rate row
  const odds = useMemo(() => {
    const s = (proven?.series ?? []).map((x) => x.spread).filter((x): x is number => typeof x === "number");
    if (s.length < 5 || !fade?.length) return null;
    const last5 = s.slice(-5), last3 = s.slice(-3).sort((x, y) => x - y);
    const above5 = last5.filter((x) => x > 0).length, med = last3[1];
    const level = med < 0 ? "below" : med < 5 ? "0-5" : med < 15 ? "5-15" : "15+";
    const row = fade.find((f) => f.above5 === above5 && f.level === level);
    return row && row.n5 >= 20 ? { above5, level, row } : null;
  }, [proven, fade]);

  const story = [
    { q: "Why does it earn more than its capital costs — what stops competitors from copying it?", where: "10-K, Item 1 (Business → Competition) — then compare with its competitors' returns." },
    { q: "How big can it get? Is the market it is priced for big enough for it and all its rivals?", where: "Industry reports, the company's own market-size claims (Investor Day), and the Fundamentals → Ideas industry check." },
    { q: "Is management investing at good returns, or growing for its own sake?", where: "10-K, Item 7 (Management's discussion) and the return on new capital in the Lens." },
    { q: "What could break the story?", where: "10-K, Item 1A (Risk factors) — especially new risks compared with last year." },
    { q: "Is the price already counting on all of this?", where: "The price story card above: what the price needs, and whether it is possible, plausible, probable." },
  ];

  return (
    <section className="rounded-lg border border-[hsl(40,90%,55%)]/30 p-3 text-[12.5px]">
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldAlert size={14} className="text-[hsl(40,90%,60%)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(40,90%,60%)]">What the numbers can't tell you</span>
        <ReadingGuideButton />
      </div>
      <p className="mb-2 text-foreground/85">Damodaran: numbers without a story become a spreadsheet fantasy; a story without numbers is a fairy tale. The numbers here describe the past — the value rests on the future.</p>

      {warnings.length > 0 && (
        <div className="mb-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground">Where {p.symbol}'s numbers are least reliable</div>
          {warnings.map((w) => <p key={w.title}><span className="font-semibold">{w.title}.</span> <span className="text-foreground/85">{w.text}</span></p>)}
        </div>
      )}

      {(odds || base) && (
        <div className="mb-2 rounded-md bg-muted/30 p-2">
          <div className="text-[11px] font-semibold text-muted-foreground">Will the edge last? The odds from history</div>
          {odds && (
            <p className="mt-0.5">Companies that beat their cost of capital in {odds.above5} of 5 years, with a recent spread of {odds.level === "below" ? "below zero" : `${odds.level} points`}: <span className="font-semibold">{odds.row.kept5}%</span> were still above it 5 years later; {odds.row.most5}% stayed above in at least 4 of the next 5 years <span className="text-muted-foreground">({odds.row.n5} cases)</span>.</p>
          )}
          {base && (
            <p className="mt-0.5">Of the {base.k} past companies that looked most like {p.symbol} does now, <span className="font-semibold">{base.kept_pct}%</span> kept earning above their cost of capital in 4+ of the next 5 years (for all companies: {base.all_kept_pct}%).</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Only companies still listed today are in this history — failed ones are missing — so these odds are somewhat too optimistic.</p>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground">Questions only the story can answer</div>
        {story.map((s) => <p key={s.q}><span className="text-foreground">{s.q}</span> <span className="text-muted-foreground">— {s.where}</span></p>)}
      </div>
    </section>
  );
}

export function ReadingGuideButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"><BookOpen size={11} /> How to read these numbers</button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>How to read these numbers</DialogTitle></DialogHeader>
        <div className="space-y-4 text-[13px]">
          {READING_GUIDE.map((g) => (
            <div key={g.id}>
              <div className="font-semibold">{g.name}</div>
              <p className="text-foreground/90">{g.says}</p>
              <div className="mt-1 text-[12px] font-semibold text-muted-foreground">How it can mislead</div>
              <ul className="list-disc space-y-0.5 ps-5 text-foreground/85">{g.misleads.map((m) => <li key={m}>{m}</li>)}</ul>
              <p className="mt-1"><span className="font-semibold text-muted-foreground">Read it with: </span>{g.pairWith}</p>
              {g.link && <a href={g.link.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"><ExternalLink size={11} /> {g.link.title}</a>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
