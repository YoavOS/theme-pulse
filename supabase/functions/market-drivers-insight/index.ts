// Generates a one-paragraph commentary about today's index drivers using Lovable AI Gateway.
// POST { index: "QQQ"|"SPY", indexPct: number, top: Array<{symbol,name,weightedContribution,pctChange}>, top5Pct: number }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!hasAnyLlm()) return jsonResponse({ error: "No AI provider configured (set GEMINI_API_KEY or GROQ_API_KEY)", commentary: null }, 500);

    const body = await req.json().catch(() => ({})) as {
      index?: string;
      indexPct?: number | null;
      top?: Array<{ symbol: string; name: string; weightedContribution: number | null; pctChange: number | null }>;
      top5Pct?: number | null;
      timeframe?: string;
    };
    const index = (body.index || "QQQ").toUpperCase();
    const indexPct = body.indexPct;
    const top = (body.top || []).slice(0, 8);
    const top5Pct = body.top5Pct;
    const timeframe = body.timeframe || "today";

    if (top.length === 0) return jsonResponse({ commentary: "No driver data available." });

    const prompt = `You are a concise market analyst. Write ONE short paragraph (max 3 sentences) commenting on what is driving the ${index} ${timeframe === "today" ? "today" : `over the last ${timeframe}`}.
Index move: ${indexPct === null || indexPct === undefined ? "unknown" : indexPct.toFixed(2) + "%"}.
Top contributors (weight × % change, in % points of index): ${top.map((r) => `${r.symbol} ${r.weightedContribution !== null && r.weightedContribution !== undefined ? r.weightedContribution.toFixed(3) + "pp" : "n/a"} (stock ${r.pctChange !== null && r.pctChange !== undefined ? r.pctChange.toFixed(2) + "%" : "n/a"})`).join(", ")}.
Top-5 share of total absolute contribution: ${top5Pct !== null && top5Pct !== undefined ? top5Pct + "%" : "n/a"}.
Highlight whether the move is broad or concentrated, name the 1-2 biggest drivers, and call out any notable divergence (e.g. one mega-cap dragging while breadth is positive). No emojis. No disclaimers.`;

    const aiResp = await llmFetch({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a precise, terse equity-market commentator." },
          { role: "user", content: prompt },
        ],
      }, { task: "grounded", label: "market-drivers-insight" });
    if (!aiResp.ok) {
      const txt = await aiResp.text().catch(() => "");
      return jsonResponse({ error: `AI gateway ${aiResp.status}`, detail: txt.slice(0, 200), commentary: null }, 200);
    }
    const data = await aiResp.json().catch(() => null);
    const commentary = data?.choices?.[0]?.message?.content?.trim() ?? null;
    return jsonResponse({ commentary });
  } catch (e) {
    console.error("market-drivers-insight error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e), commentary: null }, 500);
  }
});
