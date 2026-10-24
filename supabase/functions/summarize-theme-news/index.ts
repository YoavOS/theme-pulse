const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const SYSTEM_PROMPT = `You are a market analyst summarizing news for a specific investment theme.
You receive a curated list of the most recent and most relevant headlines (with source, snippet, date, and ticker context) drawn from BOTH company-specific feeds (Finnhub) and broad thematic/geopolitical feeds (NewsData.io).

Write 3–4 sentences that:
1. Identify the SPECIFIC catalyst(s) driving this theme right now — name the event, region, company, policy, or geopolitical development (e.g. "Strait of Hormuz tensions", "OPEC supply cut", "AI capex surge", "FDA approval", "earnings beat from NVDA"). Do NOT use generic phrases like "investors are watching" or "interest in the sector".
2. State whether the news is broadly bullish, bearish, or mixed for the theme, and WHY.
3. Call out one specific thing to watch next based on the news.

CRITICAL RULES:
- ALWAYS prioritize and surface geopolitical events, macro catalysts, supply/demand shocks, and major company-specific news over routine analyst notes.
- If headlines mention specific places (Hormuz, Iran, Russia, Ukraine, China, OPEC), specific policies (tariffs, sanctions, export bans), or specific dollar amounts (billion-dollar capex, contract sizes), reference them explicitly.
- Use the article snippets/summaries — not just headlines — to ground your analysis in actual context.
- If multiple recent articles converge on the same story, treat it as the dominant narrative.
- No generic filler. Be specific and concrete.

After your summary, you MUST return a JSON block on the LAST line in this exact format:
{"sentiment": "bullish|bearish|neutral|mixed", "score": 0-100, "reasoning": "one sentence"}

Sentiment rules:
- "bullish": majority of news suggests positive catalysts, earnings beats, expansion, partnerships, regulatory wins, supply tightness (for energy/commodities)
- "bearish": majority suggests negative catalysts, misses, investigations, losing contracts, regulatory concerns, demand destruction
- "mixed": roughly equal positive and negative news
- "neutral": news is factual/informational with no clear directional bias
Score: 0 = extremely bearish, 50 = neutral, 100 = extremely bullish`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseSentiment(text: string): { narrative: string; sentiment: string | null; score: number | null; reasoning: string | null } {
  const lines = text.trim().split("\n");
  const lastLine = lines[lines.length - 1].trim();
  
  try {
    // Try parsing last line as JSON
    if (lastLine.startsWith("{") && lastLine.includes("sentiment")) {
      const parsed = JSON.parse(lastLine);
      const narrative = lines.slice(0, -1).join("\n").trim();
      return {
        narrative: narrative || text,
        sentiment: parsed.sentiment || null,
        score: typeof parsed.score === "number" ? parsed.score : null,
        reasoning: parsed.reasoning || null,
      };
    }
  } catch {}

  // Try finding JSON anywhere in the text
  const jsonMatch = text.match(/\{"sentiment"\s*:\s*"[^"]+"\s*,\s*"score"\s*:\s*\d+[^}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const narrative = text.replace(jsonMatch[0], "").trim();
      return {
        narrative,
        sentiment: parsed.sentiment || null,
        score: typeof parsed.score === "number" ? parsed.score : null,
        reasoning: parsed.reasoning || null,
      };
    } catch {}
  }

  return { narrative: text, sentiment: null, score: null, reasoning: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!hasAnyLlm()) {
      return jsonResponse({ error: "config_error", message: "No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY)" }, 500);
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON" }, 400);
    }

    const { themeName, headlines } = payload;
    if (!themeName || !headlines || headlines.length === 0) {
      return jsonResponse({ error: "bad_request", message: "Missing themeName or headlines" }, 400);
    }

    const fmtDate = (iso?: string | null) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const hrs = Math.round((Date.now() - d.getTime()) / 3_600_000);
      if (hrs < 1) return " (just now)";
      if (hrs < 48) return ` (${hrs}h ago)`;
      return ` (${Math.round(hrs / 24)}d ago)`;
    };

    const headlineText = (headlines as any[])
      .slice(0, 20)
      .map((h: any, i: number) => {
        const sym = h.symbol ? ` {${h.symbol}}` : "";
        const when = fmtDate(h.published_at);
        const snippet = h.summary ? `\n   ↳ ${String(h.summary).slice(0, 280).replace(/\s+/g, " ").trim()}` : "";
        return `${i + 1}. [${h.source || "Unknown"}${when}]${sym} ${h.headline}${snippet}`;
      })
      .join("\n");

    const userMessage = `Theme: ${themeName}\n\nRecent ranked headlines (most recent + most relevant first; geopolitical and macro context included):\n${headlineText}\n\nWrite your 3–4 sentence summary grounded in the SPECIFIC catalysts shown above (name regions, policies, events, dollar amounts), then the sentiment JSON on the last line.`;

    let response: Response;
    try {
      response = await llmFetch({
          model: "openai/gpt-oss-120b", reasoning_effort: "low",
          max_tokens: 1200,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }, { task: "long", label: "summarize-theme-news" });
    } catch (fetchErr) {
      console.error("Groq fetch error:", fetchErr);
      return jsonResponse({ error: "network_error", message: "Could not reach AI service" }, 503);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);
      if (response.status === 429) {
        return jsonResponse({ error: "rate_limit", message: "AI rate limit exceeded" }, 429);
      }
      return jsonResponse({ error: "api_error", message: `AI service error (${response.status})` }, 502);
    }

    let result: any;
    try {
      result = await response.json();
    } catch {
      return jsonResponse({ error: "parse_error", message: "Failed to parse AI response" }, 502);
    }

    const rawContent = result.choices?.[0]?.message?.content || "Unable to generate summary.";
    const { narrative, sentiment, score, reasoning } = parseSentiment(rawContent);

    return jsonResponse({
      summary: narrative,
      sentiment,
      sentimentScore: score,
      sentimentReasoning: reasoning,
      themeName,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Unhandled error in summarize-theme-news:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
