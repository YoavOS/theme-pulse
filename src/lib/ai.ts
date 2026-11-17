import { supabase } from "@/integrations/supabase/client";

export type AiLang = "en" | "he";
export interface AiStep { tool: string; why?: string | null; sql?: string; rows?: number; symbol?: string; error?: string }
export interface AiReport { id: number; kind: string; day: string; lang: AiLang; subject: string; title: string; content: string; model: string | null; created_at: string }
export interface AiStatus { local: { configured: boolean; reachable?: boolean; model?: string; installed?: string[]; error?: string }; cloudFallback: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai-analyst", { body });
  if (error) {
    // the function's own message is in the response body
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error; } } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Ask-your-data: keeps calling while the analyst is still looking things up. */
export async function askAi(question: string, history: { role: "user" | "assistant"; content: string }[], onSteps?: (steps: AiStep[]) => void) {
  const steps: AiStep[] = [];
  let state: unknown[] | undefined;
  for (let i = 0; i < 6; i++) {
    const r = await call<{ done: boolean; answer?: string; state?: unknown[]; steps: AiStep[]; provider: string; model: string }>(
      state ? { action: "ask", state } : { action: "ask", question, history });
    steps.push(...(r.steps ?? []));
    onSteps?.([...steps]);
    if (r.done) return { answer: r.answer ?? "", steps, provider: r.provider, model: r.model };
    state = r.state;
  }
  throw new Error("The analyst took too long — try a narrower question.");
}

export const aiStock = (symbol: string, lang: AiLang) => call<{ content: string; provider: string; model: string }>({ action: "stock", symbol, lang });
export const aiFocus = (blocks: { title: string; symbols: string[]; notes?: string[] }[], lang: AiLang) =>
  call<{ content: string; provider: string; model: string }>({ action: "focus", blocks, lang });
export const aiWriteReport = (lang: AiLang) => call<{ ok: boolean }>({ action: "report", lang, fresh: lang === "en" });
export const aiLatest = (kind: string, lang?: AiLang, subject?: string, limit = 1) =>
  call<{ reports: AiReport[] }>({ action: "latest", kind, lang, subject, limit }).then((r) => r.reports);
export const aiStatus = () => call<AiStatus>({ action: "status" });

const LANG_KEY = "ai_lang_v1";
export function readAiLang(): AiLang { try { return localStorage.getItem(LANG_KEY) === "he" ? "he" : "en"; } catch { return "en"; } }
export function saveAiLang(l: AiLang) { try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ } }

// ── From the filings ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callFile<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("company-file", { body });
  if (error) {
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error; } } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
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
