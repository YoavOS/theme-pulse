// Shared AI router for all edge functions.
//
// Every function used to call Groq (or the Lovable AI gateway) directly, so all
// AI features shared one free Groq allowance (~8K tokens/min, 200K/day for
// gpt-oss-120b). This module spreads the work across free providers and falls
// over to the next one when a provider is missing, rate-limited or down:
//
//   task "long"     → Gemini → Groq → Cerebras → OpenRouter   (long inputs, reasoning)
//   task "fast"     → Groq → Cerebras → Gemini → OpenRouter   (short, latency-sensitive)
//   task "grounded" → Gemini + Google Search, then the "long" chain without search
//
// `llmFetch(body, opts)` is a drop-in for `fetch(".../chat/completions", …)`:
// it takes the same OpenAI-style body (messages, temperature, max_tokens,
// response_format, tools, tool_choice; `model` is ignored) and resolves to a
// `Response` whose JSON is OpenAI-shaped ({ choices: [{ message }] }), plus
// `provider`, `model` and, for grounded calls, `sources`.
//
// Secrets (only GEMINI_API_KEY or GROQ_API_KEY is required; the others add backups):
//   GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY
// Optional overrides: GEMINI_MODELS (comma list, tried in order), GROQ_MODEL,
//   CEREBRAS_MODEL, OPENROUTER_MODEL.

export type LlmTask = "long" | "fast" | "grounded";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
type Provider = "gemini" | "groq" | "cerebras" | "openrouter";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

const GEMINI_MODELS = (env("GEMINI_MODELS") || "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean);
const GROQ_MODEL = env("GROQ_MODEL") || "openai/gpt-oss-120b";
const CEREBRAS_MODEL = env("CEREBRAS_MODEL") || "gpt-oss-120b";
const OPENROUTER_MODEL = env("OPENROUTER_MODEL") || "openai/gpt-oss-120b:free";

const TIMEOUT_MS = 55_000;

// Gemini models that answered "not found" in this worker — skipped afterwards.
const deadGemini = new Set<string>();
// Providers that rate-limited us recently: provider → retry-after timestamp.
const cooling = new Map<Provider, number>();

const KEY_OF: Record<Provider, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY", openrouter: "OPENROUTER_API_KEY" };

/** Test hook: forget rate-limit cool-downs and missing Gemini models. */
export function _resetLlmState() { cooling.clear(); deadGemini.clear(); }

export function hasAnyLlm(): boolean {
  return !!(env("GEMINI_API_KEY") || env("GROQ_API_KEY") || env("CEREBRAS_API_KEY") || env("OPENROUTER_API_KEY"));
}

class ProviderError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/** OpenAI-compatible chat call (Groq, Cerebras, OpenRouter, Gemini's compat endpoint). */
async function openAiCompatible(url: string, key: string, body: Body, extraHeaders: Record<string, string> = {}): Promise<Body> {
  const res = await withTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ProviderError(res.status, (await res.text().catch(() => "")).slice(0, 400));
  const j = await res.json();
  const msg = j?.choices?.[0]?.message;
  if (!msg || (!msg.content && !(msg.tool_calls?.length))) throw new ProviderError(502, "empty completion");
  return j;
}

function stripForGemini(body: Body): Body {
  // Gemini's OpenAI-compatible endpoint rejects some Groq-only fields, and its
  // "thinking" counts against max_tokens — give it headroom so answers aren't cut off.
  const { reasoning_effort: _r, model: _m, ...rest } = body;
  const out: Body = { ...rest };
  if (typeof out.max_tokens === "number") out.max_tokens = out.max_tokens + 4096;
  return out;
}

async function callGemini(body: Body): Promise<{ json: Body; model: string }> {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new ProviderError(0, "GEMINI_API_KEY not set");
  let last: ProviderError | null = null;
  for (const model of GEMINI_MODELS) {
    if (deadGemini.has(model)) continue;
    try {
      const json = await openAiCompatible("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key, { ...stripForGemini(body), model });
      return { json, model };
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(0, String(e));
      if (last.status === 404) { deadGemini.add(model); continue; }
      if (last.status === 400 && /model/i.test(last.message)) { deadGemini.add(model); continue; }
      if (last.status === 429 || last.status >= 500) continue; // next model has its own quota
      throw last;
    }
  }
  throw last ?? new ProviderError(0, "no Gemini model available");
}

/** Gemini with Google Search grounding (native API; plain text out, plus the web sources it used). */
async function callGeminiGrounded(body: Body): Promise<{ json: Body; model: string }> {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new ProviderError(0, "GEMINI_API_KEY not set");
  // deno-lint-ignore no-explicit-any
  const msgs: any[] = Array.isArray(body.messages) ? body.messages : [];
  const system = msgs.filter((m) => m.role === "system").map((m) => String(m.content ?? "")).join("\n\n");
  const contents = msgs.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content ?? "") }],
  }));
  const wantsJson = body.response_format?.type === "json_object";
  const generationConfig: Body = {};
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.max_tokens === "number") generationConfig.maxOutputTokens = body.max_tokens + 4096;
  let last: ProviderError | null = null;
  for (const model of GEMINI_MODELS) {
    if (deadGemini.has(model)) continue;
    try {
      const res = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system + (wantsJson ? "\n\nReply with a single JSON object only, no markdown fences." : "") }] } } : {}),
          contents,
          tools: [{ google_search: {} }],
          generationConfig,
        }),
      });
      if (!res.ok) throw new ProviderError(res.status, (await res.text().catch(() => "")).slice(0, 400));
      const j = await res.json();
      const cand = j?.candidates?.[0];
      // deno-lint-ignore no-explicit-any
      const text = (cand?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
      if (!text) throw new ProviderError(502, "empty completion");
      // deno-lint-ignore no-explicit-any
      const sources = (cand?.groundingMetadata?.groundingChunks ?? []).map((c: any) => ({ title: c?.web?.title ?? null, url: c?.web?.uri ?? null })).filter((s: Body) => s.url);
      return { json: { choices: [{ message: { role: "assistant", content: wantsJson ? extractJson(text) : text } }], sources }, model };
    } catch (e) {
      last = e instanceof ProviderError ? e : new ProviderError(0, String(e));
      if (last.status === 404) { deadGemini.add(model); continue; }
      if (last.status === 429 || last.status >= 500) continue;
      throw last;
    }
  }
  throw last ?? new ProviderError(0, "no Gemini model available");
}

