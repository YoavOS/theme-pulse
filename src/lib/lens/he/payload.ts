import type { ConceptCard, LensPayload, Lecture, Metric } from "../types";
import { HE_CONCEPT, HE_LECTURE, HE_STAGE } from "./curriculum";
import { HE_METRIC, heMonthYear, heServer } from "./metrics";

/** The Lens payload with every teaching string in Hebrew. Company, industry and data-source names stay
 *  as they are (they're names, and they match TradingView and Damodaran's files). */
export function hePayload(p: LensPayload): LensPayload {
  const stage = p.lifeCycle?.stage ?? null;
  const lec = (l: Lecture): Lecture => ({ ...l, title: HE_LECTURE[l.videoId ?? "clc"] ?? l.title });
  const metric = (m: Metric): Metric => ({
    ...m,
    label: HE_METRIC[m.id]?.label ?? heServer(m.label),
    formula: HE_METRIC[m.id]?.formula ?? heServer(m.formula),
    period: heServer(m.period),
    display: heServer(m.display),
    note: m.note ? heServer(m.note) : m.note,
    inputs: m.inputs.map((x) => ({ label: heServer(x.label), display: heServer(x.display) })),
    bench: m.bench ? { ...m.bench, note: m.bench.note ? heServer(m.bench.note) : m.bench.note } : m.bench,
  });
  const card = (c: ConceptCard): ConceptCard => {
    const h = HE_CONCEPT[c.id];
    if (!h) return { ...c, metrics: c.metrics.map(metric), lectures: c.lectures.map(lec) };
    return {
      ...c,
      title: h.title, question: h.question, what: h.what, why: h.why, industry: c.industry ? h.industry || c.industry : "",
      stageNote: c.stageNote && stage ? h.stages[stage] ?? c.stageNote : c.stageNote,
      caveats: h.caveats.length === c.caveats.length ? h.caveats : c.caveats,
      metrics: c.metrics.map(metric), lectures: c.lectures.map(lec),
    };
  };
  const lc = p.lifeCycle;
  return {
    ...p,
    damodaran: p.damodaran ? { ...p.damodaran, asOf: heMonthYear(p.damodaran.asOf) } : p.damodaran,
    sec: { ...p.sec, status: p.sec.status === "ok" ? "ok" : heServer(p.sec.status) },
    lifeCycle: lc ? {
      ...lc,
      label: HE_STAGE[lc.stage].label, question: HE_STAGE[lc.stage].question, signature: HE_STAGE[lc.stage].signature, pricing: HE_STAGE[lc.stage].pricing,
      leaningLabel: lc.leaning ? HE_STAGE[lc.leaning].label : lc.leaningLabel,
      signals: lc.signals.map((s) => ({ ...s, label: heServer(s.label), display: heServer(s.display) })),
      lectures: lc.lectures.map(lec),
    } : lc,
    story: p.story.map(heServer),
    foundations: p.foundations.map(card),
    cards: p.cards.map(card),
    valuation: p.valuation ? { ...p.valuation, costOfCapitalSource: heServer(p.valuation.costOfCapitalSource) } : p.valuation,
    adjust: p.adjust ? { ...p.adjust, costOfDebtSource: heServer(p.adjust.costOfDebtSource) } : p.adjust,
  };
}
