import { supabase } from "@/integrations/supabase/client";

// Client side of the `classify-tickers` edge function (permanent Sector →
// Industry → Sub-Industry labels). The function does the work; this file only
// starts runs, reads progress and keeps the once-a-day auto run cheap.

export interface ClassificationStatus {
  total: number;
  pending: number;
  needs_av: number;
  needs_ai: number;
  done: number;
  failed: number;
  avKeyConfigured: boolean;
  avUsedToday: number;
  avDailyCap: number;
  fmpUsedToday: number;
}

export interface ClassifierResponse {
  ok: boolean;
  setupNeeded?: boolean;
  error?: string;
  status?: ClassificationStatus;
  ran?: {
    added: number;
    stage1: { done: number; toAv: number };
    av: { calls: number; done: number; toAi: number; limited: boolean };
    ai: { done: number; failed: number };
    synced: number;
    ms: number;
  };
}

export const UNIVERSE_SECTORS_CACHE_KEY = "universe_sectors_v3";
const AUTO_RUN_DAY_KEY = "classify_auto_day_v1";
const STATUS_EVENT = "classification-status";

async function invoke(action: "status" | "run" | "retry_failed"): Promise<ClassifierResponse> {
  const { data, error } = await supabase.functions.invoke("classify-tickers", { body: { action } });
  if (error) {
    // Function not deployed yet / network error.
    return { ok: false, error: error.message ?? String(error) };
  }
  return data as ClassifierResponse;
}

function broadcast(r: ClassifierResponse) {
  try { window.dispatchEvent(new CustomEvent<ClassifierResponse>(STATUS_EVENT, { detail: r })); } catch { /* ignore */ }
}

export function onClassificationStatus(cb: (r: ClassifierResponse) => void) {
  const h = (e: Event) => cb((e as CustomEvent<ClassifierResponse>).detail);
  window.addEventListener(STATUS_EVENT, h);
  return () => window.removeEventListener(STATUS_EVENT, h);
}

export async function getClassificationStatus(): Promise<ClassifierResponse> {
  const r = await invoke("status");
  broadcast(r);
  return r;
}

export async function retryFailedClassifications(): Promise<ClassifierResponse> {
  const r = await invoke("retry_failed");
  broadcast(r);
  return r;
}

/** Is there anything a run can do right now? */
export function hasRunnableWork(s: ClassificationStatus | undefined): boolean {
  if (!s) return true; // unknown → let the server decide (it also discovers new tickers)
  if (s.pending > 0 || s.needs_ai > 0) return true;
  if (s.needs_av > 0 && (!s.avKeyConfigured || s.avUsedToday < s.avDailyCap)) return true;
  return false;
}

function clearUniverseSectorsCache() {
  try { localStorage.removeItem(UNIVERSE_SECTORS_CACHE_KEY); } catch { /* ignore */ }
}

let running: Promise<ClassifierResponse> | null = null;
export const isClassifierRunning = () => running !== null;

/**
 * Run batches until nothing more can be done today (or maxRuns is reached).
 * Only one loop runs at a time; a second caller gets the same promise.
 */
export function runClassification(maxRuns = 60): Promise<ClassifierResponse> {
  if (running) return running;
  running = (async () => {
    let last: ClassifierResponse = { ok: false };
    try {
      for (let i = 0; i < maxRuns; i++) {
        last = await invoke("run");
        broadcast(last);
        if (!last.ok) break;
        const r = last.ran;
        const progressed = !!r && (
          r.added > 0 || r.stage1.done + r.stage1.toAv > 0 || r.av.calls > 0 || r.ai.done + r.ai.failed > 0
        );
        if (!progressed || !hasRunnableWork(last.status)) break;
      }
    } finally {
      clearUniverseSectorsCache();
      running = null;
    }
    broadcast(last); // final event: listeners see isClassifierRunning() === false
    return last;
  })();
  return running;
}

/**
 * Once per day, when the app is opened: continue the queue in the background
 * (new tickers, Alpha Vantage's daily allowance, AI leftovers). Silent and cheap —
 * a single status call when there is nothing to do.
 */
export async function autoRunClassificationOncePerDay() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(AUTO_RUN_DAY_KEY) === day) return;
    localStorage.setItem(AUTO_RUN_DAY_KEY, day);
  } catch { /* storage blocked → still run once this session */ }
  // Always run once: it also picks up tickers added since yesterday.
  await runClassification(8);
}
