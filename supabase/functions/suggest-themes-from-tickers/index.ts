// Groq-powered: given unassigned tickers + the user's existing curated themes
// (with their current members), propose:
//   1. Stocks to ADD to existing curated themes (FIRST PRIORITY)
//   2. NEW tightly-cohesive themes (≥5 unassigned tickers each, with cohesion score)
// Each suggestion includes a self-evaluated cohesion score (1-10).
// Returns: { new_themes: [...], theme_additions: [...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an elite equity research analyst grouping stocks into HIGHLY SPECIFIC, TRADABLE thematic baskets.

You will receive:
1. EXISTING curated themes (each with name + current member tickers).
2. UNASSIGNED stocks (ticker, company, sector) not yet in any curated theme.

Follow this process IN ORDER:

STEP 1 — FIRST PRIORITY: Try to fit each unassigned stock into an EXISTING curated theme.
   • Use exact theme name matches.
   • Only suggest a fit when the stock's core business clearly belongs in that theme (sub-industry, catalyst, business model).
   • Skip stocks that don't truly fit anywhere.

STEP 2 — Group remaining unassigned stocks into NEW themes only when justified:
   • Theme names must be SPECIFIC and TRADABLE — e.g. "AI Data Center Cooling", "GLP-1 Obesity Drugs", "Power Electronics & Grid Components".
   • REJECT generic names like "Technology", "Industrials", "Healthcare", "Growth Stocks".
   • Each new theme MUST contain ≥ 5 unassigned tickers with strong internal similarity (sub-industry, catalyst, business model, revenue driver).

STEP 3 — COHESION SELF-CHECK: For every group you propose (new themes AND additions), evaluate cohesion 1-10:
   • 9-10 = nearly identical business / catalyst (e.g. all GPU foundries, all GLP-1 manufacturers)
   • 7-8 = same sub-industry, very tight
   • 5-6 = related but mixed — usually NOT acceptable
   • <5 = too broad, REJECT
   ONLY include suggestions where cohesion ≥ 7. If a group scores below 7, either split it into tighter sub-themes or move tickers to additions.

STEP 4 — Each suggestion needs a SHORT justification (1 sentence) explaining the shared catalyst/business.

A ticker may appear in only ONE place (one new theme OR one addition). Skip tickers that don't fit anywhere with high cohesion.

