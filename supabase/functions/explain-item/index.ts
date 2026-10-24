// Lightweight Groq-powered explainer for a single news headline or economic event.
// Returns a short structured brief. Cached aggressively client-side.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasAnyLlm()) return json({ error: "No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY)" }, 500);
    const body = await req.json().catch(() => ({}));
    const kind: "event" | "news" = body.kind === "news" ? "news" : "event";
    const payload = body.payload || {};

    let userPrompt = "";
    if (kind === "event") {
      userPrompt = `Economic / market event:
- Name: ${payload.event || "Unknown"}
- Country: ${payload.country || "?"}
- Scheduled: ${payload.date || "?"}
- Impact tag: ${payload.impact || "?"}
- Previous: ${payload.previous ?? "n/a"}
- Estimate: ${payload.estimate ?? "n/a"}
- Actual: ${payload.actual ?? "n/a"}

Explain for a US active equity trader.`;
    } else {
      userPrompt = `News item:
- Headline: ${payload.headline || ""}
- Summary: ${payload.summary || ""}
- Source: ${payload.source || ""}
- Symbol: ${payload.symbol || ""}

Explain for a US active equity trader.`;
    }

    const systemPrompt = `You are a senior macro+equities analyst. Reply in STRICT JSON only, no prose:
{
  "what": "1-2 sentences: what this event/news actually is",
  "expected": "1 sentence: what consensus/market expects (or 'N/A' if not applicable)",
  "impact_level": "High" | "Medium" | "Low",
  "impact_text": "2-3 sentences: likely effect on US equity market (SPY/QQQ, rates, sectors, momentum). Mention specific tickers/sectors when relevant."
}
Keep it tight, factual, trader-focused. No disclaimers. Never invent precise numbers you don't have.`;

    const resp = await llmFetch({
        model: "openai/gpt-oss-120b", reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { task: "fast", label: "explain-item" });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Groq error", resp.status, t.slice(0, 200));
      return json({ error: `Groq ${resp.status}` }, 500);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch {}
    return json({
      what: parsed.what || "",
      expected: parsed.expected || "",
      impact_level: parsed.impact_level || "Medium",
      impact_text: parsed.impact_text || "",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("explain-item error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
