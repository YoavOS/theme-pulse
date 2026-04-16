// Public edge function wrapper around the shared yahooHistory helper.
// Use from client hooks when historical data is needed on demand.
//
// GET  /get-historical-data?symbol=AAPL&period=3mo
// POST /get-historical-data  { symbols: ["AAPL","MSFT"], period: "1mo", todayPrices?: {...} }

import { getHistoricalData, getHistoricalBatch, makeServiceClient, YahooPeriod } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_PERIODS: YahooPeriod[] = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "ytd"];

function isPeriod(p: string): p is YahooPeriod {
  return (VALID_PERIODS as string[]).includes(p);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = makeServiceClient();

    if (req.method === "GET") {
      const url = new URL(req.url);
      const symbol = url.searchParams.get("symbol")?.toUpperCase();
      const period = url.searchParams.get("period") ?? "1mo";
      const todayPriceParam = url.searchParams.get("todayPrice");
      if (!symbol) {
        return new Response(JSON.stringify({ error: "symbol required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isPeriod(period)) {
        return new Response(JSON.stringify({ error: `invalid period; allowed: ${VALID_PERIODS.join(", ")}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = await getHistoricalData(sb, symbol, period, {
        todayPrice: todayPriceParam ? Number(todayPriceParam) : null,
      });
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const symbols: string[] = Array.isArray(body.symbols)
        ? body.symbols.map((s: string) => String(s).toUpperCase()).filter(Boolean)
        : [];
      const period: string = body.period ?? "1mo";
      const todayPrices: Record<string, number | null> = body.todayPrices ?? {};

      if (symbols.length === 0) {
        return new Response(JSON.stringify({ error: "symbols[] required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isPeriod(period)) {
        return new Response(JSON.stringify({ error: `invalid period; allowed: ${VALID_PERIODS.join(", ")}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = await getHistoricalBatch(sb, symbols, period, { todayPrices });
      return new Response(JSON.stringify({ period, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-historical-data error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
