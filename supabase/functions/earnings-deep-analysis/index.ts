// AI Earnings Deep Analysis: short-term catalyst + long-term drivers + trader takeaway
// POST { symbol, company?, sector?, gapPct?, epsSurprisePct?, revenueSurprisePct?, reportDate?, reportTime? }
// Returns { shortTerm: string, longTerm: string, takeaway: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Body {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  gapPct?: number | null;
  epsSurprisePct?: number | null;
  revenueSurprisePct?: number | null;
  reportDate?: string | null;
  reportTime?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const GROQ = Deno.env.get("GROQ_API_KEY");
    if (!GROQ) return jsonResponse({ error: "GROQ_API_KEY missing" }, 500);

    const body = (await req.json().catch(() => ({}))) as Body;
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbol) return jsonResponse({ error: "symbol required" }, 400);

    const facts: string[] = [`Ticker: ${symbol}`];
    if (body.company) facts.push(`Company: ${body.company}`);
    if (body.sector) facts.push(`Sector: ${body.sector}`);
    if (body.reportDate) facts.push(`Report date: ${body.reportDate}${body.reportTime ? ` (${body.reportTime})` : ""}`);
    if (body.gapPct !== null && body.gapPct !== undefined) facts.push(`Post-earnings gap: ${body.gapPct >= 0 ? "+" : ""}${body.gapPct.toFixed(1)}%`);
    if (body.epsSurprisePct !== null && body.epsSurprisePct !== undefined) facts.push(`EPS surprise: ${body.epsSurprisePct >= 0 ? "+" : ""}${body.epsSurprisePct.toFixed(1)}%`);
    if (body.revenueSurprisePct !== null && body.revenueSurprisePct !== undefined) facts.push(`Revenue surprise: ${body.revenueSurprisePct >= 0 ? "+" : ""}${body.revenueSurprisePct.toFixed(1)}%`);

    const prompt = `You are a sharp equity research analyst writing a trader-focused earnings briefing.

Facts:
${facts.join("\n")}

Return STRICT JSON (no markdown, no code fences) with EXACTLY these three keys, each a concise paragraph (3-5 sentences each, ~80-110 words):

{
  "shortTerm": "Short-Term Catalyst — explain the immediate reaction. Cover EPS/revenue beat or miss size, guidance tone if known, and the 1-2 most plausible drivers behind the move (surprise size, raised guidance, new contract, product launch, sector tailwind). Be specific to ${symbol} and its sector. Don't invent press releases.",
  "longTerm": "Long-Term Drivers — strategic view. What secular tailwinds or competitive advantages drive this company over multi-year horizons? Mention market opportunity, product cycle, moat, industry trends. Note any structural risks (regulation, competition, valuation). Be balanced.",
  "takeaway": "Trader Takeaway — actionable summary in 2-3 sentences. Is the move likely sustainable? Is the stock in a strong theme right now? Any red flags traders should watch (extension, valuation, weak guidance, single-quarter spike)?"
}

No emojis. No disclaimers. Output ONLY the JSON object.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 900,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise, candid equity research analyst. Return strict JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return jsonResponse({ error: `Groq ${res.status}`, detail: txt.slice(0, 300) }, 200);
    }
    const j = await res.json().catch(() => null);
    const content = j?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: { shortTerm?: string; longTerm?: string; takeaway?: string } = {};
    try { parsed = JSON.parse(content); } catch {
      // try to extract JSON
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* noop */ } }
    }
    return jsonResponse({
      symbol,
      shortTerm: parsed.shortTerm ?? "Analysis unavailable.",
      longTerm: parsed.longTerm ?? "Analysis unavailable.",
      takeaway: parsed.takeaway ?? "Analysis unavailable.",
    });
  } catch (e) {
    console.error("earnings-deep-analysis error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
