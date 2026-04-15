import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map period to Yahoo Finance params
function getPeriodParams(period: string): { range: string; interval: string; tradingDays: number } {
  switch (period) {
    case "1mo": return { range: "1mo", interval: "1d", tradingDays: 22 };
    case "3mo": return { range: "3mo", interval: "1d", tradingDays: 66 };
    case "6mo": return { range: "6mo", interval: "1d", tradingDays: 132 };
    default: return { range: "1mo", interval: "1d", tradingDays: 22 };
  }
}

async function fetchYahooHistory(symbol: string, period: string): Promise<{
  startPrice: number | null;
  endPrice: number | null;
  returnPct: number | null;
  dataPoints: number;
}> {
  const { range, interval } = getPeriodParams(period);

  // Yahoo Finance v8 chart API (no key needed)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    console.error(`Yahoo fetch failed for ${symbol}: ${res.status}`);
    return { startPrice: null, endPrice: null, returnPct: null, dataPoints: 0 };
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    return { startPrice: null, endPrice: null, returnPct: null, dataPoints: 0 };
  }

  const closes = result.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null) || [];
  if (closes.length < 2) {
    return { startPrice: null, endPrice: null, returnPct: null, dataPoints: closes.length };
  }

  const startPrice = closes[0];
  const endPrice = closes[closes.length - 1];
  const returnPct = startPrice > 0 ? Math.round(((endPrice - startPrice) / startPrice) * 10000) / 100 : null;

  return { startPrice, endPrice, returnPct, dataPoints: closes.length };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    const body = await req.json();
    const symbols: string[] = body.symbols || [];
    const periods: string[] = body.periods || ["1mo", "3mo", "6mo"];

    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "No symbols provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap at 20 symbols per call to stay within edge function timeout
    const batch = symbols.slice(0, 20);
    const results: Record<string, Record<string, any>> = {};
    const toUpsert: any[] = [];

    for (const sym of batch) {
      results[sym] = {};
      for (const period of periods) {
        // Check cache first (< 24h old)
        const { data: cached } = await supabase
          .from("yahoo_history_cache")
          .select("*")
          .eq("symbol", sym)
          .eq("period", period)
          .gte("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .maybeSingle();

        if (cached) {
          results[sym][period] = {
            returnPct: cached.return_pct,
            dataPoints: cached.data_points,
            source: "cache",
          };
          continue;
        }

        // Fetch from Yahoo
        const hist = await fetchYahooHistory(sym, period);
        results[sym][period] = {
          returnPct: hist.returnPct,
          dataPoints: hist.dataPoints,
          source: "yahoo",
        };

        if (hist.returnPct !== null) {
          toUpsert.push({
            symbol: sym,
            period,
            start_price: hist.startPrice,
            end_price: hist.endPrice,
            return_pct: hist.returnPct,
            data_points: hist.dataPoints,
            fetched_at: new Date().toISOString(),
          });
        }

        // Rate limit: 500ms between Yahoo calls
        await sleep(500);
      }
    }

    // Upsert cache
    if (toUpsert.length > 0) {
      const { error: uErr } = await supabase
        .from("yahoo_history_cache")
        .upsert(toUpsert, { onConflict: "symbol,period" });
      if (uErr) console.error("Yahoo cache upsert error:", uErr);
    }

    return new Response(
      JSON.stringify({ results, processed: batch.length, total_requested: symbols.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fetch-yahoo-history error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
