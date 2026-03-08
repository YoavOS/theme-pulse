const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a market analyst summarizing news for a specific investment theme.
Given these headlines, write 2-3 sentences explaining:
1. What is the main story driving this theme today
2. Whether the news is broadly positive, negative, or mixed for the theme
3. One specific thing to watch based on the news
Be concise and specific. No generic filler.`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "config_error", message: "GROQ_API_KEY not configured" }, 500);
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

    const headlineText = (headlines as any[])
      .slice(0, 10)
      .map((h: any, i: number) => `${i + 1}. [${h.source || "Unknown"}] ${h.headline}`)
      .join("\n");

    const userMessage = `Theme: ${themeName}\n\nRecent headlines:\n${headlineText}\n\nWrite your summary.`;

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
          max_tokens: 256,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      });
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

    const summary = result.choices?.[0]?.message?.content || "Unable to generate summary.";

    return jsonResponse({
      summary,
      themeName,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Unhandled error in summarize-theme-news:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
