import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    // Payload from the dashboard Brief panel: indexes (today's breadth), the
    // dashboard's leading/lagging groups, today's events, earnings and news.
    const {
      date = new Date().toISOString().split("T")[0],
      session = null,
      dashboard = null,
      indexes = null,
      leaders = [],
      laggards = [],
      eventsToday = [],
      earningsToday = [],
      news = [],
    } = body || {};
    const payload = { date, session, dashboard, indexes, leaders, laggards, eventsToday, earningsToday, news };

    const systemPrompt = `You are a senior momentum-trading analyst writing a short daily brief that sits in a side panel next to the trader's dashboard.
Output STRICT Markdown with exactly these four sections, each a "## " header followed by 2–4 short bullets:
## Market
- What the indexes did and how broad it was (use indexes.spy / indexes.qqq: pct = index move, up/down = members rising/falling). Say if the move is broad or narrow.
- The one or two events that matter today and when (eventsToday, times are ET).
## Rotation
- Which dashboard groups lead and which lag (leaders / laggards; pct is their move over dashboard.timeframe), and what ties them together.
## Setups
- Names worth watching: strongest stocks inside the leading groups (leaders[].top), and earnings names in a leading group (earningsToday[].inLeadingGroup). **Bold tickers.**
## Risks
- What could change the picture today: events still to come, big earnings after the close, news.
Rules:
- One line per bullet, scannable, no filler, no disclaimers, no emoji.
- Use only numbers present in the data; never invent figures. If a section has no data, write one bullet saying so.`;
    const userPrompt = `Generate today's Morning Brief using this data:\n\n${JSON.stringify(payload, null, 2)}`;

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", reasoning_effort: "low",
        temperature: 0.5,
        max_tokens: 1400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Groq error:", resp.status, t);
      return new Response(JSON.stringify({ error: `Groq error: ${resp.status}`, detail: t }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const brief = data.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ brief, generatedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("morning-brief error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
