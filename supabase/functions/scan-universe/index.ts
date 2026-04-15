import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FINNHUB_DELAY_MS = 1100; // stay under 60/min
const BATCH_SIZE = 50; // process this many per invocation

const FILTER = {
  MIN_MARKET_CAP: 1_000_000_000, // $1B in raw dollars
  MIN_PRICE: 6,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const supabase = createClient(SB_URL, SB_KEY);
    const body = await req.json().catch(() => ({}));
    const offset = body.offset ?? 0;

    // Step 1: Get full US symbol list (cached in DB after first fetch)
    let symbols: string[] = [];

    if (offset === 0) {
      // Fetch from Finnhub
      const res = await fetch(
        `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB_KEY}`
      );
      if (!res.ok) throw new Error(`Finnhub symbol list failed: ${res.status}`);
      const data = await res.json();

      // Filter to common stocks only (type = "Common Stock"), skip ETFs, warrants, etc.
      symbols = data
        .filter((s: any) => s.type === "Common Stock" && s.symbol && !s.symbol.includes("."))
        .map((s: any) => s.symbol);

      console.log(`Fetched ${symbols.length} common US stocks from Finnhub`);
    }

    // Process a batch starting at offset
    const batch = symbols.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) {
      return new Response(
        JSON.stringify({ done: true, total: symbols.length, processed: offset }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const qualified: any[] = [];
    let skipped = 0;

    for (const sym of batch) {
      try {
        // Fetch quote (price)
        const quoteRes = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        if (quoteRes.status === 429) {
          console.log("Rate limited, stopping batch early");
          break;
        }
        const quote = await quoteRes.json();
        const price = quote?.c;
        if (!price || price < FILTER.MIN_PRICE) { skipped++; await sleep(FINNHUB_DELAY_MS); continue; }

        await sleep(FINNHUB_DELAY_MS);

        // Fetch company profile (market cap, name, sector)
        const profRes = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`
        );
        if (profRes.status === 429) {
          console.log("Rate limited on profile, stopping");
          break;
        }
        const prof = await profRes.json();
        const mc = prof?.marketCapitalization; // in millions from Finnhub
        if (!mc || mc * 1_000_000 < FILTER.MIN_MARKET_CAP) { skipped++; await sleep(FINNHUB_DELAY_MS); continue; }

        qualified.push({
          symbol: sym,
          company_name: prof?.name || sym,
          market_cap: mc, // store in Finnhub units (millions)
          current_price: price,
          sector: prof?.finnhubIndustry || null,
          qualified: true,
          last_scanned: new Date().toISOString(),
        });

        await sleep(FINNHUB_DELAY_MS);
      } catch (e) {
        console.error(`Error processing ${sym}:`, e);
        skipped++;
        await sleep(FINNHUB_DELAY_MS);
      }
    }

    // Upsert qualified stocks
    if (qualified.length > 0) {
      const { error: uErr } = await supabase
        .from("rs_stock_universe")
        .upsert(qualified, { onConflict: "symbol" });
      if (uErr) console.error("Upsert error:", uErr);
    }

    const nextOffset = offset + BATCH_SIZE;
    const done = nextOffset >= symbols.length;

    return new Response(
      JSON.stringify({
        done,
        batch_processed: batch.length,
        qualified_count: qualified.length,
        skipped,
        next_offset: done ? null : nextOffset,
        total_symbols: symbols.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("scan-universe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
