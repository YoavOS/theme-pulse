import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { demandVsHistory, impliedGrowth, returnOnNewCapital, type Story } from "@/lib/lens/valuation";

const usd = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "−" : ""}$${a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(1) + "B" : (a / 1e6).toFixed(0) + "M"}`; };
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const RISK_FREE = 4.2;   // app assumption (US 10-year Treasury, late 2026) — editable below
const TRILLION_POST = "https://aswathdamodaran.substack.com/p/trillion-dollar-market-caps-fairy";
const PARADOX_POST = "https://aswathdamodaran.blogspot.com/2017/03/explaining-paradox-why-good-bad.html";
const MCKINSEY = "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/balancing-roic-and-growth-to-build-value";

type Biz = "good" | "unproven" | "weak";
type Ask = "less" | "same" | "more";
const bizOf = (label: string | null | undefined): Biz | null =>
  !label ? null : ["elite", "proven", "proven_caveat"].includes(label) ? "good" : ["provisional", "emerging", "fading", "was_strong"].includes(label) ? "unproven" : "weak";
// Damodaran's buy/sell matrix (2017) reads business quality against price vs value. The app has no value
// estimate, so the price axis is what the price ASKS of the business compared with what it has delivered.
const CELL: Record<Biz, Record<Ask, string>> = {
  good: {
    less: "A good business priced for less than it has been doing — the corner of his matrix where business quality and price line up best (he'd still ask whether management is acting its age).",
    same: "A good business priced for more of the same. Fair-ish: the return comes from the business, not from re-rating.",
    more: "His \"admire, but don't buy\" corner: a great business whose price already asks for more than it has delivered.",
  },
  unproven: {
    less: "The price asks for less than the business has been doing, but the record is short or slipping — the story still has to be proven.",
    same: "Priced for the story continuing. Fine if it does; the record to back it isn't there yet.",
    more: "Priced for a big story with no proven record yet — the mix where expectations and reality can part most violently.",
  },
  weak: {
    less: "A weak business priced low. His matrix allows that a bad business can be a good investment at the right price — but it needs a reason to change.",
    same: "A business that hasn't earned its cost of capital, priced as if that's fine — his matrix treats this as the wrong side of the trade for an owner.",
    more: "A business that hasn't earned its cost of capital, priced for growth — the worst corner of his matrix for an owner: growth at these returns destroys value.",
  },
};

function Slider({ label, value, min, max, step, unit, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="block space-y-0.5">
      <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className="font-mono tabular-nums">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

/** Narrative and numbers: turn the price into the story it needs, test it (possible, plausible, probable),
 *  and place the company in Damodaran's good-company vs good-investment matrix. */
export default function PriceStoryCard({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const v = p.valuation;
  const [open, setOpen] = useState(true);
  const defMargin = v ? Math.round(Math.max(v.opMargin, v.industryOpMargin ?? v.opMargin) * 2) / 2 : 15;
  const defS2C = v ? Math.round((v.industrySalesToCapital ?? v.salesToCapital ?? 1.5) * 10) / 10 : 1.5;
  const [margin, setMargin] = useState(defMargin);
  const [s2c, setS2c] = useState(defS2C);
  const [wacc, setWacc] = useState(v?.costOfCapital ?? 8);
  const [edge, setEdge] = useState(0);
  const [rf, setRf] = useState(RISK_FREE);

  const res = useMemo(() => {
    if (!v) return null;
    const story: Story = { revenue: v.revenue, opMargin: v.opMargin, targetMargin: margin, salesToCapital: s2c, costOfCapital: wacc, taxRate: v.taxRate, riskFree: rf, terminalEdge: edge };
    const ev = v.marketCap + v.debt - v.cash;
    return { story, ev, implied: impliedGrowth(story, Math.max(1, ev)), roNew: returnOnNewCapital(story) };
  }, [v, margin, s2c, wacc, edge, rf]);
  if (!v || !res) return null;

  const past = v.pastGrowth3y ?? v.pastGrowth1y;
  const im = res.implied;
  const y10 = im.kind === "ok" ? im.path[9].revenue : null;
  const demand = im.kind === "ok" ? demandVsHistory(im.growth, past) : im.kind === "beyond" ? "much_more" : im.kind === "shrink" ? "less" : "much_more";
  const ask: Ask | null = demand === null ? null : demand === "less" ? "less" : demand === "same" ? "same" : "more";
  const biz = bizOf(proven?.label);
  const ageCheck = proven?.checks?.find((c) => c.id === "age");

  return (
    <section className="rounded-lg border border-border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What the price is betting on</span>
          <span className="block text-[11px] text-muted-foreground">Narrative and numbers: turn the price into the story it needs, then test the story.</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <p className="text-[12.5px] leading-snug">
            {p.symbol} is priced at {usd(res.ev)} for the whole business (market cap {usd(v.marketCap)} plus net debt). Damodaran's habit: don't ask "is it cheap?" — ask what has to come true for that price to make sense.
          </p>

          {/* the story you believe */}
          <div className="space-y-2 rounded-md bg-muted/20 p-2.5">
            <div className="text-[11px] font-semibold">Your story</div>
            <Slider label="Operating margin it reaches (in 5 years)" value={margin} min={-10} max={60} step={0.5} unit="%" onChange={setMargin}
              hint={`today ${pct(v.opMargin)}${v.industryOpMargin !== null ? ` · ${v.industry} average ${pct(v.industryOpMargin)}` : ""}`} />
            <Slider label="Sales per $ of new capital" value={s2c} min={0.2} max={6} step={0.1} unit="×" onChange={setS2c}
              hint={`${v.salesToCapital !== null ? `today ${v.salesToCapital.toFixed(2)}×` : ""}${v.industrySalesToCapital !== null ? ` · industry ${v.industrySalesToCapital.toFixed(2)}×` : ""} — how much it must reinvest to grow`} />
            <Slider label="Cost of capital" value={wacc} min={4} max={16} step={0.1} unit="%" onChange={setWacc} hint={v.costOfCapitalSource} />
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">After year 10:</span>
              {[[0, "competition erodes the edge"], [4, "keeps a lasting edge"]].map(([e, t]) => (
                <button key={e as number} onClick={() => setEdge(e as number)} className={`rounded px-1.5 py-0.5 ${edge === e ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>{t as string}</button>
              ))}
              <span className="ml-auto text-muted-foreground">risk-free</span>
              <input type="number" step={0.1} value={rf} onChange={(e) => setRf(Number(e.target.value) || RISK_FREE)} className="w-14 rounded border border-border bg-transparent px-1 text-right font-mono" aria-label="Risk-free rate" />%
            </div>
          </div>

          {/* what the price needs */}
          <div className="space-y-1.5">
            {im.kind === "ok" && (
              <p className="text-[13px] leading-snug">
                With that story, the price needs revenue to grow about <span className="font-mono font-semibold">{im.growth.toFixed(1)}% a year</span> for five years (then slowing), reaching about <span className="font-mono">{usd(y10!)}</span> in year 10 — from {usd(v.revenue)} today.
              </p>
            )}
            {im.kind === "beyond" && <p className="text-[13px] leading-snug">Even 80% a year for five years doesn't reach the price with this story. The price is betting on something bigger — a much higher margin, far less capital, or a market this story doesn't include.</p>}
            {im.kind === "shrink" && <p className="text-[13px] leading-snug">The price is covered even if revenue shrinks. Either the market expects decline, or it's pricing a more modest story than you set.</p>}
            {im.kind === "growth_destroys" && (
              <p className="text-[13px] leading-snug">
                With this story, new capital would earn about <span className="font-mono">{pct(res.roNew)}</span> — below its <span className="font-mono">{pct(wacc)}</span> cost. In Damodaran's terms growth then <em>destroys</em> value, so no amount of growth explains the price ({usd(res.ev)} vs about {usd(im.valueAtZero)} without growth). The price needs a better margin or capital story, not more growth.
              </p>
            )}
            {im.kind === "ok" && (
              <p className="text-[11px] leading-snug text-muted-foreground">New capital in this story earns about {pct(res.roNew)} after tax vs a {pct(wacc)} cost — {res.roNew > wacc ? "so growth adds value here." : "so growth barely adds value here."}</p>
            )}
          </div>

          {/* the 3P test */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold">Test the story — possible, plausible, probable</div>
            <div className="space-y-1 text-[12px] leading-snug">
              <p><span className="font-semibold">Possible?</span> {y10 ? `Is there room for a ${usd(y10)}-revenue business in its market? If the market isn't that big, the story fails here.` : "Could any business in this market reach what the price assumes?"}</p>
              <p><span className="font-semibold">Plausible?</span>{" "}
                {im.kind === "ok" && past !== null ? `It needs ${im.growth.toFixed(0)}%/yr; it delivered ${pct(past, 0)}/yr lately${v.industryGrowth5y !== null ? ` (its industry ${pct(v.industryGrowth5y, 0)}/yr over 5 years)` : ""}. ` : ""}
                {`The ${pct(margin, 0)} margin is ${v.industryOpMargin !== null ? (margin > v.industryOpMargin + 5 ? "well above its industry's — what keeps competitors from closing that gap?" : margin < v.industryOpMargin - 5 ? "below its industry's — a conservative assumption." : "close to its industry's.") : "your assumption."}`}
                {im.kind === "ok" && im.growth >= 20 && <> Base rate: of companies growing over 20% in 1994, only 13% still grew that fast a decade later (<a href={MCKINSEY} target="_blank" rel="noopener noreferrer" className="underline">McKinsey</a>).</>}
              </p>
              <p><span className="font-semibold">Probable?</span> Will this management, with this competition, deliver growth, margin and reinvestment together?{ageCheck ? ` The stage check says: ${ageCheck.pass === false ? `not acting its age (${ageCheck.miss})` : ageCheck.pass ? "acting its age" : "not enough data"}.` : ""}</p>
            </div>
          </div>

          {/* good company vs good investment */}
          {biz && ask && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold">Good company ≠ good investment</div>
              <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-px overflow-hidden rounded-md border border-border text-[10px]">
                <div className="bg-muted/30 p-1" />
                {(["less", "same", "more"] as Ask[]).map((a) => <div key={a} className="bg-muted/30 p-1 text-center text-muted-foreground">{a === "less" ? "price asks less than it has done" : a === "same" ? "about what it has done" : "more than it has done"}</div>)}
                {(["good", "unproven", "weak"] as Biz[]).map((b) => (
                  <Fragment key={b}>
                    <div className="bg-muted/30 p-1 text-muted-foreground">{b === "good" ? "Proven business" : b === "unproven" ? "Unproven / slipping" : "Not earning its cost"}</div>
                    {(["less", "same", "more"] as Ask[]).map((a) => (
                      <div key={b + a} className={`p-1 ${b === biz && a === ask ? "bg-primary/25 ring-1 ring-primary" : "bg-background"}`} />
                    ))}
                  </Fragment>
                ))}
              </div>
              <p className="text-[12px] leading-snug">{CELL[biz][ask]}</p>
            </div>
          )}

          <p className="text-[10.5px] leading-snug text-muted-foreground">
            A simplified version of Damodaran's approach — his break-even reading of prices (<a href={TRILLION_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Trillion Dollar Market Caps, Dec 2025 <ExternalLink size={9} /></a>) and his business × price matrix (<a href={PARADOX_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Explaining a Paradox, 2017 <ExternalLink size={9} /></a>). The app has no value estimate of its own, so the matrix compares what the price asks with what the business has delivered. A way to think, not a recommendation.
          </p>
        </div>
      )}
    </section>
  );
}
