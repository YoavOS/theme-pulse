// Groq-powered concise summary + key signal for a theme's current strength profile.
import { corsHeaders } from "../_shared/cors.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GROQ_API_KEY) return json({ error: "GROQ_API_KEY not configured" }, 500);
    const body = await req.json().catch(() => ({}));
    const {
      themeName = "Unknown Theme",
      perfPct = 0,
      breadthPct = 0,
      breadthLabel = "",
      rs = {},
      acceleration = "",
      relVol = null,
      sustainedVol = null,
      topMovers = [],
    } = body || {};

    const rsStr = ["rs_1d", "rs_1w", "rs_1m", "rs_3m", "rs_6m"]
      .map((k) => `${k}=${rs?.[k] ?? "n/a"}`).join(", ");
    const moversStr = (topMovers || []).slice(0, 5)
      .map((m: any) => `${m.symbol} ${m.pct >= 0 ? "+" : ""}${Number(m.pct).toFixed(2)}%`).join(", ");

    const userPrompt = `Theme: ${themeName}
Today's performance: ${perfPct >= 0 ? "+" : ""}${Number(perfPct).toFixed(2)}%
Breadth: ${breadthPct}% (${breadthLabel})
RS ratings (0-99): ${rsStr}
Acceleration profile: ${acceleration}
Avg Rel Vol: ${relVol ?? "n/a"}
Sustained Vol: ${sustainedVol ?? "n/a"}%
Top movers today: ${moversStr}`;

    const systemPrompt = `You are a senior equities analyst. Reply in STRICT JSON only:
{
  "summary": "2-3 sentence trader-focused read on this theme's current strength, drivers and posture. Reference RS trend, breadth quality, and volume tone.",
  "key_signal": "One of: Strong Volume Surge | Momentum Building | Broad Rotation | Selective Leadership | Possible Exhaustion | Fading | Consolidating | Recovering"
}
No disclaimers. Be specific, tight, and directional.`;

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", reasoning_effort: "low",
        temperature: 0.3,
        max_tokens: 1020,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Groq error", resp.status, t.slice(0, 200));
      return json({ error: `Groq ${resp.status}` }, 500);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch {}
    return json({
      summary: parsed.summary || "",
      key_signal: parsed.key_signal || "Consolidating",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("theme-strength-summary error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
