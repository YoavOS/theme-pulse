// Front-end mirror of the fundamentals-lens payload (supabase/functions/_shared/lensPayload.ts).
// Keep in sync with that file.

export type Pillar = "growth" | "profitability" | "reinvestment" | "risk" | "cash_return" | "pricing" | "foundations";
export type Stage = "startup" | "young_growth" | "high_growth" | "mature_growth" | "mature_stable" | "decline";

export interface MetricInput { label: string; display: string }
export interface PeerStat { pct: number; n: number; group: string; level: "sub-industry" | "industry" | "sector"; median: string; own: string; position: "top" | "upper" | "middle" | "lower" | "bottom" }
/** Damodaran's industry aggregate for a metric (January data). */
export interface Benchmark { industry: string; display: string; market: string | null; n: number | null; position: "above" | "below" | "in line"; note?: string; smallSample: boolean }
export interface Metric {
  id: string; pillar: Pillar; label: string; value: number | null; unit: "pct" | "pp" | "usd" | "x" | "years";
  display: string; period: string; formula: string; inputs: MetricInput[]; note?: string; approx?: boolean; peer?: PeerStat; bench?: Benchmark;
}
export interface DamodaranProfile {
  name: string; match: "damodaran" | "mapped" | "market"; confidence: "close" | "approx" | null; from: string | null; n: number | null; asOf: string;
  costOfCapital: string | null; costOfEquity: string | null; beta: string | null; pctMoneyLosing: string | null; marketCostOfCapital: string | null;
  smallSample: boolean; source: string;
}
export interface Lecture { course: "Valuation" | "Corporate Finance" | "Life Cycle"; session: number | null; videoId: string | null; playlist?: string; title: string; inferred?: boolean; url: string }
export interface ConceptCard {
  id: string; pillar: Pillar; title: string; question: string;
  what: string; why: string; industry: string; stageNote: string | null; caveats: string[];
  lectures: Lecture[]; metrics: Metric[]; primary: string; higherIsBetter: boolean | null;
}
export interface StageSignal { id: string; label: string; display: string; points: Stage[] }
export interface LifeCycle {
  stage: Stage; leaning: Stage | null; confidence: "high" | "medium" | "low"; signals: StageSignal[]; publicSince: string | null;
  label: string; question: string; signature: string; pricing: string; leaningLabel: string | null; lectures: Lecture[];
}
export interface LensPayload {
  version: number; symbol: string; company: string | null;
  classification: { sector: string; industry: string; subIndustry: string };
  financial: boolean;
  damodaran?: DamodaranProfile | null;
  market: { price: number | null; marketCap: number | null; asOf: string | null };
  sec: { status: string; asOf: string | null; filed: string | null; ttmLabel: string };
  lifeCycle: LifeCycle | null;
  story: string[];
  snapshot: string[];
  foundations: ConceptCard[];
  cards: ConceptCard[];
  computedAt: string;
  error?: string;
}
export interface Sentence { text: string; fact_ids: string[]; kind: string }
export interface Explanation { sentences: Sentence[]; missing: string[]; source: "model" | "template"; provider?: string; facts?: number; error?: string }

export const STAGE_ORDER: Stage[] = ["startup", "young_growth", "high_growth", "mature_growth", "mature_stable", "decline"];
export const STAGE_SHORT: Record<Stage, string> = {
  startup: "Start-up", young_growth: "Young growth", high_growth: "High growth", mature_growth: "Mature growth", mature_stable: "Mature stable", decline: "Decline",
};
export const PILLAR_INFO: Record<Exclude<Pillar, "foundations">, { label: string; question: string }> = {
  growth: { label: "Growth", question: "How fast is the business getting bigger?" },
  profitability: { label: "Profitability", question: "How much does it keep, and what does it earn on its capital?" },
  reinvestment: { label: "Reinvestment & cash", question: "What does growth cost, and does cash come out the other end?" },
  risk: { label: "Risk & debt", question: "How fragile is it if things go wrong?" },
  cash_return: { label: "Cash return & dilution", question: "What happens to the cash — and to your share of the company?" },
  pricing: { label: "What the market pays", question: "What is the price betting on?" },
};
