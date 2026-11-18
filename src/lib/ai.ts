import { supabase } from "@/integrations/supabase/client";

export type AiLang = "en" | "he";
export interface AiStep { tool: string; why?: string | null; sql?: string; rows?: number; symbol?: string; error?: string }
export interface AiReport { id: number; kind: string; day: string; lang: AiLang; subject: string; title: string; content: string; model: string | null; created_at: string }
export interface AiStatus { local: { configured: boolean; reachable?: boolean; model?: string; installed?: string[]; error?: string }; cloudFallback: boolean }

async function rawInvoke(fn: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // the function's own message is in the response body
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error; } } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call an AI function. On the PC model the function answers at once with { job }; the answer is then picked up
 * here (every few seconds, up to 20 minutes). A chained job (the ask-your-data rounds) answers { next } until done.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeAi<T = any>(fn: string, body: Record<string, unknown>, onProgress?: (out: { steps?: AiStep[] }) => void): Promise<T> {
  let data = await rawInvoke(fn, body);
  const started = Date.now();
  while (data && typeof data === "object" && "job" in data && data.job) {
    let st = await rawInvoke(fn, { action: "job", id: data.job });
    while (st.status === "running" || st.status === "answered") {
      if (Date.now() - started > 20 * 60_000) throw new Error("The AI took too long (20 minutes). Is Ollama running on the PC?");
      await sleep(3000);
      st = await rawInvoke(fn, { action: "job", id: data.job });
    }
    if (st.status === "error") throw new Error(st.error ?? "the AI job failed");
    data = st.output ?? {};
    if (data?.steps) onProgress?.(data);
    if (data?.next) data = { job: data.next };
  }
  return data as T;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = <T = any>(body: Record<string, unknown>) => invokeAi<T>("ai-analyst", body);

/** Ask-your-data: the analyst may look things up over several rounds before answering. */
export async function askAi(question: string, history: { role: "user" | "assistant"; content: string }[], onSteps?: (steps: AiStep[]) => void) {
  const r = await invokeAi<{ done: boolean; answer?: string; steps: AiStep[]; model: string }>("ai-analyst", { action: "ask", question, history }, (o) => onSteps?.(o.steps ?? []));
  return { answer: r.answer ?? "", steps: r.steps ?? [], model: r.model };
}

export const aiStock = (symbol: string, lang: AiLang) => call<{ content: string; model: string }>({ action: "stock", symbol, lang });
export const aiFocus = (blocks: { title: string; symbols: string[]; notes?: string[] }[], lang: AiLang) =>
  call<{ content: string; model: string }>({ action: "focus", blocks, lang });
export const aiWriteReport = (lang: AiLang) => call<{ ok: boolean }>({ action: "report", lang, fresh: lang === "en" });
export const aiLatest = (kind: string, lang?: AiLang, subject?: string, limit = 1) =>
  call<{ reports: AiReport[] }>({ action: "latest", kind, lang, subject, limit }).then((r) => r.reports);
export const aiStatus = () => call<AiStatus>({ action: "status" });

const LANG_KEY = "ai_lang_v1";
export function readAiLang(): AiLang { try { return localStorage.getItem(LANG_KEY) === "he" ? "he" : "en"; } catch { return "en"; } }
export function saveAiLang(l: AiLang) { try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ } }

// ── From the filings ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callFile = <T = any>(body: Record<string, unknown>) => invokeAi<T>("company-file", body);
export interface Quoted { quote?: string; source?: string; verified?: boolean }
export interface CompanyFile {
  story?: string; segments?: { name: string; what: string }[]; customers?: { concentration: string } & Quoted; competitors?: string[];
  edge_claims?: ({ claim: string } & Quoted)[];
  three_p?: Record<"possible" | "plausible" | "probable", { verdict: string; why: string }>;
  words_vs_numbers?: ({ claim: string; numbers_say: string; agrees: string } & Quoted)[];
  guidance?: { text: string } & Quoted; backlog?: string | null; watch?: string[];
  riskChanges?: { summary?: string | null; notable?: { heading: string; kind: string; why: string }[]; added: number; removed: number; since?: string; allAdded?: string[]; allRemoved?: string[] };
  sources?: { tenK: { url: string; filed: string }; release: { url: string; filed: string } | null };
  rpo?: { end: string; val: number }[];
}
export const fileGet = (symbol: string, lang: AiLang) => callFile<{ file: { data: CompanyFile; model: string | null; created_at: string } | null }>({ symbol, lang, step: "get" });
export const fileStep = (symbol: string, lang: AiLang, step: "prepare" | "story" | "risks") => callFile({ symbol, lang, step });

/** Wait for one queued job of an AI function (already submitted elsewhere) and return its output. */
export async function waitJob(fn: string, id: number) {
  const started = Date.now();
  let st = await rawInvoke(fn, { action: "job", id });
  while (st.status === "running" || st.status === "answered") {
    if (Date.now() - started > 20 * 60_000) throw new Error("The AI took too long (20 minutes).");
    await sleep(3000);
    st = await rawInvoke(fn, { action: "job", id });
  }
  if (st.status === "error") throw new Error(st.error ?? "the AI job failed");
  return st.output;
}
