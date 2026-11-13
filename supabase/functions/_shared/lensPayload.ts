// ─────────────────────────────────────────────────────────────
// Fundamentals Lens — payload assembly and grounded explanations. PURE module (no network).
//
// Peers: the company is ranked within its GICS sub-industry (falling back to industry, then sector,
// when fewer than MIN_PEERS have the number) using the data provider's figures for EVERY company
// including this one, so the comparison is like-for-like.
// Explanations: the model only puts computed facts into words. Every number it writes must match the
// display string of a fact it cites; otherwise the sentence is rejected and a template is used.
// ─────────────────────────────────────────────────────────────

import { CONCEPTS, CONCEPT_BY_ID, STAGES, lectureUrl, type Concept, type Lecture } from "./lensCurriculum.ts";
import { classifyLifeCycle, computeMetrics, fmtPct, fmtPp, fmtX, median, percentileOf, type CompanyHistory, type LifeCycle, type MarketData, type Metric, type Stage } from "./lensMetrics.ts";
import { benchValue, benchmarkFor, defaultRndLife, DATA_PAGE, type BenchIndex, type Benchmark, type IndustryProfile } from "./damodaran.ts";

export const MIN_PEERS = 5;
export const LENS_VERSION = 4;

/** Peer-comparable metrics: lens metric id → data-provider column and its scale to the lens unit. */
export const PEER_FIELDS: Record<string, { col: string; scale: number; unit: "pct" | "x" }> = {
  gross_margin: { col: "gross_margin", scale: 100, unit: "pct" },
  op_margin: { col: "operating_margin", scale: 100, unit: "pct" },
  net_margin: { col: "net_margin", scale: 100, unit: "pct" },
  roe: { col: "roe", scale: 100, unit: "pct" },
  rev_growth_ttm: { col: "revenue_ttm_yoy", scale: 1, unit: "pct" },
  ps: { col: "ps_ratio", scale: 1, unit: "x" },
  pe: { col: "pe_ratio", scale: 1, unit: "x" },
};

export interface PeerRow { symbol: string; group: { sector: string; industry: string; subIndustry: string }; values: Record<string, number | null> }
export interface PeerStat { pct: number; n: number; group: string; level: "sub-industry" | "industry" | "sector"; median: string; own: string; position: "top" | "upper" | "middle" | "lower" | "bottom" }

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmtUnit = (v: number, unit: "pct" | "x") => (unit === "pct" ? fmtPct(v) : fmtX(v));

/** Peer stats per metric for `self` (which must be one of `rows`). */
export function computePeers(selfSymbol: string, rows: PeerRow[]): Record<string, PeerStat> {
  const self = rows.find((r) => r.symbol === selfSymbol);
  const out: Record<string, PeerStat> = {};
  if (!self) return out;
  for (const [mid, f] of Object.entries(PEER_FIELDS)) {
    const own = self.values[f.col];
    if (!fin(own)) continue;
    for (const level of ["sub-industry", "industry", "sector"] as const) {
      const key = level === "sub-industry" ? "subIndustry" : level;
      const g = self.group[key];
      if (!g || g === "Other" || g === "Unknown") continue;
      // P/E only among profitable peers; ratios only when positive
      const vals = rows.filter((r) => r.group[key] === g && fin(r.values[f.col]) && (f.unit !== "x" || (r.values[f.col] as number) > 0)).map((r) => (r.values[f.col] as number) * f.scale);
      if (vals.length < MIN_PEERS) continue;
      const v = own * f.scale;
      const pct = percentileOf(v, vals);
      out[mid] = {
        pct, n: vals.length, group: g, level, median: fmtUnit(median(vals)!, f.unit), own: fmtUnit(v, f.unit),
        position: pct >= 80 ? "top" : pct >= 60 ? "upper" : pct > 40 ? "middle" : pct > 20 ? "lower" : "bottom",
      };
      break;
    }
  }
  return out;
}

export interface AdjustInputs {
  ebitTtm: number | null; revenueTtm: number | null; rndTtm: number | null; taxRate: number;
  icBase: number | null; leaseNow: number | null; leaseBase: number | null;
  rndAnnual: { end: string; val: number }[];
  costOfDebt: number; costOfDebtSource: string;
  costOfCapital: number | null; industry: string | null;
  industryMargin: string | null; industryAdjMargin: string | null;
  defaultLife: number;
}

