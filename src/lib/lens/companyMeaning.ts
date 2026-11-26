import type { ConceptCard, LensPayload, Metric } from "@/lib/lens/types";
import { heComparison, hePlainReading } from "@/lib/lens/he/companyMeaning";
import { quarterNote } from "@/lib/lens/companyQuarterNote";

/**
 * "What it means for this company": the glossary explains a term in general; this turns the
 * company's own number into the same plain words and sets it against its industry (Damodaran's
 * average) and its peers in the app, so the explanation ends with the real numbers.
 */

/** Glossary entry → the metric(s) that show it in the Lens (first one with a value wins). */
export const ENTRY_METRICS: Record<string, string[]> = {
  rev_growth: ["rev_growth_ttm", "rev_cagr_3y", "rev_growth_q"],
  earnings_growth: ["opinc_growth_ttm", "ni_growth_ttm"],
  gross_margin: ["gross_margin"], operating_margin: ["op_margin"], net_margin: ["net_margin"],
  rnd: ["rnd_intensity"], rnd_intensity: ["rnd_intensity"], sbc: ["sbc_intensity"],
  roic: ["roic"], roe: ["roe"], excess_return: ["excess_return"], equity_spread: ["equity_spread"],
  fcf: ["fcf_margin", "fcf"], fcf_margin: ["fcf_margin"], fcff: ["fcff"], capex: ["capex_intensity"],
  reinvestment: ["reinvestment_rate", "reinvestment"], reinvestment_rate: ["reinvestment_rate"],
  sales_to_capital: ["sales_to_capital"], cash_runway: ["cash_runway"], liquidity: ["current_ratio"],
  interest_coverage: ["interest_coverage"], debt_to_ebitda: ["debt_to_ebitda"], debt_to_capital: ["debt_to_capital"],
  net_debt: ["net_debt"], credit_rating: ["synthetic_rating"], lease_adjustment: ["lease_debt"],
  share_count: ["share_change"], dilution: ["share_change"],
  cash_returned: ["cash_return_vs_fcf", "cash_return"], buybacks: ["cash_return"], dividends: ["cash_return"],
  pe: ["pe"], ps: ["ps"], ev_ebit: ["ev_ebit"],
};

const r0 = (v: number) => Math.round(Math.abs(v));
const r1 = (v: number) => Math.abs(v).toFixed(1);

/** The company's number in plain words (null when there's nothing useful to say). */
function plainReading(S: string, m: Metric): string | null {
  const v = m.value;
  if (v === null || !Number.isFinite(v)) return m.display && m.display !== "n/a" ? `${S}: ${m.display}.` : null;
  switch (m.id) {
    case "rev_growth_ttm": case "rev_growth_q": case "rev_cagr_3y":
      return v >= 0 ? `${S}'s sales grew ${r1(v)}%${m.id === "rev_cagr_3y" ? " a year over the last three years" : m.id === "rev_growth_q" ? " in the latest quarter versus a year earlier" : " over the last twelve months versus the twelve before"}.`
        : `${S}'s sales shrank ${r1(v)}%${m.id === "rev_cagr_3y" ? " a year over three years" : " versus a year earlier"}.`;
    case "opinc_growth_ttm": case "ni_growth_ttm":
      return `${S}'s ${m.id === "ni_growth_ttm" ? "net income" : "operating income"} changed ${v >= 0 ? "+" : "−"}${r1(v)}% versus the prior twelve months${Math.abs(v) > 200 ? " — a swing this big usually means profits were close to zero in one of the two years, so the % says little" : ""}.`;
    case "gross_margin":
      return `${S}'s gross margin is ${m.display}: about ${r0(v)} cents of every sales dollar are left after the direct cost of what it sells.`;
    case "op_margin":
      return v >= 0 ? `${S}'s operating margin is ${m.display}: it keeps about ${r0(v)} cents of operating profit from each sales dollar, before interest and taxes.`
        : `${S}'s operating margin is ${m.display}: it loses about ${r0(v)} cents on every sales dollar from running the business, before interest and taxes.`;
    case "net_margin":
      return v >= 0 ? `${S}'s net margin is ${m.display}: about ${r0(v)} cents of every sales dollar end up as profit for shareholders.`
        : `${S}'s net margin is ${m.display}: after every cost it loses about ${r0(v)} cents per sales dollar.`;
    case "rnd_intensity":
      return `${S} spends about ${r0(v)} cents of every sales dollar on research and development.`;
    case "sbc_intensity":
      return `${S} pays its staff in shares worth ${m.display} of revenue — a real cost to owners even though no cash leaves.`;
    case "roic":
      return v >= 0 ? `${S} earns about ${r1(v)} cents a year on each dollar tied up in the business (return on invested capital ${m.display}).`
        : `${S} loses about ${r1(v)} cents a year on each dollar tied up in the business (return on invested capital ${m.display}).`;
    case "roe":
      return v >= 0 ? `${S} earns ${m.display} a year on its shareholders' money.` : `${S} lost ${m.display} on its shareholders' money over the last year.`;
    case "excess_return": case "equity_spread":
      return v >= 0 ? `${S} earns ${r1(v)} percentage points more than its capital costs — it creates value as it grows.`
        : `${S} earns ${r1(v)} percentage points less than its capital costs — for now, growth destroys value.`;
    case "fcf_margin":
      return v >= 0 ? `${S} turns about ${r0(v)} cents of each sales dollar into spare cash after investing in itself.`
        : `${S} burns about ${r0(v)} cents of cash per sales dollar after investing in itself.`;
    case "capex_intensity":
      return `${S} spends about ${r0(v)} cents of each sales dollar on long-lived assets (capex).`;
    case "reinvestment_rate":
      return `${S} puts ${m.display} of its after-tax operating income back into the business to grow.`;
    case "sales_to_capital":
      return `Each $1 of capital in ${S} produces about $${v.toFixed(2)} of sales a year${v >= 2 ? " — growth comes cheap" : v < 0.8 ? " — growth needs a lot of capital" : ""}.`;
    case "interest_coverage":
      return v >= 0 ? `${S}'s operating profit covers its interest bill about ${v.toFixed(1)} times.` : `${S}'s operating profit doesn't cover its interest bill (it's negative).`;
    case "debt_to_capital":
      return `${m.display} of ${S}'s financing comes from lenders${v < 5 ? " — almost no debt" : ""}.`;
    case "debt_to_ebitda":
      return `${S}'s debt equals about ${v.toFixed(1)} years of its cash earnings (EBITDA).`;
    case "current_ratio":
      return `${S} has about $${v.toFixed(2)} of short-term assets for each $1 due within a year.`;
    case "share_change":
      return v > 0 ? `${S}'s share count rose ${r1(v)}% in a year — each existing share now owns that much less of the company.`
        : v < 0 ? `${S}'s share count fell ${r1(v)}% in a year (buybacks) — each share owns a bit more of the company.` : `${S}'s share count was unchanged over the year.`;
    case "cash_return_vs_fcf":
      return `${S} handed back ${m.display} of its free cash flow to shareholders (buybacks + dividends).`;
    case "pe":
      return v > 0 ? `Investors pay about $${v.toFixed(0)} for each $1 of ${S}'s yearly profit.` : `${S} has no profit, so a P/E can't be read.`;
    case "ps":
      return `Investors pay about $${v.toFixed(1)} for each $1 of ${S}'s yearly sales.`;
    case "ev_ebit":
      return v > 0 ? `Buying all of ${S} (debt included) costs about ${v.toFixed(0)} years of its operating profit.` : `${S}'s operating profit is negative, so this ratio can't be read.`;
    default:
      return `${S}: ${m.display}.`;
  }
}

