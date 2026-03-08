import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a professional market analyst specializing in thematic investing and sector rotation.
You write sharp, honest, institutional-quality market analysis.
You have access to both theme-level and ticker-level performance data.

CRITICAL RULES:
- If a theme's move is driven by 1-2 outlier tickers while the majority are flat or down, flag it explicitly as a single-stock move, not a theme rotation
- Only call a theme "leading" or "in rotation" if the majority of its tickers are advancing (breadth confirms)
- If breadth is low (e.g. 1/5 or 2/5 advancing) despite a positive theme average, flag this as a warning
- Be specific — always name the tickers driving moves and the tickers diverging
- Never use generic filler language like "investors are showing interest" or "market participants are watching"
- If the data shows contradictions, say so directly

FORMAT:
Write 6–8 sentences of flowing prose. No bullet points. No headers. No lists.
Cover: what is genuinely leading with broad confirmation, what is a single-stock story masquerading as a theme move, what is fading and why, what the overall rotation suggests, and one specific actionable thing to watch next session.`;

async function callGeminiWithRetry(url: string, body: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (response.status === 429 && attempt < maxRetries - 1) {
      const wait = (attempt + 1) * 15000; // 15s, 30s, 45s
      console.log(`Gemini 429 rate limit, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await response.text();
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return response;
  }
  throw new Error("Max retries exceeded");
}

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

    const { topThemes, bottomThemes, outlierThemes, date, totalThemes, requestTimestamp } = await req.json();

    console.log(`Received payload: top=${(topThemes||[]).length}, bottom=${(bottomThemes||[]).length}, outliers=${(outlierThemes||[]).length}, date=${date}, total=${totalThemes}, ts=${requestTimestamp}`);

    // Format theme block
    const formatTheme = (t: any) => {
      const tickerStr = (t.tickers || [])
        .map((tk: any) => `${tk.symbol}: ${tk.perf_1d >= 0 ? "+" : ""}${tk.perf_1d}%`)
        .join(", ");
      return `${t.name} | Score: ${t.score} | 1D: ${t.perf_1d >= 0 ? "+" : ""}${t.perf_1d}% | 1W: ${t.perf_1w >= 0 ? "+" : ""}${t.perf_1w}% | 1M: ${t.perf_1m >= 0 ? "+" : ""}${t.perf_1m}% | Breadth: ${t.breadth} (${t.advancing} up, ${t.declining} down)\n  Tickers: ${tickerStr}`;
    };

    const topLines = (topThemes || []).map(formatTheme).join("\n\n");
    const bottomLines = (bottomThemes || []).map(formatTheme).join("\n\n");
    const outlierLines = (outlierThemes || []).length > 0
      ? (outlierThemes || []).map(formatTheme).join("\n\n")
      : "None identified";

    const userMessage = `Date: ${date} | Themes analyzed: ${totalThemes} | Request ID: ${requestTimestamp}

TOP 8 THEMES (strongest momentum):
${topLines}

BOTTOM 8 THEMES (weakest momentum):
${bottomLines}

SINGLE-STOCK OUTLIER THEMES (one ticker >5% while theme avg <1%):
${outlierLines}

Write a complete market analysis following your instructions.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const geminiBody = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 1024 },
    });

    const response = await callGeminiWithRetry(geminiUrl, geminiBody);

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      const userMsg = response.status === 429
        ? "AI rate limit exceeded — please wait a minute and try again"
        : `Gemini API error: ${response.status}`;
      return new Response(
        JSON.stringify({ error: userMsg }),
        { status: response.status === 429 ? 429 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const narrative =
      result.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to generate narrative.";

    console.log("Narrative generated successfully, length:", narrative.length);

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
