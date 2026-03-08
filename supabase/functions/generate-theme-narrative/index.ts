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

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGeminiWithRetry(url: string, body: string, maxRetries = 3): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      lastResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (lastResponse.status === 429 && attempt < maxRetries - 1) {
        const wait = (attempt + 1) * 15000;
        console.log(`Gemini 429, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await lastResponse.text(); // consume body to avoid leak
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return lastResponse;
    } catch (fetchErr) {
      console.error(`Gemini fetch error attempt ${attempt + 1}:`, fetchErr);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 15000));
        continue;
      }
      throw fetchErr;
    }
  }
  return lastResponse!;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Top-level try/catch — every code path returns a Response, never throws
  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return jsonResponse({ error: "config_error", message: "GEMINI_API_KEY is not configured" }, 500);
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON in request body" }, 400);
    }

    const { topThemes, bottomThemes, outlierThemes, date, totalThemes, requestTimestamp } = payload;

    console.log(`Payload: top=${(topThemes||[]).length}, bottom=${(bottomThemes||[]).length}, outliers=${(outlierThemes||[]).length}, date=${date}, total=${totalThemes}, ts=${requestTimestamp}`);

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

    let response: Response;
    try {
      response = await callGeminiWithRetry(geminiUrl, geminiBody);
    } catch (fetchErr) {
      console.error("All Gemini retries failed:", fetchErr);
      return jsonResponse({ error: "network_error", message: "Could not reach AI service — try again later" }, 503);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      if (response.status === 429) {
        return jsonResponse({ error: "rate_limit", message: "AI rate limit exceeded — please wait a minute and try again" }, 429);
      }
      return jsonResponse({ error: "api_error", message: `AI service error (${response.status}) — try again later` }, 502);
    }

    let result: any;
    try {
      result = await response.json();
    } catch {
      return jsonResponse({ error: "parse_error", message: "Failed to parse AI response" }, 502);
    }

    const narrative = result.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to generate narrative.";
    console.log("Narrative generated, length:", narrative.length);

    return jsonResponse({ narrative, generatedAt: new Date().toISOString() });
  } catch (e) {
    // Final safety net — should never reach here, but guarantees no unhandled throw
    console.error("Unhandled error in generate-theme-narrative:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
