// News digest — takes a batch of recent articles and uses Groq to produce
// a structured JSON summary grouped by theme with impact ratings.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";


interface InputArticle {
  headline: string;
  summary?: string | null;
  source?: string | null;
  symbol?: string | null;
  published_at?: string | null;
  url?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasAnyLlm()) {
      return jsonResponse({ groups: [], error: "No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY)" });
    }

    const body = await req.json().catch(() => ({}));
    const articles: InputArticle[] = Array.isArray(body.articles) ? body.articles : [];
    if (articles.length === 0) {
      return jsonResponse({ groups: [], generatedAt: new Date().toISOString() });
    }

    // Trim to last 24h-ish, top 40 to keep prompt tight
    const now = Date.now();
    const ranked = articles
      .map((a) => {
        const t = a.published_at ? new Date(a.published_at).getTime() : 0;
        const ageH = t ? (now - t) / 3_600_000 : 999;
        return { a, score: Math.max(0, 100 - ageH) };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, 40)
      .map((x) => x.a);

    const compact = ranked.map((a, i) => ({
      i,
      h: a.headline,
      s: (a.summary || "").slice(0, 220),
      src: a.source,
      sym: a.symbol,
      t: a.published_at,
    }));

    const systemPrompt = `You are a senior market analyst. Group today's news into 3-6 themes for an active US-equities trader.

Allowed themes (pick any that fit; you may add 1 custom if truly needed):
- "Fed & Macro Policy"
- "Inflation & Economic Data"
- "Geopolitics"
- "AI & Tech"
- "Energy & Commodities"
- "Earnings & Corporate"
- "Crypto & Risk Sentiment"
- "Sector-Specific"

Return STRICT JSON only, no prose, matching exactly:
{
  "groups": [
    {
      "theme": "string",
      "impact": "High" | "Medium" | "Low",
      "bullets": [
        { "text": "concise 1-line summary with bolded tickers like **NVDA**", "impact": "Bullish" | "Bearish" | "Neutral" }
      ]
    }
  ]
}

Rules:
- 2-5 bullets per theme, ordered by importance.
- Bullets must be punchy, scannable, fact-based — no fluff, no disclaimers.
- Use **TICKER** in bold for any company mention.
- Mark impact at both theme level (overall) and bullet level (directional).
- Skip duplicate stories; merge similar headlines.
- If a theme has nothing meaningful, omit it.`;

    const userPrompt = `Articles:\n${JSON.stringify(compact)}`;

    const resp = await llmFetch({
        model: "openai/gpt-oss-120b", reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: 2900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }, { task: "long", label: "news-digest" });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Groq error", resp.status, t.slice(0, 300));
      return jsonResponse({ groups: [], error: `Groq ${resp.status}` });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];

    return jsonResponse({
      groups,
      generatedAt: new Date().toISOString(),
      articleCount: ranked.length,
    });
  } catch (e) {
    console.error("news-digest error:", e);
    return jsonResponse({ groups: [], error: e instanceof Error ? e.message : "unknown" });
  }
});