/** Pull the JSON object out of a reply that may be wrapped in prose or ``` fences. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1] : text;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return a >= 0 && b > a ? s.slice(a, b + 1) : s.trim();
}

async function callProvider(p: Provider, body: Body): Promise<{ json: Body; model: string }> {
  switch (p) {
    case "gemini": return callGemini(body);
    case "groq": {
      const key = env("GROQ_API_KEY");
      if (!key) throw new ProviderError(0, "GROQ_API_KEY not set");
      return { json: await openAiCompatible("https://api.groq.com/openai/v1/chat/completions", key, { ...body, model: GROQ_MODEL }), model: GROQ_MODEL };
    }
    case "cerebras": {
      const key = env("CEREBRAS_API_KEY");
      if (!key) throw new ProviderError(0, "CEREBRAS_API_KEY not set");
      return { json: await openAiCompatible("https://api.cerebras.ai/v1/chat/completions", key, { ...body, model: CEREBRAS_MODEL }), model: CEREBRAS_MODEL };
    }
    case "openrouter": {
      const key = env("OPENROUTER_API_KEY");
      if (!key) throw new ProviderError(0, "OPENROUTER_API_KEY not set");
      return { json: await openAiCompatible("https://openrouter.ai/api/v1/chat/completions", key, { ...body, model: OPENROUTER_MODEL }, { "X-Title": "Theme Pulse" }), model: OPENROUTER_MODEL };
    }
  }
}

const CHAINS: Record<Exclude<LlmTask, "grounded">, Provider[]> = {
  long: ["gemini", "groq", "cerebras", "openrouter"],
  fast: ["groq", "cerebras", "gemini", "openrouter"],
};

/**
 * Drop-in replacement for `fetch("https://api.groq.com/openai/v1/chat/completions", …)`.
 * Resolves to a Response with an OpenAI-shaped JSON body; when every provider
 * fails it resolves to a non-OK Response (429 if they were all rate-limited).
 */
export async function llmFetch(body: Body, opts: { task: LlmTask; label?: string } = { task: "long" }): Promise<Response> {
  const attempts: string[] = [];
  let limited = 0, failed = 0;
  const wantsJson = body.response_format?.type === "json_object";
  const ok = (json: Body, provider: string, model: string) => {
    const msg = json?.choices?.[0]?.message;
    if (wantsJson && msg && typeof msg.content === "string") msg.content = extractJson(msg.content);
    if (attempts.length) console.log(`[llm${opts.label ? ":" + opts.label : ""}] served by ${provider}/${model} after: ${attempts.join(" | ")}`);
    return new Response(JSON.stringify({ ...json, provider, model }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  if (opts.task === "grounded" && !body.tools) {
    try {
      const r = await callGeminiGrounded(body);
      return ok(r.json, "gemini+search", r.model);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(0, String(e));
      attempts.push(`gemini+search ${pe.status || ""} ${pe.message.slice(0, 120)}`);
      // Search grounding shares Gemini's quota: a 429 here means plain Gemini is limited too.
      if (pe.status === 429) { limited++; cooling.set("gemini", Date.now() + 20_000); } else if (!/not set/.test(pe.message)) failed++;
    }
  }

  const chain = CHAINS[opts.task === "fast" ? "fast" : "long"];
  for (const p of chain) {
    if (!env(KEY_OF[p])) continue;
    const until = cooling.get(p);
    if (until && until > Date.now()) { attempts.push(`${p} cooling`); continue; }
    try {
      const r = await callProvider(p, body);
      return ok(r.json, p, r.model);
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError(0, String(e));
      attempts.push(`${p} ${pe.status || ""} ${pe.message.slice(0, 120)}`);
      if (pe.status === 429) { cooling.set(p, Date.now() + 20_000); limited++; }
      else if (!/not set/.test(pe.message)) failed++;
    }
  }
  console.error(`[llm${opts.label ? ":" + opts.label : ""}] all providers failed: ${attempts.join(" | ")}`);
  // 429 when every provider we could reach was rate-limited; 503 when no key is configured at all.
  const status = limited + failed === 0 ? 503 : failed === 0 ? 429 : 502;
  const message = status === 503 ? "No AI provider key configured (set GEMINI_API_KEY or GROQ_API_KEY)" : `AI providers unavailable: ${attempts.join(" | ")}`;
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { "Content-Type": "application/json" } });
}
