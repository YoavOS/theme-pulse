// Spaced review (Leitner boxes) for the Fundamentals Lens, kept in this browser.
// A concept's questions unlock once the concept has been opened. Right answers move a question up a
// box and push it further out; a wrong answer sends it back to box 1.
import { QUIZ_BANK, type QuizQ } from "./quizBank";
import type { LensPayload, Metric } from "./types";

export interface QState { box: number; due: string; seen: number; right: number }
const KEY = "lens-review-v1";
export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35];   // index = box (1..5)
export const MAX_BOX = 5;

export function readReview(): Record<string, QState> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}
function save(all: Record<string, QState>) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ } }

/** Next state after an answer (pure). */
export function nextState(prev: QState | undefined, correct: boolean, now = new Date()): QState {
  const box = correct ? Math.min(MAX_BOX, (prev?.box ?? 0) + 1) : 1;
  const days = correct ? INTERVAL_DAYS[box] : 0;
  const due = new Date(now.getTime() + (correct ? days * 86400_000 : 10 * 60_000)).toISOString();
  return { box, due, seen: (prev?.seen ?? 0) + 1, right: (prev?.right ?? 0) + (correct ? 1 : 0) };
}

export function recordAnswer(id: string, correct: boolean) {
  const all = readReview();
  all[id] = nextState(all[id], correct);
  save(all);
}

/** Bank questions that are due: concept opened, and never answered or past their due time. */
export function dueQuestions(opened: Set<string>, state = readReview(), now = new Date()): QuizQ[] {
  return QUIZ_BANK.filter((q) => opened.has(q.concept) && (!state[q.id] || Date.parse(state[q.id].due) <= now.getTime()))
    .sort((a, b) => (state[a.id]?.box ?? 0) - (state[b.id]?.box ?? 0))
    .map((q) => shuffled(q, state[q.id]?.seen ?? 0));
}

export function reviewStats(state = readReview()) {
  const v = Object.values(state);
  return { learned: v.filter((s) => s.box >= 3).length, total: QUIZ_BANK.length, answered: v.length };
}

/** Shuffle a bank question's choices (stable per question and attempt), keeping track of the answer. */
export function shuffled(q: QuizQ, attempt: number): QuizQ {
  let h = 2166136261;
  for (const ch of `${q.id}#${attempt}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const order = q.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, choices: order.map((i) => q.choices[i]), answer: order.indexOf(q.answer) };
}

// ── Questions about the ticker on screen (generated, not scheduled) ─────────────────────

const ALL_METRICS = (p: LensPayload) => p.cards.flatMap((c) => c.metrics.map((m) => ({ m, c })));

export function tickerQuestions(p: LensPayload): QuizQ[] {
  const out: QuizQ[] = [];
  const S = p.symbol;
  if (p.lifeCycle) {
    const stages = ["Start-up", "Young Growth", "High Growth", "Mature Growth", "Mature Stable", "Decline"];
    const right = p.lifeCycle.label;
    const i = stages.indexOf(right);
    const others = stages.filter((s) => s !== right);
    // three distractors, nearest stages first
    const pick = others.sort((a, b) => Math.abs(stages.indexOf(a) - i) - Math.abs(stages.indexOf(b) - i)).slice(0, 3);
    const choices = [...pick, right].sort((a, b) => stages.indexOf(a) - stages.indexOf(b));
    out.push({ id: `t:${S}:stage`, concept: "life_cycle", q: `Where did the app place ${S} in the life cycle?`, choices, answer: choices.indexOf(right),
      why: `${p.lifeCycle.label}: ${p.lifeCycle.signature}` });
  }
  const benchM = ALL_METRICS(p).find(({ m }) => ["op_margin", "gross_margin", "roic", "sales_to_capital"].includes(m.id) && m.bench);
  if (benchM) {
    const { m } = benchM;
    const choices = ["Above the industry average", "In line with it", "Below it"];
    const ans = m.bench!.position === "above" ? 0 : m.bench!.position === "in line" ? 1 : 2;
    out.push({ id: `t:${S}:bench:${m.id}`, concept: benchM.c.id, q: `${S}'s ${m.label.toLowerCase()} is ${m.display}. Compared with Damodaran's average for ${m.bench!.industry}, it is…`,
      choices, answer: ans, why: `The industry average is ${m.bench!.display} (whole market ${m.bench!.market ?? "n/a"}). Within about a tenth of the average counts as in line.` });
  }
  const ex = ALL_METRICS(p).find(({ m }) => m.id === "excess_return" && m.value !== null);
  if (ex) {
    const v = ex.m.value as number;
    const choices = ["Yes — growth at these returns adds value", "Roughly break-even", "No — growth at these returns doesn't add value yet"];
    out.push({ id: `t:${S}:spread`, concept: "value_creation", q: `Does ${S}'s return on capital beat what capital costs in its industry?`, choices,
      answer: v > 1 ? 0 : v < -1 ? 2 : 1, why: `Return on capital minus the industry's cost of capital: ${ex.m.display}. Within ±1 pp counts as break-even here.` });
  }
  const peer = ALL_METRICS(p).find(({ m }) => m.id === "rev_growth_ttm" && m.peer) as { m: Metric } | undefined;
  if (peer?.m.peer) {
    const pos = peer.m.peer.position;
    const choices = ["Top fifth", "Around the middle", "Bottom fifth"];
    const ans = pos === "top" || pos === "upper" ? 0 : pos === "middle" ? 1 : 2;
    if (pos === "top" || pos === "middle" || pos === "bottom") {
      out.push({ id: `t:${S}:peer`, concept: "revenue_growth", q: `${S}'s revenue grew ${peer.m.display}. Among ${peer.m.peer.n} ${peer.m.peer.group} companies in the app, that ranks…`, choices, answer: ans,
        why: `${peer.m.peer.pct}th percentile; the peer median is ${peer.m.peer.median}.` });
    }
  }
  return out;
}
