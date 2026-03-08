import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a theme filter engine for a stock market dashboard.
The user will give you a natural language query about themes.
You must respond ONLY with a JSON object in this exact format:
{
  "matchingThemes": ["Theme A", "Theme B"],
  "explanation": "One sentence explaining what you filtered for"
}
Match themes from the provided data that best fit the user's query.
Never include themes that clearly don't match.
If no themes match, return an empty matchingThemes array.
If the query is about specific theme names, match by name.
If the query is about performance characteristics, match by the data provided.`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "GROQ_API_KEY not configured" }, 500);
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const { query, themes } = payload;
    if (!query || !themes) {
      return jsonResponse({ error: "Missing query or themes" }, 400);
    }

    const themeSummary = themes.map((t: any) =>
      `${t.name} | 1D: ${t.perf_1d ?? "N/A"}% | 1W: ${t.perf_1w ?? "N/A"}% | 1M: ${t.perf_1m ?? "N/A"}% | Breadth: ${t.breadth ?? "N/A"}% | MomentumScore: ${t.score ?? "N/A"} | RelVol: ${t.avgRelVol ?? "N/A"}× | SustainedVol: ${t.sustainedVol ?? "N/A"} | VolDryUp: ${t.volumeDryUp ? "yes" : "no"} | Status: ${t.status ?? "N/A"}`
    ).join("\n");

    const userMessage = `Available themes:\n${themeSummary}\n\nUser query: "${query}"`;

    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 512,
          temperature: 0.1,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error("Groq fetch error:", fetchErr);
      return jsonResponse({ error: "network_error" }, 503);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);
      return jsonResponse({ error: "api_error", status: response.status }, 502);
    }

    let result: any;
    try {
      result = await response.json();
    } catch {
      return jsonResponse({ error: "parse_error" }, 502);
    }

    const content = result.choices?.[0]?.message?.content || "";

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let parsed: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      parsed = null;
    }

    if (parsed && Array.isArray(parsed.matchingThemes)) {
      return jsonResponse({
        matchingThemes: parsed.matchingThemes,
        explanation: parsed.explanation || "Filtered themes based on your query",
      });
    }

    return jsonResponse({ error: "invalid_ai_response", raw: content }, 502);
  } catch (e) {
    console.error("Unhandled error:", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