/** Industry and peer comparison, with a plain verdict when "better" has a direction. */
function comparison(S: string, m: Metric, higherIsBetter: boolean | null): string[] {
  const out: string[] = [];
  const b = m.bench, p = m.peer;
  let tilt: "better" | "worse" | "even" | null = null;
  if (b) {
    out.push(b.position === "in line"
      ? `That's in line with the ${b.industry} average (${b.display}).`
      : `That's ${b.position} the ${b.industry} average of ${b.display}${b.market ? ` (whole market: ${b.market})` : ""}.`);
    if (b.position === "in line") tilt = "even";
    else if (higherIsBetter !== null) tilt = (b.position === "above") === higherIsBetter ? "better" : "worse";
  }
  if (p) {
    const words = { top: "in the top fifth", upper: "above the median", middle: "around the median", lower: "below the median", bottom: "in the bottom fifth" }[p.position];
    out.push(`Among ${p.n} ${p.group} companies in the app it ranks ${words} (median ${p.median}).`);
    if (tilt === null && higherIsBetter !== null && p.position !== "middle") tilt = (p.position === "top" || p.position === "upper") === higherIsBetter ? "better" : "worse";
    if (tilt === null && p.position === "middle") tilt = "even";
  }
  if (tilt === "better") out.push(`For ${S} this is a strength compared with similar businesses.`);
  else if (tilt === "worse") out.push(`For ${S} this is a weak spot compared with similar businesses.`);
  else if (tilt === "even") out.push(`So on this measure ${S} looks like a typical business of its kind.`);
  else if (b || p) out.push(`Higher isn't simply better here — read it together with the company's stage and story.`);
  if (b?.smallSample) out.push(`(Only ${b.n} firms in that industry, so its average is noisy.)`);
  return out;
}

/** The "For SYMBOL" paragraph for a glossary entry, or null when the Lens has no number for it. */
export function companyNote(entryId: string, p: LensPayload | null | undefined, byId: Map<string, { m: Metric; c: ConceptCard }>, lang: "en" | "he" = "en"): { symbol: string; lines: string[] } | null {
  if (!p) return null;
  const ids = ENTRY_METRICS[entryId];
  const hit = ids?.map((id) => byId.get(id)).find((h) => h && (h.m.value !== null || (h.m.display && h.m.display !== "n/a" && h.m.display !== "n/m")));
  if (!hit) {
    // no ready-made metric: use the latest reported quarter or the market snapshot, when the term has one
    const lines = quarterNote(entryId, p, lang);
    return lines?.length ? { symbol: p.symbol, lines } : null;
  }
  const S = p.symbol;
  if (lang === "he") {
    const first = hePlainReading(S, hit.m);
    return first ? { symbol: S, lines: [first, ...heComparison(S, hit.m, hit.c.higherIsBetter)] } : null;
  }
  const first = plainReading(S, hit.m);
  if (!first) return null;
  return { symbol: S, lines: [first, ...comparison(S, hit.m, hit.c.higherIsBetter)] };
}
