import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a professional market analyst specializing in thematic investing and sector rotation.
You write concise, sharp, institutional-quality market narratives.
Respond in exactly 4 sentences. No bullet points. No headers. Plain prose only.
Sentence 1: What is leading and why it matters.
Sentence 2: What is fading and what it signals.
Sentence 3: What the rotation between themes suggests about the broader market.
Sentence 4: One specific thing to watch going into the next session.
Be specific — use the actual theme names provided. Do not use generic filler language.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { topThemes, bottomThemes, accelerating, fading, date, totalThemes } = await req.json();

    const topStr = (topThemes || [])
      .map((t: any) => `${t.name} (Score: ${t.score}, 1D: ${t.perf_1d >= 0 ? "+" : ""}${t.perf_1d}%, 1W: ${t.perf_1w >= 0 ? "+" : ""}${t.perf_1w}%)`)
      .join(", ");

    const bottomStr = (bottomThemes || [])
      .map((t: any) => `${t.name} (Score: ${t.score}, 1D: ${t.perf_1d >= 0 ? "+" : ""}${t.perf_1d}%, 1W: ${t.perf_1w >= 0 ? "+" : ""}${t.perf_1w}%)`)
      .join(", ");

    const userMessage = `Date: ${date}
Leading themes: ${topStr}
Fading themes: ${bottomStr}
Accelerating (short-term > long-term): ${(accelerating || []).join(", ")}
Fading (short-term < long-term): ${(fading || []).join(", ")}
Total themes analyzed: ${totalThemes}
Write the market narrative.`;

    // Direct Gemini API call — to switch back to Anthropic, replace this block
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: { maxOutputTokens: 512 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const narrative =
      result.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to generate narrative.";

    return new Response(
      JSON.stringify({ narrative, generatedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-theme-narrative error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