export interface ValuationInputs {
  marketCap: number; debt: number; cash: number; revenue: number; opMargin: number; taxRate: number;
  costOfCapital: number; costOfCapitalSource: string;
  industry: string | null; industryOpMargin: number | null; industrySalesToCapital: number | null; industryGrowth5y: number | null;
  pastGrowth1y: number | null; pastGrowth3y: number | null; salesToCapital: number | null;
}

export interface ConceptCard {
  id: string; pillar: string; title: string; question: string;
  what: string; why: string; industry: string; stageNote: string | null; caveats: string[];
  lectures: (Lecture & { url: string })[];
  metrics: (Metric & { peer?: PeerStat; bench?: Benchmark })[];
  primary: string;
  higherIsBetter: boolean | null;
}
export interface LensPayload {
  version: number;
  symbol: string;
  company: string | null;
  classification: { sector: string; industry: string; subIndustry: string };
  financial: boolean;
  /** Damodaran's industry group and its January figures (null until his data is loaded). */
  damodaran: (IndustryProfile & { source: string }) | null;
  market: { price: number | null; marketCap: number | null; asOf: string | null };
  sec: { status: string; asOf: string | null; filed: string | null; ttmLabel: string };
  lifeCycle: (LifeCycle & { label: string; question: string; signature: string; pricing: string; leaningLabel: string | null; lectures: (Lecture & { url: string })[] }) | null;
  story: string[];
  /** Inputs for Damodaran's R&D and lease adjustments (computed in the panel so the R&D life can be changed). */
  adjust: AdjustInputs | null;
  /** Inputs for "what the price is betting on" (narrative and numbers; computed in the panel). */
  valuation: ValuationInputs | null;
  snapshot: string[];             // metric ids for the top strip (stage-specific)
  foundations: ConceptCard[];
  cards: ConceptCard[];
  computedAt: string;
}

const withUrl = (ls: Lecture[]) => ls.map((l) => ({ ...l, url: lectureUrl(l) }));

export function buildPayload(a: {
  symbol: string; company: string | null; classification: LensPayload["classification"]; financial: boolean;
  history: CompanyHistory; market: MarketData & { asOf: string | null }; secStatus: string; peers: Record<string, PeerStat>;
  bench?: { idx: BenchIndex; profile: IndustryProfile } | null;
}): LensPayload {
  const mx = computeMetrics(a.history, a.market, { financial: a.financial });
  if (a.bench) mx.metrics.push(...valueCreationMetrics(mx.metrics, a.bench.idx, a.bench.profile, a.financial, mx.ttmLabel));
  const lc = mx.metrics.length && a.history.quarters.length ? classifyLifeCycle(mx, a.history) : null;
  const byId = new Map(mx.metrics.map((m) => [m.id, m]));
  const stage = lc?.stage ?? null;
  const withComparisons = (m: Metric): Metric & { peer?: PeerStat; bench?: Benchmark } => {
    const out: Metric & { peer?: PeerStat; bench?: Benchmark } = { ...m };
    if (a.peers[m.id]) out.peer = a.peers[m.id];
    const b = a.bench && a.bench.profile.match !== "market" ? benchmarkFor(m.id, m.value, a.bench.idx, a.bench.profile.name, a.financial) : undefined;
    if (b) out.bench = b;
    return out;
  };
  const card = (c: Concept): ConceptCard => ({
    id: c.id, pillar: c.pillar, title: c.title, question: c.question, what: c.what, why: c.why, industry: c.industry,
    stageNote: stage ? c.stages[stage] ?? null : null, caveats: c.caveats, lectures: withUrl(c.lectures),
    metrics: c.metricIds.map((id) => byId.get(id)).filter((m): m is Metric => !!m).map((m) => withComparisons(m)),
    primary: c.primary, higherIsBetter: c.higherIsBetter,
  });
  const cards = CONCEPTS.filter((c) => c.pillar !== "foundations").map(card).filter((c) => c.metrics.length);
  const foundations = CONCEPTS.filter((c) => c.pillar === "foundations").map(card);
  const s = stage ? STAGES[stage] : null;
  return {
    version: LENS_VERSION, symbol: a.symbol, company: a.company, classification: a.classification, financial: a.financial,
    damodaran: a.bench ? { ...a.bench.profile, source: DATA_PAGE } : null,
    market: { price: a.market.price, marketCap: a.market.marketCap, asOf: a.market.asOf },
    sec: { status: a.secStatus, asOf: mx.asOf, filed: mx.filed, ttmLabel: mx.ttmLabel },
    lifeCycle: lc && s ? { ...lc, label: s.label, question: s.question, signature: s.signature, pricing: s.pricing, leaningLabel: lc.leaning ? STAGES[lc.leaning].label : null, lectures: withUrl(s.lectures) } : null,
    story: storyLines(a.symbol, lc, byId, a.financial),
    adjust: a.financial || !mx.raw ? null : adjustInputs(mx.raw, mx.taxRate, a.history, a.bench ?? null, a.classification.sector),
    valuation: a.financial || !mx.raw ? null : valuationInputs(mx.raw, mx.taxRate, a.market.marketCap, byId, a.bench ?? null),
    snapshot: (s?.focus ?? ["rev_growth_ttm", "op_margin", "fcf_margin", "roic"]).map((id) => (id === "roic" && byId.has("excess_return") ? "excess_return" : id)).filter((id) => byId.has(id)),
    foundations, cards, computedAt: new Date().toISOString(),
  };
}

