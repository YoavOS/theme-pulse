import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a professional market analyst specializing in thematic investing and sector rotation.
You write sharp, honest, institutional-quality market analysis.
You have access to both theme-level and ticker-level performance data, including volume signals.

CRITICAL RULES:
- If a theme's move is driven by 1-2 outlier tickers while the majority are flat or down, flag it explicitly as a single-stock move, not a theme rotation
- Only call a theme "leading" or "in rotation" if the majority of its tickers are advancing (breadth confirms)
- If breadth is low (e.g. 1/5 or 2/5 advancing) despite a positive theme average, flag this as a warning
- Be specific — always name the tickers driving moves and the tickers diverging
- Never use generic filler language like "investors are showing interest" or "market participants are watching"
- If the data shows contradictions, say so directly

VOLUME RULES:
- When a theme shows Rel Vol > 1.8× alongside strong price performance, call it out explicitly as "unusual volume confirming the move"
- When a theme shows high volume (Rel Vol > 1.4×) but negative performance, flag it as "distribution" or "institutional selling"
- When a theme shows strong price performance but Rel Vol < 0.8×, flag it as a "low conviction move"
- Always mention volume when it adds meaningful context to the narrative — don't mention it for every theme, only when it signals something actionable
- Sustained Vol (10-day vs 3-month average) above +20% indicates multi-day accumulation building
- If a theme shows volumeDryUp = true, mention it explicitly as a caution signal — fading volume after a run often precedes a price reversal

DISPERSION RULES:
- If dispersion is >2.5, mention it's a high-conviction rotation day with clear winners and losers — a stock picker's market
- If dispersion is <0.5, mention themes are moving in lockstep suggesting macro-driven action rather than stock-specific rotation
- Only mention dispersion if the data includes it and it adds meaningful context

RELATIVE STRENGTH RULES:
- Always contextualize theme performance relative to SPY when SPY data is provided
- A theme up 1% when SPY is up 2% is underperforming — call it out
- A theme up 1% when SPY is down 0.5% is showing real strength — highlight this
- Use relative strength language when it adds meaningful context, don't force it on every theme

NEWS CONTEXT RULES:
- When recent headlines are provided for top themes, use them to explain WHY themes are moving, not just that they are moving
- If a headline directly explains a theme's performance (e.g. a defense contract announcement for the Defense theme), reference it specifically
- Do not fabricate or assume news — only reference headlines actually provided in the data

FORMAT:
Write 6–8 sentences of flowing prose. No bullet points. No headers. No lists.
Cover: what is genuinely leading with broad confirmation, what is a single-stock story masquerading as a theme move, what is fading and why, what the overall rotation suggests, and one specific actionable thing to watch next session.`;

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
      return jsonResponse({ error: "config_error", message: "GROQ_API_KEY is not configured" }, 500);
    }

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON in request body" }, 400);
    }

    const { topThemes, bottomThemes, outlierThemes, date, totalThemes, requestTimestamp, dispersionScore, dispersionLabel, spyPerf1d, spyPerf1w, spyPerf1m, topThemeHeadlines } = payload;

    console.log(`Payload: top=${(topThemes||[]).length}, bottom=${(bottomThemes||[]).length}, outliers=${(outlierThemes||[]).length}, date=${date}, total=${totalThemes}, ts=${requestTimestamp}`);

    const formatTheme = (t: any) => {
      const tickerStr = (t.tickers || [])
        .map((tk: any) => `${tk.symbol}: ${tk.perf_1d >= 0 ? "+" : ""}${tk.perf_1d}%`)
        .join(", ");
      
      // Volume info
      const volParts: string[] = [];
      if (t.avgRelVol !== null && t.avgRelVol !== undefined) {
        volParts.push(`Rel Vol: ${t.avgRelVol.toFixed(1)}×`);
      }
      if (t.sustainedVol) {
        volParts.push(`Sustained: ${t.sustainedVol}`);
      }
      if (t.volumeSpike) {
        volParts.push(`Spike: ${t.volumeSpike}`);
      }
      const volStr = volParts.length > 0 ? ` | Volume: ${volParts.join(", ")}` : "";
      const dryUpStr = t.volumeDryUp ? " | ⚠ VOLUME DRY-UP (sustained vol change: " + (t.sustainedVolChange ?? "N/A") + ")" : "";

      return `${t.name} | Score: ${t.score} | 1D: ${t.perf_1d >= 0 ? "+" : ""}${t.perf_1d}% | 1W: ${t.perf_1w >= 0 ? "+" : ""}${t.perf_1w}% | 1M: ${t.perf_1m >= 0 ? "+" : ""}${t.perf_1m}% | Breadth: ${t.breadth} (${t.advancing} up, ${t.declining} down)${volStr}${dryUpStr}\n  Tickers: ${tickerStr}`;
    };

    const topLines = (topThemes || []).map(formatTheme).join("\n\n");
    const bottomLines = (bottomThemes || []).map(formatTheme).join("\n\n");
    const outlierLines = (outlierThemes || []).length > 0
      ? (outlierThemes || []).map(formatTheme).join("\n\n")
      : "None identified";

    const dispersionLine = dispersionScore != null ? `\nDISPERSION: ${dispersionScore.toFixed(2)}σ — ${dispersionLabel || "N/A"}` : "";
    const spyLine = spyPerf1d != null ? `\nSPY BENCHMARK: 1D: ${spyPerf1d >= 0 ? "+" : ""}${spyPerf1d}% | 1W: ${spyPerf1w != null ? (spyPerf1w >= 0 ? "+" : "") + spyPerf1w + "%" : "N/A"} | 1M: ${spyPerf1m != null ? (spyPerf1m >= 0 ? "+" : "") + spyPerf1m + "%" : "N/A"}` : "";

    // Headlines context
    const headlinesSection = topThemeHeadlines && (topThemeHeadlines as any[]).length > 0
      ? `\n\nRECENT HEADLINES FOR TOP THEMES:\n${(topThemeHeadlines as any[]).map((h: any) => `- [${h.theme}] ${h.headline} (${h.source || "Unknown"})`).join("\n")}`
      : "";

    const userMessage = `Date: ${date} | Themes analyzed: ${totalThemes} | Request ID: ${requestTimestamp}
${dispersionLine}${spyLine}
TOP 8 THEMES (strongest momentum):
${topLines}

BOTTOM 8 THEMES (weakest momentum):
${bottomLines}

SINGLE-STOCK OUTLIER THEMES (one ticker >5% while theme avg <1%):
${outlierLines}
${headlinesSection}

Write a complete market analysis following your instructions.`;

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
          max_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error("Groq fetch error:", fetchErr);
      return jsonResponse({ error: "network_error", message: "Could not reach AI service — try again later" }, 503);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);
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

    const narrative = result.choices?.[0]?.message?.content || "Unable to generate narrative.";
    console.log("Narrative generated, length:", narrative.length);

    return jsonResponse({ narrative, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("Unhandled error in generate-theme-narrative:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
