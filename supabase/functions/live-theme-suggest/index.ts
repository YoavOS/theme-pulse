// Suggest a theme name + peer tickers for a stock using Lovable AI when the
// qualified RS universe doesn't already contain enough peers. Then fetches
// a live Yahoo quote + simple % returns for each suggested peer so the UI
// can render the same row format as universe peers.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface PeerQuote {
  symbol: string;
  shortName: string | null;
  price: number | null;
  changePct: number | null;   // 1D
  return1m: number | null;
}

async function fetchQuoteAndHistory(symbol: string): Promise<PeerQuote | null> {
  // Single Yahoo chart call covering 1mo of data (gives us today + 1M return).
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((v: any) => typeof v === "number");
    const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const first1m = closes[0] ?? null;
    const changePct = price !== null && prevClose && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100 : null;
    const return1m = price !== null && first1m && first1m > 0
      ? ((price - first1m) / first1m) * 100 : null;
    return {
      symbol,
      shortName: meta.shortName ?? meta.longName ?? null,
      price,
      changePct,
      return1m,
    };
  } catch {
    return null;
  }
}

async function suggestPeersWithAI(symbol: string, hint: string | null): Promise<{ theme: string | null; peers: string[] }> {
  if (!hasAnyLlm()) return { theme: null, peers: [] };
  const prompt =
    `For the publicly listed US stock with ticker ${symbol}${hint ? ` (industry/sector context: ${hint})` : ""}, ` +
    `identify the most specific investing theme it belongs to (e.g. "Space Economy", "Satellite Communications", ` +
    `"GLP-1 Weight Loss", "AI Infrastructure"). Then list 6 to 10 OTHER actively traded US-listed peers (NYSE/NASDAQ) ` +
    `that belong to the same narrow theme. Use real, current tickers only. Do NOT include ${symbol} in the peer list. ` +
    `Avoid OTC, mutual funds, and obscure ETFs. Prefer pure-play peers over diversified conglomerates.`;
  try {
    const res = await llmFetch({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise equity analyst. Return only data via the provided tool." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_theme",
            description: "Report the theme name and peer tickers.",
            parameters: {
              type: "object",
              properties: {
                theme: { type: "string", description: "Specific investing theme name." },
                peers: {
                  type: "array",
                  items: { type: "string" },
                  description: "Array of 6-10 peer tickers, uppercase, no dollar signs.",
                },
              },
              required: ["theme", "peers"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_theme" } },
      }, { task: "long", label: "live-theme-suggest" });
    if (!res.ok) {
      console.error("AI gateway", res.status, await res.text().catch(() => ""));
      return { theme: null, peers: [] };
    }
    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return { theme: null, peers: [] };
    const args = JSON.parse(call.function.arguments ?? "{}");
    const theme = typeof args.theme === "string" ? args.theme : null;
    const peers = Array.isArray(args.peers)
      ? args.peers
          .map((p: any) => String(p).trim().toUpperCase().replace(/[$\s]/g, ""))
          .filter((p: string) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(p) && p !== symbol)
          .slice(0, 10)
      : [];
    return { theme, peers };
  } catch (e) {
    console.error("AI suggest error", e);
    return { theme: null, peers: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = String(body?.symbol ?? "").trim().toUpperCase();
    const hint = typeof body?.hint === "string" ? body.hint : null;
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      return new Response(JSON.stringify({ error: "Invalid symbol" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { theme, peers } = await suggestPeersWithAI(symbol, hint);
    if (peers.length === 0) {
      return new Response(JSON.stringify({ theme, peers: [], quotes: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch quotes in parallel (capped) so the panel populates immediately.
    const quotes = (await Promise.all(peers.map((p) => fetchQuoteAndHistory(p))))
      .filter((q): q is PeerQuote => q !== null && q.price !== null);

    return new Response(JSON.stringify({ theme, peers, quotes }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("live-theme-suggest", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