/** Damodaran's central test: does the return beat what the capital costs? Uses the INDUSTRY cost of
 *  capital (his January figure) as the hurdle — a stand-in, since the company's own isn't computed. */
export function valueCreationMetrics(ms: Metric[], idx: BenchIndex, prof: IndustryProfile, financial: boolean, ttmLabel: string): Metric[] {
  if (prof.match === "market") return [];
  const out: Metric[] = [];
  const roic = ms.find((m) => m.id === "roic"), roe = ms.find((m) => m.id === "roe");
  const wacc = benchValue(idx, prof.name, "cost_of_capital"), coe = benchValue(idx, prof.name, "cost_of_equity");
  const src = `Damodaran, ${prof.name}, ${prof.asOf}`;
  if (!financial && roic && fin(roic.value) && fin(wacc)) {
    const v = roic.value - wacc;
    out.push({ id: "excess_return", pillar: "profitability", label: "Return on capital minus cost of capital", unit: "pp", value: v, display: fmtPp(v), period: ttmLabel,
      formula: "ROIC − the industry's cost of capital", inputs: [{ label: "ROIC", display: roic.display }, { label: `Cost of capital (${src})`, display: fmtPct(wacc) }], approx: true,
      note: "Uses the industry's average cost of capital as the hurdle; a riskier or more indebted company has a different one." });
  }
  if (roe && fin(roe.value) && fin(coe) && (financial || !out.length)) {
    const v = roe.value - coe;
    out.push({ id: "equity_spread", pillar: "profitability", label: "Return on equity minus cost of equity", unit: "pp", value: v, display: fmtPp(v), period: ttmLabel,
      formula: "ROE − the industry's cost of equity", inputs: [{ label: "ROE", display: roe.display }, { label: `Cost of equity (${src})`, display: fmtPct(coe) }], approx: true,
      note: "Uses the industry's average cost of equity as the hurdle." });
  }
  return out;
}

export function adjustInputs(raw: NonNullable<ReturnType<typeof computeMetrics>["raw"]>, taxRate: number | null, h: CompanyHistory,
  bench: { idx: BenchIndex; profile: IndustryProfile } | null, sector: string): AdjustInputs | null {
  if (!fin(raw.ebit) || !fin(raw.revenue) || raw.revenue <= 0) return null;
  const ind = bench && bench.profile.match !== "market" ? bench.profile.name : null;
  const cod = ind ? benchValue(bench!.idx, ind, "cost_of_debt") : null;
  const fmt = (m: string) => { const v = ind ? benchValue(bench!.idx, ind, m) : null; return fin(v) ? fmtPct(v) : null; };
  return {
    ebitTtm: raw.ebit, revenueTtm: raw.revenue, rndTtm: raw.rndTtm, taxRate: taxRate ?? 0.25, icBase: raw.icBase, leaseNow: raw.leaseNow, leaseBase: raw.leaseBase,
    rndAnnual: h.rndAnnual ?? [],
    costOfDebt: fin(cod) ? cod : 5.5, costOfDebtSource: fin(cod) ? `pre-tax cost of debt, Damodaran ${bench!.profile.asOf}` : "pre-tax cost of debt, app assumption",
    costOfCapital: ind ? benchValue(bench!.idx, ind, "cost_of_capital") : null, industry: ind,
    industryMargin: fmt("op_margin"), industryAdjMargin: fmt("op_margin_adj"),
    defaultLife: defaultRndLife(ind, sector),
  };
}

