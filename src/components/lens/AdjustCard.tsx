import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { markConcept } from "@/lib/lens/progress";
import { adjustVerdict, computeAdjusted, type AdjustInputs } from "@/lib/lens/adjust";
import { AutoTerms, Term } from "./Term";

const usd = (v: number | null) => {
  if (v === null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v), s = v < 0 ? "−$" : "$";
  return a >= 1e9 ? `${s}${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)}M` : `${s}${(a / 1e3).toFixed(0)}K`;
};
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
const pp = (v: number | null) => (v === null || !Number.isFinite(v) ? "n/a" : `${v > 0.05 ? "+" : v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)} pp`);
const LIVES = [2, 3, 5, 7, 10];

/** Damodaran's R&D capitalisation and lease-as-debt adjustments, side by side with the reported numbers. */
export default function AdjustCard({ a, symbol }: { a: AdjustInputs; symbol: string }) {
  const [open, setOpen] = useState(false);
  const [life, setLife] = useState(a.defaultLife);
  const [rnd, setRnd] = useState(true);
  const [lease, setLease] = useState(true);
  const [steps, setSteps] = useState(false);
  const r = useMemo(() => computeAdjusted(a, { life, rnd, lease }), [a, life, rnd, lease]);
  if (!r) return null;
  const verdict = adjustVerdict(r);
  const rows: [string, string, string][] = [
    ["Operating income", usd(r.reported.ebit), usd(r.adjusted.ebit)],
    ["Operating margin", pct(r.reported.margin), pct(r.adjusted.margin)],
    ["Invested capital", usd(r.reported.ic), usd(r.adjusted.ic)],
    ["Return on capital", pct(r.reported.roic), pct(r.adjusted.roic)],
  ];
  if (r.reported.spread !== null) rows.push(["Return − cost of capital", pp(r.reported.spread), pp(r.adjusted.spread)]);

  return (
    <section className="rounded-lg border border-border">
      <button onClick={() => { const o = !open; setOpen(o); if (o) markConcept("adjustments", symbol, 1); }} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">Adjusted for R&D and leases</span>
          <span className="block text-[11px] text-muted-foreground">Damodaran's fixes to accounting — does the return still hold up?</span>
        </span>
        {!open && r.adjusted.roic !== null && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">ROIC {pct(r.reported.roic)} → {pct(r.adjusted.roic)}</span>}
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2.5 px-3 pb-3">
          <p className="text-[12.5px] leading-snug"><AutoTerms text="Accounting treats R&D as an expense even though it builds an asset that pays off for years, and (before 2019) kept leases off the balance sheet even though they are commitments just like debt. Damodaran moves both into capital: operating income goes up by the R&D that is really investment, capital goes up by the research asset and the lease debt — and the return on capital is recomputed. Free cash flow doesn't change." /></p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={rnd} onChange={(e) => setRnd(e.target.checked)} className="accent-[hsl(var(--primary))]" /> <Term id="rd_adjustment">Capitalise R&D</Term></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={lease} onChange={(e) => setLease(e.target.checked)} className="accent-[hsl(var(--primary))]" /> <Term id="lease_adjustment">Leases as debt</Term></label>
          </div>
          {rnd && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[11px]">
                <span className="mr-1 text-muted-foreground">R&D pays off over</span>
                {LIVES.map((n) => (
                  <button key={n} onClick={() => setLife(n)} className={`rounded px-1.5 py-0.5 font-mono ${n === life ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground hover:text-foreground"}`}>{n}y</button>
                ))}
              </div>
              <p className="text-[10.5px] leading-snug text-muted-foreground">Default {a.defaultLife} years for {a.industry ?? "this kind of business"} — the app's assumption following Damodaran's guidance (short for software and tech, long for drugs and aerospace). Try other lives to see how sensitive the answer is.</p>
            </div>
          )}

          <table className="w-full text-[12px]">
            <thead><tr className="text-[10.5px] text-muted-foreground"><th className="text-left font-normal" /><th className="text-right font-normal">Reported</th><th className="text-right font-normal">Adjusted</th></tr></thead>
            <tbody>
              {rows.map(([k, x, y]) => (
                <tr key={k} className="border-t border-border/40">
                  <td className="py-1 text-muted-foreground"><AutoTerms text={k} /></td>
                  <td className="py-1 text-right font-mono tabular-nums">{x}</td>
                  <td className="py-1 text-right font-mono font-semibold tabular-nums">{y}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {verdict && <p className="text-[12.5px] leading-snug">{typeof verdict === "string" ? <AutoTerms text={verdict} /> : verdict}</p>}
          {a.industryAdjMargin && a.industryMargin && (
            <p className="text-[11px] leading-snug text-muted-foreground">Like for like: {a.industry}'s operating margin is {a.industryMargin} as reported and {a.industryAdjMargin} after Damodaran's own lease and R&D adjustments (January data).</p>
          )}
          {r.notes.map((n) => <p key={n} className="text-[11px] leading-snug text-[hsl(40,90%,66%)]">{n}</p>)}

          {(r.rnd || r.lease) && (
            <button onClick={() => setSteps(!steps)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">
              Show the calculation <ChevronDown size={12} className={steps ? "rotate-180" : ""} />
            </button>
          )}
          {steps && (
            <div className="space-y-2 rounded-md bg-muted/20 p-2 text-[11px]">
              {r.rnd && (
                <>
                  <div className="font-semibold">R&D → research asset ({r.rnd.life}-year life)</div>
                  <table className="w-full font-mono tabular-nums">
                    <thead><tr className="text-[10px] text-muted-foreground"><th className="text-left font-normal">FY</th><th className="text-right font-normal">R&D</th><th className="text-right font-normal">still unamortized</th><th className="text-right font-normal">amortized now</th></tr></thead>
                    <tbody>
                      {r.rnd.rows.map((x) => (
                        <tr key={x.fy} className={x.filled ? "text-muted-foreground" : ""}>
                          <td>{x.fy}{x.filled ? "*" : ""}</td><td className="text-right">{usd(x.rnd)}</td>
                          <td className="text-right">{Math.round(x.unamortizedShare * 100)}% = {usd(x.unamortized)}</td>
                          <td className="text-right">{x.amortization ? usd(x.amortization) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>Research asset now {usd(r.rnd.assetNow)} (a year earlier {usd(r.rnd.assetPrior)}, added to capital). Operating income: + {usd(r.rnd.current)} this year's R&D − {usd(r.rnd.amortization)} amortization = {r.rnd.ebitChange >= 0 ? "+" : "−"}{usd(Math.abs(r.rnd.ebitChange))}.</p>
                  <p className="text-muted-foreground">Uses fiscal-year R&D from the 10-Ks and applies the change to {symbol}'s trailing-twelve-month operating income.</p>
                </>
              )}
              {r.lease && (
                <>
                  <div className="font-semibold">Leases → debt</div>
                  <p>Lease liability {usd(r.lease.debtNow)} (a year earlier {usd(r.lease.debtBase)}, added to capital). The interest hidden inside the lease expense ≈ {usd(r.lease.debtNow)} × {r.lease.costOfDebt.toFixed(1)}% ({a.costOfDebtSource}) = +{usd(r.lease.ebitChange)} to operating income.</p>
                </>
              )}
              <p className="text-muted-foreground">Tax: the same effective rate as the reported figures ({(a.taxRate * 100).toFixed(1)}%). Damodaran also adjusts for the tax benefit of expensing R&D; the app leaves that out.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
