// Proven-Strong — front-end mirror of supabase/functions/_shared/provenEngine.ts (keep in sync).

export type ProvenLabel = "elite" | "proven" | "proven_caveat" | "fading" | "provisional" | "emerging" | "emerging_early" | "was_strong" | "not_proven" | "insufficient";
export type ProvenTrack = "standard" | "cyclical" | "financial" | "capital_light" | "young";
export interface ProvenCheck { id: string; label: string; pass: boolean | null; value: string; miss?: string }
export interface ProvenRow {
  symbol: string; status: string; error?: string | null;
  as_of: string | null; track: ProvenTrack | null; label: ProvenLabel | null; sentence: string | null; why: string | null;
  years_valid: number | null; years_above: number | null; median_spread: number | null; spread_slope: number | null;
  hurdle: number | null; hurdle_source: string | null; industry: string | null;
  archetype: string | null; archetypes: string[] | null; flags: string[] | null;
  checks: ProvenCheck[] | null; gates: ProvenCheck[] | null;
  series: { end: string; spread: number | null; primary: number | null; margin: number | null; turnover: number | null }[] | null;
  score: number | null; computed_at: string;
}

export const LABEL_TEXT: Record<ProvenLabel, string> = {
  elite: "Proven · elite", proven: "Proven", proven_caveat: "Proven, with a caveat", fading: "Proven but fading",
  provisional: "Provisional", emerging: "Emerging", emerging_early: "Early", was_strong: "Was strong", not_proven: "Not proven", insufficient: "Too new",
};
/** Short form for tight table cells. */
export const LABEL_SHORT: Record<ProvenLabel, string> = {
  elite: "Elite", proven: "Proven", proven_caveat: "Proven*", fading: "Fading", provisional: "Provisional",
  emerging: "Emerging", emerging_early: "Early", was_strong: "Was strong", not_proven: "Not proven", insufficient: "Too new",
};
// Red/green stay reserved for price action; these are calm, distinct hues.
export const LABEL_CLS: Record<ProvenLabel, string> = {
  elite: "border-[hsl(265,70%,65%)]/50 bg-[hsl(265,70%,65%)]/15 text-[hsl(265,80%,78%)]",
  proven: "border-[hsl(199,85%,60%)]/50 bg-[hsl(199,85%,60%)]/15 text-[hsl(199,85%,72%)]",
  proven_caveat: "border-[hsl(199,85%,60%)]/40 bg-transparent text-[hsl(199,85%,72%)]",
  fading: "border-[hsl(35,90%,58%)]/55 bg-[hsl(35,90%,58%)]/15 text-[hsl(35,95%,68%)]",
  provisional: "border-[hsl(199,40%,60%)]/40 bg-[hsl(199,40%,60%)]/10 text-[hsl(199,45%,72%)]",
  emerging: "border-[hsl(230,70%,68%)]/45 bg-[hsl(230,70%,68%)]/12 text-[hsl(230,80%,78%)]",
  emerging_early: "border-border bg-muted/30 text-muted-foreground",
  was_strong: "border-[hsl(35,90%,58%)]/40 bg-transparent text-[hsl(35,95%,68%)]",
  not_proven: "border-border bg-transparent text-muted-foreground",
  insufficient: "border-border bg-transparent text-muted-foreground",
};
export const TRACK_TEXT: Record<ProvenTrack, string> = {
  standard: "Return on capital vs cost of capital", cyclical: "Through the cycle", financial: "Return on equity vs cost of equity",
  capital_light: "Capital-light (profits & cash)", young: "Young company — judged on direction",
};
export const ARCHETYPE_TEXT: Record<string, string> = {
  capital_light_compounder: "Capital-light compounder", high_margin: "High-margin route", high_turnover: "High-turnover route",
  asset_heavy: "Asset-heavy", rd_innovator: "R&D-driven", reinvesting_compounder: "Reinvesting at high returns",
  cyclical: "Cyclical", capital_negative: "Runs on others' money", serial_acquirer: "Grows by acquisition",
};
export const FLAG_TEXT: Record<string, string> = {
  rd_adjusted: "R&D treated as investment (Damodaran's adjustment) — the return shown is the economic one.",
  still_compounding: "Still compounding: new capital earns well above its cost, and it keeps reinvesting.",
  ex_goodwill_better: "The business itself earns much more than the total return — acquisitions were paid for richly.",
  cyclical_by_volatility: "Returns swing a lot year to year, so it's judged through the cycle.",
  stale_filings: "No annual report in about two years — the record may be out of date.",
};
