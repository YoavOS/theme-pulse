// Classify the most likely catalyst behind a theme's volume surge.
// Uses Lovable AI Gateway (no user key needed) with a small fast model.
// Pulls recent news via the existing fetch-theme-news edge function (which is
// already cached ~45min), so this function adds ~0 extra news cost on hot themes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CATALYST_LABELS = [
  "Earnings Season",
  "News-Driven Surge",
  "Sector Rotation",
  "Short Squeeze",
  "Breakout Momentum",
  "Macro Catalyst",
] as const;

interface Body {
  themeId: string;
  themeName: string;
  symbols: string[];
  avgPerf1d?: number | null;
  avgRelVol?: number | null;
  sustained?: number | null;
  trendPct?: number | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.themeName || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return json({ error: "themeName and symbols required" }, 400);
    }
    if (!LOVABLE_API_KEY) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    // Pull cached news for up to 6 representative symbols.
    let headlines: string[] = [];
    try {
      const newsRes = await fetch(`${SUPABASE_URL}/functions/v1/fetch-theme-news`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ symbols: body.symbols.slice(0, 6), categories: [] }),
      });
      if (newsRes.ok) {
        const data = await newsRes.json();
        const bySymbol = data?.bySymbol || {};
        const seen = new Set<string>();
        for (const sym of Object.keys(bySymbol)) {
          for (const a of (bySymbol[sym] || []).slice(0, 3)) {
            const h = String(a.headline || "").trim();
            if (h && !seen.has(h)) { seen.add(h); headlines.push(h); }
            if (headlines.length >= 10) break;
          }
          if (headlines.length >= 10) break;
        }
      }
    } catch (_e) { /* news is optional */ }

    const stats = [
      body.avgPerf1d != null ? `Avg 1D perf: ${body.avgPerf1d.toFixed(2)}%` : null,
      body.avgRelVol != null ? `Avg Rel Vol: ${body.avgRelVol.toFixed(2)}x` : null,
      body.sustained != null ? `Sustained: ${body.sustained.toFixed(2)}` : null,
      body.trendPct != null ? `Vol Trend: ${body.trendPct.toFixed(1)}%` : null,
    ].filter(Boolean).join(" · ");

    const system = `You are a market analyst. Classify the most likely catalyst behind a theme's elevated volume.
You MUST choose exactly one label from this set: ${CATALYST_LABELS.join(", ")}.
Return strict JSON: {"catalyst":"<label>","reason":"<one short sentence, <=18 words>"}.
No prose outside JSON.`;

    const user = `Theme: ${body.themeName}
Symbols (sample): ${body.symbols.slice(0, 10).join(", ")}
Stats: ${stats || "n/a"}
Recent headlines:
${headlines.length ? headlines.map(h => `- ${h}`).join("\n") : "(no recent headlines)"}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: `AI gateway ${aiRes.status}: ${txt.slice(0, 200)}` }, aiRes.status === 402 || aiRes.status === 429 ? aiRes.status : 502);
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content || "{}";
    let parsed: { catalyst?: string; reason?: string } = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    const label = CATALYST_LABELS.find(l => l.toLowerCase() === String(parsed.catalyst || "").toLowerCase())
      || "Breakout Momentum";
    const reason = String(parsed.reason || "").slice(0, 200);

    return json({
      catalyst: label,
      reason,
      hadHeadlines: headlines.length > 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
