const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const BATCH_DELAY_MS = 200; // ~5 per second
const RATE_LIMIT_WAIT_MS = 30000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ValidationResult {
  symbol: string;
  theme_name: string;
  theme_id: string;
  ticker_id: string;
  valid: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Load all themes + tickers
    const { data: dbThemes } = await sb.from("themes").select("id, name");
    const { data: dbTickers } = await sb.from("theme_tickers").select("id, theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) {
      throw new Error("Failed to read themes/tickers");
    }

    const themeMap = new Map<string, string>();
    for (const t of dbThemes) {
      themeMap.set(t.id, t.name);
    }

    // Deduplicate symbols for validation (same symbol across themes only needs one check)
    const uniqueSymbols = new Set<string>();
    for (const tk of dbTickers) {
      uniqueSymbols.add(tk.ticker_symbol);
    }

    // Validate each unique symbol
    const validityMap = new Map<string, boolean>();
    let checked = 0;
    const total = uniqueSymbols.size;

    for (const symbol of uniqueSymbols) {
      checked++;
      if (checked % 10 === 0) {
        console.log(`Validating ${checked}/${total}...`);
      }

      let valid = false;
      try {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
        const res = await fetch(url);

        if (res.status === 429) {
          console.log(`Rate limited at ${symbol}, waiting 30s...`);
          await delay(RATE_LIMIT_WAIT_MS);
          // Retry once
          const retry = await fetch(url);
          if (retry.ok) {
            const data = await retry.json();
            valid = data && typeof data === "object" && Object.keys(data).length > 0 && !!data.ticker;
          }
        } else if (res.ok) {
          const data = await res.json();
          valid = data && typeof data === "object" && Object.keys(data).length > 0 && !!data.ticker;
        }
      } catch (e) {
        console.log(`Error validating ${symbol}: ${e}`);
        valid = true; // On error, assume valid to not false-flag
      }

      validityMap.set(symbol, valid);
      await delay(BATCH_DELAY_MS);
    }

    // Build results grouped by theme
    const results: ValidationResult[] = [];
    for (const tk of dbTickers) {
      const isValid = validityMap.get(tk.ticker_symbol) ?? true;
      if (!isValid) {
        results.push({
          symbol: tk.ticker_symbol,
          theme_name: themeMap.get(tk.theme_id) || "Unknown",
          theme_id: tk.theme_id,
          ticker_id: tk.id,
          valid: false,
        });
      }
    }

    console.log(`Validation complete: ${results.length} invalid out of ${total} unique symbols`);

    return new Response(
      JSON.stringify({
        invalid_count: results.length,
        total_checked: total,
        invalid_tickers: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Validate tickers error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
