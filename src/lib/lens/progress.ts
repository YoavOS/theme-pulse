// Learning progress for the Fundamentals Lens, kept in this browser (localStorage).
// Per concept: how often it was opened, the deepest layer viewed, and the ticker it was first met on.

export interface ConceptProgress { opens: number; maxLevel: number; firstTicker: string; lastSeen: string }
const KEY = "lens-progress-v1";
const EVENT = "lens-progress";

export function readProgress(): Record<string, ConceptProgress> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function markConcept(id: string, ticker: string, level: number) {
  const all = readProgress();
  const p = all[id] ?? { opens: 0, maxLevel: 0, firstTicker: ticker, lastSeen: "" };
  all[id] = { opens: p.opens + (level === 1 ? 1 : 0), maxLevel: Math.max(p.maxLevel, level), firstTicker: p.firstTicker || ticker, lastSeen: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify(all)); window.dispatchEvent(new Event(EVENT)); } catch { /* ignore */ }
}

export const PROGRESS_EVENT = EVENT;