export function valuationInputs(raw: NonNullable<ReturnType<typeof computeMetrics>["raw"]>, taxRate: number | null, marketCap: number | null,
  byId: Map<string, Metric>, bench: { idx: BenchIndex; profile: IndustryProfile } | null): ValuationInputs | null {
  if (!fin(marketCap) || marketCap <= 0 || !fin(raw.revenue) || raw.revenue <= 0 || !fin(raw.ebit)) return null;
  const ind = bench && bench.profile.match !== "market" ? bench.profile.name : null;
  const bv = (m: string) => (ind ? benchValue(bench!.idx, ind, m) : null);
  const wacc = bv("cost_of_capital");
  const v = (id: string) => { const x = byId.get(id)?.value; return fin(x) ? x : null; };
  return {
    marketCap, debt: Math.max(0, raw.debt ?? 0), cash: Math.max(0, raw.cash ?? 0), revenue: raw.revenue, opMargin: (raw.ebit / raw.revenue) * 100,
    taxRate: Math.min(0.4, Math.max(0.1, taxRate ?? 0.25)),
    costOfCapital: fin(wacc) ? wacc : 8, costOfCapitalSource: fin(wacc) ? `Damodaran cost of capital, ${ind} (${bench!.profile.asOf})` : "app assumption (8%) — industry data not loaded",
    industry: ind, industryOpMargin: bv("op_margin"), industrySalesToCapital: bv("sales_to_capital"), industryGrowth5y: bv("rev_cagr_5y"),
    pastGrowth1y: v("rev_growth_ttm"), pastGrowth3y: v("rev_cagr_3y"), salesToCapital: v("sales_to_capital"),
  };
}

/** Plain, templated summary — numbers only from metric display strings. */
export function storyLines(sym: string, lc: LifeCycle | null, byId: Map<string, Metric>, financial: boolean): string[] {
  const d = (id: string) => byId.get(id)?.display;
  const v = (id: string) => byId.get(id)?.value ?? null;
  const out: string[] = [];
  if (lc) {
    const s = STAGES[lc.stage];
    out.push(`${sym} looks like a ${s.label} company${lc.leaning ? `, leaning toward ${STAGES[lc.leaning].label}` : ""} (the app's rule of thumb, ${lc.confidence} confidence).`);
  }
  const g = v("rev_growth_ttm"), om = v("op_margin"), dOm = v("op_margin_change"), fcf = v("fcf_margin");
  if (fin(g)) out.push(`Revenue grew ${d("rev_growth_ttm")} over the last twelve months${fin(om) ? ` at an operating margin of ${d("op_margin")}` : ""}${fin(dOm) && Math.abs(dOm) >= 1 ? ` (${dOm > 0 ? "up" : "down"} ${d("op_margin_change")} from a year earlier)` : ""}.`);
  if (fin(fcf)) out.push(fcf >= 0 ? `It turns ${d("fcf_margin")} of revenue into free cash flow.` : `It is burning cash: free cash flow is ${d("fcf_margin")} of revenue.`);
  const roic = v("roic");
  if (!financial && fin(roic)) out.push(`Each dollar invested in the business earned ${d("roic")} after tax last year (ROIC).`);
  const ex = v("excess_return");
  if (fin(ex)) out.push(ex >= 0 ? `That is ${d("excess_return")} above what capital costs in its industry, so growth at these returns adds value.` : `That is ${d("excess_return")} versus what capital costs in its industry, so growth at these returns doesn't add value yet.`);
  return out;
}

// ── Grounded explanations ─────────────────────────────────────────────────────────────

export interface Fact { id: string; label: string; display: string }

