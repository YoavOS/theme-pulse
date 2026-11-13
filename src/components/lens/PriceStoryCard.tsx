import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { buildScenarios, demandVsHistory, impliedGrowth, returnOnNewCapital, sizeMultiple, type Implied, type Scenario, type Story } from "@/lib/lens/valuation";
import { AutoTerms, Term } from "./Term";

// "What the price is betting on" — written for someone new to fundamentals. The app builds the stories
// (from the company's own numbers and its industry's averages) and explains them; experimenting with the
// levers is optional and tucked away.

const usd = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "−" : ""}$${a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(1) + "B" : (a / 1e6).toFixed(0) + "M"}`; };
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const RISK_FREE = 4.2;   // app assumption: US 10-year Treasury yield, late 2026
const TRILLION_POST = "https://aswathdamodaran.substack.com/p/trillion-dollar-market-caps-fairy";
const PARADOX_POST = "https://aswathdamodaran.blogspot.com/2017/03/explaining-paradox-why-good-bad.html";
const MCKINSEY = "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/balancing-roic-and-growth-to-build-value";

type Tone = "good" | "mid" | "hard";
const TONE_CLS: Record<Tone, string> = {
  good: "border-[hsl(199,85%,60%)]/50 bg-[hsl(199,85%,60%)]/12 text-[hsl(199,85%,72%)]",
  mid: "border-[hsl(40,90%,58%)]/50 bg-[hsl(40,90%,58%)]/12 text-[hsl(40,95%,70%)]",
  hard: "border-[hsl(25,90%,58%)]/55 bg-[hsl(25,90%,58%)]/12 text-[hsl(25,95%,68%)]",
};
const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`shrink-0 rounded border px-1.5 py-px text-[10.5px] font-semibold ${TONE_CLS[tone]}`}>{children}</span>;

type Biz = "good" | "unproven" | "weak";
type Ask = "less" | "same" | "more";
const bizOf = (label: string | null | undefined): Biz | null =>
  !label ? null : ["elite", "proven", "proven_caveat"].includes(label) ? "good" : ["provisional", "emerging", "fading", "was_strong"].includes(label) ? "unproven" : "weak";
const CELL: Record<Biz, Record<Ask, string>> = {
  good: {
    less: "A good business whose price asks for less than it has been doing — the corner of his matrix where business quality and price line up best (he'd still ask whether management is acting its age).",
    same: "A good business priced for more of the same. Owners would earn roughly what the business earns — no bargain, no bubble.",
    more: "What he calls \"admire, but don't buy\": a great business whose price already asks for more than it has delivered.",
  },
  unproven: {
    less: "The price asks for less than the business has been doing, but its record is short or slipping — the story still has to be proven.",
    same: "Priced for the story continuing. Fine if it does; the record to back it isn't there yet.",
    more: "Priced for a big story with no proven record yet — where hopes and results can part ways most sharply.",
  },
  weak: {
    less: "A weak business priced low. His matrix allows that a weak business can be a good investment at the right price — but something has to change.",
    same: "A business that hasn't earned its cost of capital, priced as if that's fine — the wrong side of the trade for an owner, in his matrix.",
    more: "A business that hasn't earned its cost of capital, priced for growth — the worst corner of his matrix: growth at these returns destroys value.",
  },
};

/** One plain line for a scenario's answer. */
function answerText(im: Implied, past: number | null): { text: string; tone: Tone } {
  if (im.kind === "growth_destroys") return { text: "growth can't get it there", tone: "hard" };
  if (im.kind === "beyond") return { text: "needs more than any realistic growth", tone: "hard" };
  if (im.kind === "shrink") return { text: "the price makes sense even if sales shrink", tone: "good" };
  const d = demandVsHistory(im.growth, past);
  const tone: Tone = d === "less" || d === "same" ? "good" : d === "more" ? "mid" : d === "much_more" ? "hard" : im.growth <= 15 ? "mid" : "hard";
  return { text: `needs about ${im.growth.toFixed(0)}% sales growth a year`, tone };
}

function Slider({ label, plain, value, min, max, step, unit, onChange, hint }: { label: string; plain: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="block space-y-0.5">
      <div className="flex justify-between text-[11.5px]"><span className="font-medium">{label}</span><span className="font-mono tabular-nums">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span></div>
      <div className="text-[10.5px] text-muted-foreground"><AutoTerms text={plain} /></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

export default function PriceStoryCard({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const v = p.valuation;
  const [open, setOpen] = useState(true);
  const [learn, setLearn] = useState(false);
  const [lab, setLab] = useState(false);
  const ev = v ? Math.max(1, v.marketCap + v.debt - v.cash) : 1;
  const scenarios = useMemo<Scenario[]>(() => (v ? buildScenarios(v, ev, RISK_FREE) : []), [v, ev]);
  const typical = scenarios.find((s) => s.id === "typical");
  // optional experiment — starts from the typical story
  const [margin, setMargin] = useState<number | null>(null);
  const [s2c, setS2c] = useState<number | null>(null);
  const [wacc, setWacc] = useState<number | null>(null);
  const labStory = useMemo<Story | null>(() => (typical ? { ...typical.story, targetMargin: margin ?? typical.story.targetMargin, salesToCapital: s2c ?? typical.story.salesToCapital, costOfCapital: wacc ?? typical.story.costOfCapital } : null), [typical, margin, s2c, wacc]);
  const labRes = useMemo(() => (labStory ? impliedGrowth(labStory, ev) : null), [labStory, ev]);
  if (!v || !typical) return null;

  const S = p.symbol;
  const past = v.pastGrowth3y ?? v.pastGrowth1y;
  const pastWhen = v.pastGrowth3y !== null ? "a year over the last three years" : "last year";
  const im = typical.implied;
  const mult = sizeMultiple(im, v.revenue);
  const marginJump = typical.story.targetMargin - v.opMargin;
  const cautious = scenarios.find((s) => s.id === "cautious")!;
  const roNewToday = returnOnNewCapital(cautious.story);

  // what the price asks of the business, against what it has shown: growth AND profitability
  const gAsk = im.kind === "ok" ? demandVsHistory(im.growth, past) : null;
  const marginAsk = marginJump > 15 ? 2 : marginJump > 5 ? 1 : 0;   // judgement: pp of operating margin it must add
  const growthLevel = gAsk === "less" ? 0 : gAsk === "same" ? 1 : gAsk === "more" ? 2 : gAsk === "much_more" ? 3 : null;
  const askLevel = growthLevel === null ? null : Math.max(growthLevel, growthLevel + marginAsk >= 2 ? 2 : growthLevel + marginAsk);

  // ── the price in one sentence ──
  let headline: React.ReactNode;
  if (im.kind === "ok") {
    const d = gAsk;
    headline = (
      <>For its price of {usd(ev)}, {S} has to grow its sales about <b>{im.growth.toFixed(0)}% a year</b> for the next five years
        {marginJump > 1 ? <> while becoming as profitable as the average company in its industry (from {pct(v.opMargin)} to {pct(typical.story.targetMargin)} of sales kept as operating profit)</> : null}.
        {mult ? <> By year 10 it would be about <b>{mult.toFixed(1)}×</b> today's size.</> : null}
        {past !== null && <> It grew {pct(past)} {pastWhen} — so the price asks for {d === "less" ? "less growth than" : d === "same" ? "about the growth" : "more growth than"} it has been delivering{marginAsk === 2 ? <>, but a <b>much higher profit margin than it has shown</b> — that's the real bet</> : marginAsk === 1 ? <>, plus a higher profit margin than today's</> : null}.</>}</>
    );
  } else if (im.kind === "growth_destroys") {
    headline = <>Even if {S} becomes as profitable as its industry, each new dollar it invests would earn less than it costs — so growth can't explain its {usd(ev)} price. The price is betting on a much more profitable business than its industry's average.</>;
  } else if (im.kind === "beyond") {
    headline = <>Even very fast growth doesn't reach its {usd(ev)} price with a typical story. The price assumes {S} becomes far more profitable or far bigger than an average company in its industry.</>;
  } else {
    headline = <>{S}'s {usd(ev)} price would make sense even if its sales shrank. The market is expecting little from it.</>;
  }

  // ── possible / plausible / probable (typical story) ──
  const possible: { tone: Tone; chip: string; text: string } = mult === null
    ? { tone: im.kind === "shrink" ? "good" : "hard", chip: im.kind === "shrink" ? "Easy" : "Unclear", text: im.kind === "shrink" ? "The price doesn't need it to get bigger at all." : "No growth rate makes this story work, so the size question doesn't even arise." }
    : mult <= 3 ? { tone: "good", chip: "Reachable size", text: `It needs to become about ${mult.toFixed(1)}× bigger in 10 years (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}).` }
    : mult <= 10 ? { tone: "mid", chip: "Big leap", text: `It needs to become about ${mult.toFixed(1)}× bigger in 10 years (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}). Is its market big enough for that? That's your judgement — and Damodaran's first question.` }
    : { tone: "hard", chip: "Huge leap", text: `It needs to become about ${mult.toFixed(0)}× bigger in 10 years (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}). Few markets can hold that much growth for one company.` };
  const growthAsk = im.kind === "ok" ? im.growth : null;
  const dPast = growthAsk !== null ? demandVsHistory(growthAsk, past) : null;
  const plausibleParts: string[] = [];
  if (growthAsk !== null) plausibleParts.push(past !== null ? `It needs ${pct(growthAsk)} a year; it delivered ${pct(past)} ${pastWhen}${v.industryGrowth5y !== null ? `, and its industry grew ${pct(v.industryGrowth5y)} a year over five years` : ""}.` : `It needs ${pct(growthAsk)} a year.`);
  if (marginJump > 5) plausibleParts.push(`It also has to raise its profit margin from ${pct(v.opMargin)} to ${pct(typical.story.targetMargin)} — a big change for any business.`);
  const plausibleTone: Tone = im.kind !== "ok" ? "hard" : (dPast === "much_more" || marginJump > 15) ? "hard" : (dPast === "more" || marginJump > 5) ? "mid" : "good";
  const plausible = { tone: plausibleTone, chip: plausibleTone === "good" ? "Within its record" : plausibleTone === "mid" ? "A stretch" : "Beyond its record", text: plausibleParts.join(" ") || "The numbers don't support this story at any growth rate." };
  const biz = bizOf(proven?.label);
  const ageCheck = proven?.checks?.find((c) => c.id === "age");
  const probableTone: Tone = !biz ? "mid" : biz === "good" && ageCheck?.pass !== false ? "good" : biz === "weak" ? "hard" : "mid";
  const probable = {
    tone: probableTone,
    chip: probableTone === "good" ? "Backed by its record" : probableTone === "mid" ? "Mixed evidence" : "Not backed yet",
    text: `${proven?.sentence ? `Its track record: ${proven.sentence.charAt(0).toLowerCase()}${proven.sentence.slice(1)}` : "Its track record isn't scored yet."}${ageCheck ? ` ${ageCheck.pass === false ? `And it isn't acting its age: ${ageCheck.miss}.` : ageCheck.pass ? "It's using its capital the way a company its age should." : ""}` : ""}`,
  };
  const ask: Ask | null = im.kind === "shrink" ? "less" : im.kind !== "ok" ? "more" : askLevel === null ? null : askLevel === 0 ? "less" : askLevel === 1 ? "same" : "more";

  return (
    <section className="rounded-lg border border-border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Term id="reverse_dcf">What the price is betting on</Term></span>
          <span className="block text-[11px] text-muted-foreground">A share price is a bet on the future. Here's what has to come true for this one to make sense.</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3.5 px-3 pb-3">
          <p className="text-[13.5px] leading-snug">{headline}</p>
          {im.kind === "ok" && growthAsk !== null && growthAsk >= 20 && (
            <p className="text-[11.5px] leading-snug text-muted-foreground">For perspective: of companies growing over 20% a year in 1994, only 13% were still growing that fast ten years later (<a href={MCKINSEY} target="_blank" rel="noopener noreferrer" className="underline">McKinsey</a>). Fast growth is hard to keep.</p>
          )}

          {/* three ready-made stories */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-semibold">Three ways the story could go</div>
            <div className="space-y-1.5">
              {scenarios.map((s) => {
                const a = answerText(s.implied, past);
                return (
                  <div key={s.id} className="rounded-md bg-muted/20 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold">{s.name}</span>
                      <span className="ml-auto"><Chip tone={a.tone}>{a.text}</Chip></span>
                    </div>
                    <div className="text-[11.5px] leading-snug text-muted-foreground">If {S} <AutoTerms text={s.plain} />.</div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11.5px] leading-snug">
              <span className="font-semibold">What to notice: </span>
              the better the business — more profit kept from each sale (<Term id="operating_margin">margin</Term>), less money needed to grow (<Term id="sales_to_capital">sales to capital</Term>) — the less growth the price needs. Value comes from growth <em>and</em> from what that growth costs.
              {cautious.implied.kind === "growth_destroys" && <> In the cautious story growth even <em>lowers</em> value: at today's margin, each new dollar invested earns about {pct(roNewToday)}, less than the {pct(v.costOfCapital, 1)} that money costs. Growth only helps a business that earns more than its <Term id="cost_of_capital">cost of capital</Term>.</>}
            </p>
          </div>

          {/* the 3P test */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-semibold"><Term id="three_p">Damodaran's three questions</Term> about the typical story</div>
            {([["Possible?", "Could it get that big?", possible], ["Plausible?", "Do the numbers fit what it has shown?", plausible], ["Probable?", "Is there evidence it will happen?", probable]] as const).map(([q, sub, r]) => (
              <div key={q} className="space-y-0.5">
                <div className="flex items-center gap-2 text-[12px]"><span className="font-semibold">{q}</span><span className="text-muted-foreground">{sub}</span><span className="ml-auto"><Chip tone={r.tone}>{r.chip}</Chip></span></div>
                <p className="text-[11.5px] leading-snug text-muted-foreground"><AutoTerms text={r.text} /></p>
              </div>
            ))}
            <p className="text-[11px] leading-snug text-muted-foreground">Many stories pass the first question and fail the last. Possible is easy; probable is the hard part.</p>
          </div>

          {/* good company vs good investment */}
          {biz && ask && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold"><Term id="good_company">Good company ≠ good investment</Term></div>
              <p className="text-[11.5px] leading-snug text-muted-foreground">Damodaran asks two separate questions: is this a good business, and is the price asking too much? A great company can be a poor investment if the price already assumes everything goes right. Here "what it has shown" means both its growth and its profit margin.</p>
              <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-px overflow-hidden rounded-md border border-border text-[10px]">
                <div className="bg-muted/30 p-1" />
                {(["less", "same", "more"] as Ask[]).map((a) => <div key={a} className="bg-muted/30 p-1 text-center text-muted-foreground">{a === "less" ? "price asks less than it has shown" : a === "same" ? "about what it has shown" : "more than it has shown"}</div>)}
                {(["good", "unproven", "weak"] as Biz[]).map((b) => (
                  <Fragment key={b}>
                    <div className="bg-muted/30 p-1 text-muted-foreground">{b === "good" ? "Proven business" : b === "unproven" ? "Unproven / slipping" : "Not earning its cost"}</div>
                    {(["less", "same", "more"] as Ask[]).map((a) => <div key={b + a} className={`p-1 ${b === biz && a === ask ? "bg-primary/25 ring-1 ring-primary" : "bg-background"}`} />)}
                  </Fragment>
                ))}
              </div>
              <p className="text-[12px] leading-snug"><AutoTerms text={CELL[biz][ask]} /></p>
            </div>
          )}

          {/* learn: what's a story */}
          <button onClick={() => setLearn(!learn)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">What's a "story" in valuation? <ChevronDown size={12} className={learn ? "rotate-180" : ""} /></button>
          {learn && (
            <div className="space-y-1 rounded-md bg-muted/20 p-2.5 text-[11.5px] leading-snug">
              <p><Term id="damodaran">Damodaran</Term> says every price is a <Term id="story">story told in numbers</Term>. Every company story is about four things:</p>
              <p><b>How big?</b> — how fast sales grow, and how large the company can become.</p>
              <p><b>How profitable?</b> — how much of each dollar of sales it keeps as operating profit (its <Term id="operating_margin">operating margin</Term>).</p>
              <p><b>How much it costs to grow?</b> — how much money it has to put back into the business (<Term id="reinvestment">reinvestment</Term>) for each new dollar of sales.</p>
              <p><b>How risky?</b> — the return investors demand for that risk (its <Term id="cost_of_capital">cost of capital</Term>, {pct(v.costOfCapital, 1)} for its industry).</p>
              <p>The app fills these from the company's own numbers and its industry's averages, then asks what growth the price needs. You don't have to set anything.</p>
            </div>
          )}

          {/* optional experiment */}
          <button onClick={() => setLab(!lab)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">Experiment yourself (optional) <ChevronDown size={12} className={lab ? "rotate-180" : ""} /></button>
          {lab && labStory && labRes && (
            <div className="space-y-2 rounded-md bg-muted/20 p-2.5">
              <p className="text-[11px] text-muted-foreground">Starts from the typical story. Move one lever and watch how much growth the price then needs.</p>
              <Slider label="How profitable it becomes" plain="Operating margin it reaches in 5 years — the share of sales it keeps as operating profit." value={labStory.targetMargin} min={-10} max={60} step={0.5} unit="%" onChange={setMargin}
                hint={`today ${pct(v.opMargin, 1)}${v.industryOpMargin !== null ? ` · industry average ${pct(v.industryOpMargin, 1)}` : ""}`} />
              <Slider label="How much it costs to grow" plain="Sales it gets for each $1 it reinvests — higher means growth is cheaper." value={labStory.salesToCapital} min={0.2} max={6} step={0.1} unit="×" onChange={setS2c}
                hint={`${v.salesToCapital !== null ? `today ${v.salesToCapital.toFixed(2)}×` : ""}${v.industrySalesToCapital !== null ? ` · industry ${v.industrySalesToCapital.toFixed(2)}×` : ""}`} />
              <Slider label="How risky" plain="The yearly return investors demand for this kind of business (cost of capital)." value={labStory.costOfCapital} min={4} max={16} step={0.1} unit="%" onChange={setWacc} hint={v.costOfCapitalSource} />
              <p className="text-[12.5px] leading-snug">
                {labRes.kind === "ok" ? <>The price would then need about <b>{labRes.growth.toFixed(0)}%</b> sales growth a year.</>
                  : labRes.kind === "growth_destroys" ? <>With these numbers, growth lowers value — each new dollar would earn about {pct(returnOnNewCapital(labStory), 1)}, less than its {pct(labStory.costOfCapital, 1)} cost.</>
                  : labRes.kind === "beyond" ? <>No realistic growth reaches the price with these numbers.</> : <>The price makes sense even if sales shrink.</>}
              </p>
              <button onClick={() => { setMargin(null); setS2c(null); setWacc(null); }} className="text-[11px] text-muted-foreground underline">Reset to the typical story</button>
            </div>
          )}

          <p className="text-[10.5px] leading-snug text-muted-foreground">
            A simplified version of Damodaran's approach — his break-even reading of prices (<a href={TRILLION_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Trillion Dollar Market Caps, Dec 2025 <ExternalLink size={9} /></a>) and his business × price matrix (<a href={PARADOX_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Explaining a Paradox, 2017 <ExternalLink size={9} /></a>). Assumes a 10-year forecast, a {RISK_FREE}% long-run growth ceiling, and today's price including debt minus cash. A way to think, not a recommendation.
          </p>
        </div>
      )}
    </section>
  );
}
