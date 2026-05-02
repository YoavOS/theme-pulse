// Groq-powered: given a list of unassigned tickers (with company name + sector)
// and the user's existing curated theme names, propose 2-6 NEW logical themes
// grouping similar stocks. Returns JSON {suggestions: [{theme_name, rationale, tickers[]}]}.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an equity research assistant that discovers investable thematic groupings.
You will receive:
1. A list of EXISTING curated themes (avoid duplicating these).
2. A list of UNASSIGNED stocks (ticker, company name, sector).

Task: Propose 2 to 6 NEW themes that group these unassigned stocks in coherent, INVESTABLE ways.
Rules:
- Every suggested theme MUST contain at least 3 tickers from the provided list.
- A ticker may appear in only ONE suggested theme (no overlaps).
- Prefer narrative/secular themes (e.g. "Obesity / GLP-1 Drugs", "Edge AI Inference", "Nuclear SMR Suppliers") over generic sector buckets.
- Theme names must be short (2-5 words), distinct from existing themes.
- It is fine to leave some tickers unassigned if no coherent group emerges.

Respond ONLY with valid JSON in this exact shape:
{
  "suggestions": [
    {
      "theme_name": "string",
      "rationale": "1 short sentence explaining the thesis",
      "tickers": ["TICK1", "TICK2", "TICK3"]
    }
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

    const existingThemes: string[] = Array.isArray(payload?.existingThemes) ? payload.existingThemes : [];
    const unassigned: { symbol: string; company?: string | null; sector?: string | null }[] =
      Array.isArray(payload?.unassigned) ? payload.unassigned : [];

    if (unassigned.length < 3) {
      return jsonResponse({ suggestions: [], note: "Not enough unassigned tickers to suggest themes." });
    }

    // Cap input size for Groq context
    const capped = unassigned.slice(0, 200);
    const tickerLines = capped
      .map(t => `${t.symbol} | ${t.company ?? "—"} | ${t.sector ?? "—"}`)
      .join("\n");

    const userMessage =
      `EXISTING THEMES (avoid duplicating):\n${existingThemes.join(", ") || "(none)"}\n\n` +
      `UNASSIGNED STOCKS (ticker | company | sector):\n${tickerLines}\n\n` +
      `Now propose new themes following the rules.`;

    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1500,
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

    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return jsonResponse({ error: "invalid_ai_response", raw: content }, 502);
    }

    // Sanitize: keep only tickers that were actually in the unassigned list, dedupe across themes
    const allowed = new Set(capped.map(t => t.symbol.toUpperCase()));
    const seen = new Set<string>();
    const cleaned = parsed.suggestions
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
      .filter((s: any) => s.theme_name && s.tickers.length >= 3);

    return jsonResponse({ suggestions: cleaned });
  } catch (e) {
    console.error("Unhandled:", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