/** Facts for one concept card (or "story" for the whole company). */
export function factsFor(p: LensPayload, conceptId: string): Fact[] {
  const facts: Fact[] = [];
  if (p.lifeCycle) facts.push({ id: "stage", label: "Life-cycle stage (app heuristic)", display: p.lifeCycle.label });
  facts.push({ id: "company", label: "Company", display: p.company ? `${p.company} (${p.symbol})` : p.symbol });
  facts.push({ id: "industry", label: "Industry", display: p.classification.subIndustry !== "Other" ? p.classification.subIndustry : p.classification.industry });
  const dm = p.damodaran;
  if (dm && dm.match !== "market") {
    facts.push({ id: "damodaran_industry", label: `Damodaran industry group (${dm.asOf} data${dm.n ? `, ${dm.n} US firms` : ""})`, display: dm.name });
    if (dm.costOfCapital) facts.push({ id: "industry_cost_of_capital", label: `Average cost of capital, ${dm.name} (Damodaran)`, display: dm.costOfCapital });
  }
  const cards = conceptId === "story" ? p.cards.filter((c) => c.metrics.some((m) => p.snapshot.includes(m.id))) : p.cards.filter((c) => c.id === conceptId);
  for (const c of cards) for (const m of c.metrics) {
    if (conceptId === "story" && !p.snapshot.includes(m.id)) continue;
    facts.push({ id: m.id, label: `${m.label} (${m.period})`, display: m.display });
    if (m.peer) {
      facts.push({ id: `${m.id}.peer_median`, label: `Median among ${m.peer.n} ${m.peer.group} peers (data-provider figures)`, display: m.peer.median });
      facts.push({ id: `${m.id}.peer_pct`, label: `Percentile among ${m.peer.group} peers`, display: `${m.peer.pct}th percentile` });
    }
    if (m.bench) {
      facts.push({ id: `${m.id}.industry_avg`, label: `Industry average, ${m.bench.industry} (Damodaran, ${dm?.asOf ?? "January"})`, display: m.bench.display });
      if (m.bench.market) facts.push({ id: `${m.id}.market_avg`, label: "Whole US market average (Damodaran)", display: m.bench.market });
      if (m.bench.note) facts.push({ id: `${m.id}.bench_note`, label: "Definition difference", display: m.bench.note });
    }
    if (m.note) facts.push({ id: `${m.id}.note`, label: "Note", display: m.note });
  }
  return facts;
}

export const BANNED = /\b(buy|sell|undervalued|overvalued|bargain|price target|will (rise|fall|go up|go down)|should (invest|buy|sell)|guarantee[ds]?)\b/i;
const NUM_RE = /[−-]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|×|x\b|pp\b|[BMKT]\b|yrs?\b|th\b)?/g;
/** Numeric value of a token like "−12.5%", "$1.2B", "3.4×" (sign kept, units dropped). */
function numValue(tok: string): number | null {
  const t = tok.replace(/−/g, "-").replace(/,/g, "");
  const m = t.match(/(-?)\$?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[2]) * (m[1] ? -1 : 1);
  return Number.isFinite(v) ? v : null;
}

export interface Sentence { text: string; fact_ids: string[]; kind: string }
export interface Explanation { sentences: Sentence[]; missing: string[]; source: "model" | "template"; provider?: string }

/** Check model output against the facts. Returns the accepted sentences and the problems found. */
export function validateExplanation(raw: unknown, facts: Fact[]): { ok: boolean; sentences: Sentence[]; missing: string[]; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  // deno-lint-ignore no-explicit-any
  const r = raw as any;
  const arr = Array.isArray(r?.sentences) ? r.sentences : null;
  if (!arr || !arr.length) return { ok: false, sentences: [], missing: [], errors: ["no sentences array"] };
  const sentences: Sentence[] = [];
  arr.slice(0, 7).forEach((s: unknown, i: number) => {
    // deno-lint-ignore no-explicit-any
    const x = s as any;
    const text = typeof x?.text === "string" ? x.text.trim() : "";
    const ids: string[] = Array.isArray(x?.fact_ids) ? x.fact_ids.filter((k: unknown) => typeof k === "string") : [];
    if (!text) { errors.push(`sentence ${i + 1}: empty`); return; }
    if (text.length > 360) { errors.push(`sentence ${i + 1}: too long`); return; }
    if (BANNED.test(text)) { errors.push(`sentence ${i + 1}: investment advice wording`); return; }
    const unknown = ids.filter((k) => !byId.has(k));
    if (unknown.length) { errors.push(`sentence ${i + 1}: unknown fact ids ${unknown.join(", ")}`); return; }
    // numbers allowed = every number appearing in the cited facts (display and label)
    const allowed = new Set<number>();
    for (const k of ids) for (const n of (byId.get(k)!.display + " " + byId.get(k)!.label).match(NUM_RE) ?? []) {
      const v = numValue(n); if (v !== null) allowed.add(v);
    }
    for (const n of text.match(NUM_RE) ?? []) {
      const v = numValue(n);
      if (v === null) continue;
      if (Number.isInteger(v) && v >= 0 && v <= 12 && !/[%$×]/.test(n)) continue;   // small counts: "3 years", "12 months"
      if (![...allowed].some((a) => a === v)) { errors.push(`sentence ${i + 1}: number "${n.trim()}" isn't in its cited facts`); return; }
    }
    sentences.push({ text, fact_ids: ids, kind: typeof x?.kind === "string" ? x.kind : "this_company" });
  });
  const missing = Array.isArray(r?.missing) ? r.missing.filter((m: unknown) => typeof m === "string").slice(0, 4) : [];
  return { ok: errors.length === 0 && sentences.length > 0, sentences, missing, errors };
}

