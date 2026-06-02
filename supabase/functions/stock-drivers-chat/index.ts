const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");

interface ChatMsg { role: "user" | "assistant"; content: string }
interface ReqBody {
  symbol: string;
  companyName?: string | null;
  sector?: string | null;
  price?: number | null;
  return1d?: number | null;
  return1w?: number | null;
  return1m?: number | null;
  rsRating?: number | null;
  messages: ChatMsg[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
    const body = (await req.json()) as ReqBody;
    if (!body?.symbol || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "symbol and messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx = [
      `Ticker: ${body.symbol}`,
      body.companyName ? `Company: ${body.companyName}` : null,
      body.sector ? `Sector/Industry: ${body.sector}` : null,
      body.price != null ? `Price: $${Number(body.price).toFixed(2)}` : null,
      body.return1d != null ? `1D: ${Number(body.return1d).toFixed(2)}%` : null,
      body.return1w != null ? `1W: ${Number(body.return1w).toFixed(2)}%` : null,
      body.return1m != null ? `1M: ${Number(body.return1m).toFixed(2)}%` : null,
      body.rsRating != null ? `RS Rating: ${body.rsRating}` : null,
    ].filter(Boolean).join("\n");

    const system = `You are a sharp, concise institutional equity analyst answering follow-up questions about a single stock. Stay focused on this ticker. Use plain markdown (short paragraphs and bullet points). No code fences. Be specific and balanced — call out both bullish and bearish factors. Keep responses under ~200 words unless explicitly asked for depth.\n\nStock context:\n${ctx}`;

    const trimmed = body.messages.slice(-12); // keep last 12 turns
    const messages = [
      { role: "system", content: system },
      ...trimmed.map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) })),
    ];

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        messages,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `groq ${res.status}: ${t.slice(0, 200)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
