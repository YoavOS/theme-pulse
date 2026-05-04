// Groq-powered: given unassigned tickers + the user's existing curated themes
// (with their current members), propose:
//   1. NEW themes (with ≥3 unassigned tickers each)
//   2. ADDITIONS of unassigned tickers to existing curated themes
// Returns: { new_themes: [...], theme_additions: [...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an equity research assistant that organizes stocks into investable thematic groupings.

You will receive:
1. EXISTING curated themes (each with name + a sample of current member tickers).
2. UNASSIGNED stocks (ticker, company name, sector) that aren't yet in any curated theme.

Your job — do BOTH of the following:

A) Propose NEW themes that group similar unassigned stocks.
   - Each new theme MUST contain at least 3 unassigned tickers.
   - Use short narrative names (2-5 words) distinct from existing themes.
   - A ticker may appear in only ONE new theme.

B) Recommend ADDITIONS of unassigned stocks into EXISTING themes.
   - Only when a stock clearly belongs in that theme based on its business.
   - The existing theme name MUST exactly match one provided.
   - A ticker may appear in either ONE new theme OR ONE addition — never both.
   - Skip stocks that don't clearly fit anywhere.

Respond ONLY with valid JSON in this exact shape:
{
  "new_themes": [
    {"theme_name": "string", "rationale": "1 short sentence", "tickers": ["TICK1","TICK2","TICK3"]}
  ],
  "theme_additions": [
    {"existing_theme": "exact existing name", "rationale": "1 short sentence", "tickers": ["TICK4","TICK5"]}
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
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) return jsonResponse({ error: "GROQ_API_KEY not configured" }, 500);

    let payload: any;
    try { payload = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

    // Backwards compatible: existingThemes may be a string[] (names only) OR
    // an array of { name, sampleTickers? }
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

    if (unassigned.length < 3) {
      return jsonResponse({
        new_themes: [], theme_additions: [],
        suggestions: [], // legacy alias
        note: "Not enough unassigned tickers to suggest themes.",
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
      `EXISTING THEMES (name + sample tickers):\n${themesBlock}\n\n` +
      `UNASSIGNED STOCKS (ticker | company | sector):\n${tickerLines}\n\n` +
      `Now produce both new_themes and theme_additions per the rules.`;

    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 2000,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      });
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

    // Sanitize new themes
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
          tickers,
        };
      })
      .filter((s: any) =>
        s.theme_name && !themeNameSet.has(s.theme_name.toLowerCase()) && s.tickers.length >= 3
      );

    // Sanitize additions to existing themes
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
          tickers,
        };
      })
      .filter((a: any) => a && a.tickers.length >= 1);

    return jsonResponse({
      new_themes,
      theme_additions,
      suggestions: new_themes, // legacy alias for old callers
    });
  } catch (e) {
    console.error("Unhandled:", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