/** Deterministic fallback when the model is unavailable or fails validation. */
export function templateExplanation(p: LensPayload, conceptId: string): Explanation {
  if (conceptId === "story") return { sentences: p.story.map((t) => ({ text: t, fact_ids: [], kind: "this_company" })), missing: [], source: "template" };
  const c = p.cards.find((x) => x.id === conceptId);
  const out: Sentence[] = [];
  if (c) {
    const m = c.metrics.find((x) => x.id === c.primary) ?? c.metrics[0];
    if (m) {
      out.push({ text: `${p.symbol}'s ${m.label.toLowerCase()} is ${m.display} (${m.period}).`, fact_ids: [m.id], kind: "this_company" });
      if (m.peer) out.push({ text: `That puts it at the ${m.peer.pct}th percentile of ${m.peer.n} ${m.peer.group} peers, whose median is ${m.peer.median}.`, fact_ids: [`${m.id}.peer_pct`, `${m.id}.peer_median`], kind: "vs_industry" });
      if (m.bench) out.push({ text: `Across ${m.bench.industry} as a whole the figure is ${m.bench.display}${m.bench.market ? `, against ${m.bench.market} for the whole market` : ""}.`, fact_ids: [`${m.id}.industry_avg`, ...(m.bench.market ? [`${m.id}.market_avg`] : [])], kind: "vs_industry" });
      if (m.note) out.push({ text: m.note, fact_ids: [`${m.id}.note`], kind: "caveat" });
    }
    if (c.stageNote && p.lifeCycle) out.push({ text: `For a ${p.lifeCycle.label} company: ${c.stageNote}`, fact_ids: ["stage"], kind: "stage" });
  }
  return { sentences: out, missing: [], source: "template" };
}

export function explanationPrompt(p: LensPayload, conceptId: string, facts: Fact[]): { system: string; user: string } {
  const c = conceptId === "story" ? null : CONCEPT_BY_ID.get(conceptId);
  const lesson = c
    ? { concept: c.title, what: c.what, why: c.why, industry: c.industry, stage_note: p.lifeCycle ? c.stages[p.lifeCycle.stage] ?? null : null, caveats: c.caveats }
    : { concept: "The company's story in numbers", stage: p.lifeCycle ? STAGES[p.lifeCycle.stage as Stage] : null };
  const system = [
    "You explain a company's fundamentals to a trader who is learning, in plain English, in the spirit of Aswath Damodaran's teaching (growth, profitability, reinvestment, risk; the corporate life cycle).",
    "Rules:",
    "- Use ONLY the facts provided. Copy numbers exactly as written in a fact's `display`; never calculate, round or invent a number.",
    "- Every sentence lists the ids of the facts it uses in `fact_ids`. A sentence without numbers may cite none.",
    "- Explain what the number means for THIS company, how it compares with its peers and with Damodaran's industry average (and why the industry differs from the whole market, using the lesson's industry note), what is normal at its life-cycle stage, and one thing the number can't tell you.",
    "- No investment advice: never say buy, sell, cheap, undervalued, overvalued, or predict the price.",
    "- If something needed for a fair explanation is missing, list it in `missing` instead of guessing.",
    "- 3 to 5 short sentences. Do not quote Damodaran.",
    'Reply with JSON only: {"sentences":[{"text":"…","fact_ids":["…"],"kind":"this_company|vs_industry|stage|why|caveat"}],"missing":["…"]}',
  ].join("\n");
  const user = JSON.stringify({ lesson, facts });
  return { system, user };
}

/** Stable hash of the facts (cache key). */
export function factsHash(facts: Fact[]): string {
  const s = facts.map((f) => `${f.id}=${f.display}`).join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