Respond ONLY with valid JSON in this exact shape:
{
  "new_themes": [
    {"theme_name": "string", "rationale": "1 sentence", "cohesion_score": 9, "tickers": ["TICK1","TICK2","TICK3","TICK4","TICK5"]}
  ],
  "theme_additions": [
    {"existing_theme": "exact existing name", "rationale": "1 sentence", "cohesion_score": 8, "tickers": ["TICK6","TICK7"]}
  ]
}`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasAnyLlm()) return jsonResponse({ error: "No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY)" }, 500);

    let payload: any;
    try { payload = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

    const rawThemes = Array.isArray(payload?.existingThemes) ? payload.existingThemes : [];
    const existingThemes: { name: string; sampleTickers: string[] }[] = rawThemes.map((t: any) => {
      if (typeof t === "string") return { name: t, sampleTickers: [] };
      return {
        name: String(t?.name ?? "").trim(),
        sampleTickers: Array.isArray(t?.sampleTickers)
          ? t.sampleTickers.map((s: any) => String(s).toUpperCase()).slice(0, 12)
          : [],
      };
    }).filter((t: any) => t.name);

    const unassigned: { symbol: string; company?: string | null; sector?: string | null }[] =
      Array.isArray(payload?.unassigned) ? payload.unassigned : [];

    if (unassigned.length < 5) {
      return jsonResponse({
        new_themes: [], theme_additions: [], suggestions: [],
        note: "Not enough unassigned tickers (need ≥5) to propose themes.",
      });
    }

    const capped = unassigned.slice(0, 200);
    const tickerLines = capped
      .map(t => `${t.symbol} | ${t.company ?? "—"} | ${t.sector ?? "—"}`)
      .join("\n");

    const themesBlock = existingThemes.length
      ? existingThemes.map(t =>
          t.sampleTickers.length
            ? `- ${t.name} [${t.sampleTickers.join(", ")}]`
            : `- ${t.name}`
        ).join("\n")
      : "(none)";

    const userMessage =
      `EXISTING CURATED THEMES (name + current members — first try to fit unassigned stocks here):\n${themesBlock}\n\n` +
      `UNASSIGNED STOCKS (ticker | company | sector):\n${tickerLines}\n\n` +
      `Apply the 4-step process. Remember: additions FIRST, then new themes only with cohesion ≥ 7 and ≥ 5 tickers each.`;

    let response: Response;
    try {
      response = await llmFetch({
          model: "openai/gpt-oss-120b", reasoning_effort: "low",
          max_tokens: 3200,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }, { task: "long", label: "suggest-themes-from-tickers" });
    } catch (e) {
      console.error("Groq fetch error:", e);
      return jsonResponse({ error: "network_error" }, 503);
    }

    if (!response.ok) {
      const text = await response.text();
      console.error("Groq API error:", response.status, text);
      return jsonResponse({ error: "api_error", status: response.status }, 502);
    }

    const result = await response.json().catch(() => null);
    const content = result?.choices?.[0]?.message?.content || "";

    let parsed: any;
    try {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch { parsed = null; }

    if (!parsed) {
      return jsonResponse({ error: "invalid_ai_response", raw: content }, 502);
    }

    const allowed = new Set(capped.map(t => t.symbol.toUpperCase()));
    const themeNameSet = new Set(existingThemes.map(t => t.name.toLowerCase()));
    const seen = new Set<string>();

    const clampScore = (n: any): number => {
      const v = Number(n);
      if (!Number.isFinite(v)) return 7;
      return Math.max(1, Math.min(10, Math.round(v)));
    };

    // Sanitize new themes — strict gates: cohesion ≥7 AND ≥5 tickers
    const rawNew = Array.isArray(parsed.new_themes)
      ? parsed.new_themes
      : (Array.isArray(parsed.suggestions) ? parsed.suggestions : []);
    const new_themes = rawNew
      .map((s: any) => {
        const tickers = (Array.isArray(s?.tickers) ? s.tickers : [])
          .map((t: string) => String(t || "").toUpperCase().trim())
          .filter((t: string) => allowed.has(t) && !seen.has(t));
        tickers.forEach((t: string) => seen.add(t));
        return {
          theme_name: String(s?.theme_name || "").trim(),
          rationale: String(s?.rationale || "").trim(),
          cohesion_score: clampScore(s?.cohesion_score),
          tickers,
        };
      })
      .filter((s: any) =>
        s.theme_name &&
        !themeNameSet.has(s.theme_name.toLowerCase()) &&
        s.tickers.length >= 5 &&
        s.cohesion_score >= 7
      );

    // Sanitize additions — cohesion ≥7
    const rawAdds = Array.isArray(parsed.theme_additions) ? parsed.theme_additions : [];
    const theme_additions = rawAdds
      .map((a: any) => {
        const name = String(a?.existing_theme || "").trim();
        const matchedTheme = existingThemes.find(
          t => t.name.toLowerCase() === name.toLowerCase()
        );
        if (!matchedTheme) return null;
        const existingMembers = new Set(matchedTheme.sampleTickers);
        const tickers = (Array.isArray(a?.tickers) ? a.tickers : [])
          .map((t: string) => String(t || "").toUpperCase().trim())
          .filter((t: string) =>
            allowed.has(t) && !seen.has(t) && !existingMembers.has(t)
          );
        tickers.forEach((t: string) => seen.add(t));
        return {
          existing_theme: matchedTheme.name,
          rationale: String(a?.rationale || "").trim(),
          cohesion_score: clampScore(a?.cohesion_score),
          tickers,
        };
      })
      .filter((a: any) => a && a.tickers.length >= 1 && a.cohesion_score >= 7);

    return jsonResponse({
      new_themes,
      theme_additions,
      suggestions: new_themes,
    });
  } catch (e) {
    console.error("Unhandled:", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
