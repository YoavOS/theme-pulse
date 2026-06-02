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
    const {
      spy = null,
      qqq = null,
      marketDrivers = null,
      topThemes = [],
      fadingThemes = [],
      earningsToday = [],
      keySetups = [],
      volumeSurges = [],
      marketNews = [],
      breadth = null,
      concentration = null,
    } = body || {};

    const payload = {
      date: new Date().toISOString().split("T")[0],
      spy, qqq, marketDrivers, topThemes, fadingThemes,
      earningsToday, keySetups, volumeSurges, marketNews, breadth, concentration,
    };

    const systemPrompt = `You are a senior momentum-trading analyst writing a daily Morning Brief for an active trader.
Output STRICT Markdown with these EXACT section headers (use ## for each):

## 1. Market Overview
- Bullet SPY & QQQ performance (prev close + premarket if provided)
- Concentration / breadth read (was yesterday broad or narrow?)
- 2–4 key market drivers from yesterday

## 2. Earnings Today
- Major names reporting today, **bold tickers**
- Premarket reaction for big names
- Quick expected impact

## 3. Top Themes & Rotation
- Strongest themes / sectors rotating in (bold theme names)
- Themes losing strength

## 4. Key Setups to Watch
- Red Day Leaders / Market Defiers if relevant
- High-Conviction Setups (strong RS + tight range + near key EMAs)
- Biggest premarket volume surges

## 5. Morning Insight
A 4–6 sentence paragraph: market regime, key risks, biggest opportunities, any macro/news (Fed, geopolitics, sector news).

Rules:
- Tickers in **BOLD**. Use 🟢 for bullish, 🔴 for caution, 🟡 for neutral inline where useful.
- Be concise, scannable, trader-oriented. No filler. No disclaimers.
- If data is missing for a section, note "Limited data available" and infer briefly from context — do not invent specific numbers.`;

    const userPrompt = `Generate today's Morning Brief using this data:\n\n${JSON.stringify(payload, null, 2)}`;

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.5,
        max_tokens: 2200,
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
