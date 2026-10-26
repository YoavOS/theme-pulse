// AI provider health check: sends one tiny prompt to each configured provider /
// Gemini model (plain and with Google Search) and reports status, latency and the
// provider's error message. Never returns key values — only whether a key is set.
// GET or POST /functions/v1/llm-health
import { corsHeaders } from "../_shared/cors.ts";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const GEMINI_MODELS = (env("GEMINI_MODELS") || "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.8-flash").split(",").map((s) => s.trim()).filter(Boolean);
const PROMPT = "Reply with the single word: ok";

async function timed(label: string, url: string, init: RequestInit, pick: (j: any) => string) { // deno-lint-ignore no-explicit-any
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let reply: string | null = null;
    try { reply = pick(JSON.parse(text))?.slice(0, 60) ?? null; } catch { /* not json */ }
    return { check: label, ok: res.ok && !!reply, status: res.status, ms: Date.now() - t0, reply, error: res.ok ? null : text.slice(0, 300) };
  } catch (e) {
    return { check: label, ok: false, status: 0, ms: Date.now() - t0, reply: null, error: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(t); }
}

const openAi = (url: string, key: string, model: string, extra: Record<string, unknown> = {}) => ({
  url,
  init: {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }], max_tokens: 2000, ...extra }),
  },
  // deno-lint-ignore no-explicit-any
  pick: (j: any) => j?.choices?.[0]?.message?.content ?? null,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const keys = { GEMINI_API_KEY: !!env("GEMINI_API_KEY"), GROQ_API_KEY: !!env("GROQ_API_KEY"), CEREBRAS_API_KEY: !!env("CEREBRAS_API_KEY"), OPENROUTER_API_KEY: !!env("OPENROUTER_API_KEY") };
  // deno-lint-ignore no-explicit-any
  const jobs: Promise<any>[] = [];
  const g = env("GEMINI_API_KEY");
  if (g) {
    for (const m of GEMINI_MODELS) {
      const c = openAi("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", g, m, { reasoning_effort: "low" });
      jobs.push(timed(`gemini ${m}`, c.url, c.init, c.pick));
      jobs.push(timed(`gemini ${m} + search`, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": g, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "What is today's date? One short line." }] }], tools: [{ google_search: {} }], generationConfig: { thinkingConfig: { thinkingLevel: "low" } } }),
      // deno-lint-ignore no-explicit-any
      }, (j: any) => (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("") || null));
    }
    // Which models does this key actually have? (names only)
    jobs.push((async () => {
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": g } });
        const j = await r.json();
        // deno-lint-ignore no-explicit-any
        const names = (j?.models ?? []).map((m: any) => String(m.name).replace("models/", "")).filter((n: string) => /flash|pro/.test(n) && !/tts|image|live|embed|audio/.test(n));
        return { check: "gemini models available", ok: r.ok, status: r.status, models: names.slice(0, 40), error: r.ok ? null : JSON.stringify(j).slice(0, 300) };
      } catch (e) { return { check: "gemini models available", ok: false, error: String(e) }; }
    })());
  }
  if (env("GROQ_API_KEY")) { const c = openAi("https://api.groq.com/openai/v1/chat/completions", env("GROQ_API_KEY"), env("GROQ_MODEL") || "openai/gpt-oss-120b", { reasoning_effort: "low" }); jobs.push(timed("groq", c.url, c.init, c.pick)); }
  if (env("CEREBRAS_API_KEY")) { const c = openAi("https://api.cerebras.ai/v1/chat/completions", env("CEREBRAS_API_KEY"), env("CEREBRAS_MODEL") || "gpt-oss-120b"); jobs.push(timed("cerebras", c.url, c.init, c.pick)); }
  if (env("OPENROUTER_API_KEY")) { const c = openAi("https://openrouter.ai/api/v1/chat/completions", env("OPENROUTER_API_KEY"), env("OPENROUTER_MODEL") || "openai/gpt-oss-120b:free"); jobs.push(timed("openrouter", c.url, c.init, c.pick)); }
  const results = await Promise.all(jobs);
  return new Response(JSON.stringify({ keys, results, checkedAt: new Date().toISOString() }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
