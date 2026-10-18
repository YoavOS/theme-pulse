const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");

interface ReqBody {
  symbol: string;
  companyName?: string | null;
  sector?: string | null;
  price?: number | null;
  return1d?: number | null;
  return1w?: number | null;
  return1m?: number | null;
  rsRating?: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
    const body = (await req.json()) as ReqBody;
    if (!body?.symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx = [
      `Ticker: ${body.symbol}`,
      body.companyName ? `Company: ${body.companyName}` : null,
      body.sector ? `Sector/Industry: ${body.sector}` : null,
      body.price != null ? `Price: $${body.price.toFixed(2)}` : null,
      body.return1d != null ? `1D: ${body.return1d.toFixed(2)}%` : null,
      body.return1w != null ? `1W: ${body.return1w.toFixed(2)}%` : null,
      body.return1m != null ? `1M: ${body.return1m.toFixed(2)}%` : null,
      body.rsRating != null ? `RS Rating: ${body.rsRating}` : null,
    ].filter(Boolean).join("\n");

    const prompt = `You are an institutional equity analyst. Analyse the stock below and return STRICT JSON with this schema:
{
  "shortTerm": ["bullet 1", "bullet 2", "bullet 3"],
  "longTerm": ["bullet 1", "bullet 2", "bullet 3"],
  "outlook": "2-3 sentence balanced view including both bullish and bearish factors"
}

Rules:
- shortTerm = what's moving the stock RIGHT NOW (earnings, news, guidance, sector rotation, technicals). 3-4 concise bullets.
- longTerm = fundamental story, competitive moat, industry tailwinds/headwinds, growth runway. 3-4 concise bullets.
- outlook = balanced bull/bear synthesis with a clear stance.
- No preamble, no markdown, no code fences. JSON only.

Context:
${ctx}`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b", reasoning_effort: "low",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a concise, professional equity analyst that always replies in strict JSON." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `groq ${res.status}: ${t.slice(0, 200)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    return new Response(JSON.stringify({
      shortTerm: parsed.shortTerm ?? [],
      longTerm: parsed.longTerm ?? [],
      outlook: parsed.outlook ?? "",
      generatedAt: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
