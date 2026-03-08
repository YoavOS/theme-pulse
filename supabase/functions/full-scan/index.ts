const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CHUNK_SIZE = 2; // themes per invocation
const SUB_BATCH_SIZE = 8; // tickers per sub-batch
const SUB_BATCH_DELAY_MS = 3000; // delay between sub-batches
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30000;

interface QuoteResult {
  symbol: string;
  pct: number;
  price: number;
  skipped?: boolean;
  skipReason?: string;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Validate ticker exists via Finnhub profile endpoint
async function isValidTicker(symbol: string): Promise<boolean> {
  try {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limited on validation — assume valid to not block scan
      console.log(`Ticker validation rate-limited for ${symbol}, assuming valid`);
      return true;
    }
    if (!res.ok) return false;
    const data = await res.json();
    // Empty object = invalid ticker
    return data && typeof data === "object" && Object.keys(data).length > 0 && !!data.ticker;
  } catch {
    return true; // On error, assume valid to not block
  }
}

async function fetchQuoteWithRetry(symbol: string, themeName: string): Promise<QuoteResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
      const res = await fetch(url);

      if (res.status === 429) {
        if (attempt < MAX_RETRIES) {
          console.log(`429 on ${symbol} in "${themeName}", retry ${attempt + 1}/${MAX_RETRIES}, waiting 30s...`);
          await delay(RETRY_DELAY_MS);
          continue;
        }
        console.log(`Skipped ticker ${symbol} in "${themeName}": rate limit after ${MAX_RETRIES} retries`);
        return { symbol, pct: 0, price: 0, skipped: true, skipReason: "rate_limited" };
      }

      if (!res.ok) {
        console.log(`Skipped ticker ${symbol} in "${themeName}": HTTP ${res.status}`);
        return { symbol, pct: 0, price: 0, skipped: true, skipReason: `http_${res.status}` };
      }

      const data = await res.json();
      
      // c=0 and pc=0 means no data (likely invalid/delisted)
      if (!data || (data.c === 0 && data.pc === 0)) {
        console.log(`Skipped ticker ${symbol} in "${themeName}": no quote data (likely invalid)`);
        return { symbol, pct: 0, price: 0, skipped: true, skipReason: "no_data" };
      }

      const pct = data.dp ?? ((data.c - data.pc) / data.pc) * 100;
      return { symbol, pct: Math.round(pct * 100) / 100, price: data.c };
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        console.log(`Error on ${symbol} in "${themeName}": ${e}, retry ${attempt + 1}`);
        await delay(5000);
        continue;
      }
      console.log(`Skipped ticker ${symbol} in "${themeName}": ${e} after retries`);
      return { symbol, pct: 0, price: 0, skipped: true, skipReason: String(e) };
    }
  }
  return { symbol, pct: 0, price: 0, skipped: true, skipReason: "exhausted_retries" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // --- STATUS ---
    if (action === "status") {
      const { data } = await sb.from("full_update_progress").select("*").limit(1).single();
      return new Response(JSON.stringify({ progress: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- RESET ---
    if (action === "reset") {
      await sb.from("full_update_progress").update({
        last_theme_index: 0,
        total_themes: 0,
        status: "idle",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Load all themes+tickers ---
    const { data: dbThemes } = await sb.from("themes").select("id, name, description");
    const { data: dbTickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) throw new Error("Failed to read themes");

    const tickerMap = new Map<string, string[]>();
    for (const tk of dbTickers) {
      if (!tickerMap.has(tk.theme_id)) tickerMap.set(tk.theme_id, []);
      tickerMap.get(tk.theme_id)!.push(tk.ticker_symbol);
    }

    const themeList: { id: string; name: string; description: string | null; symbols: string[] }[] = [];
    for (const t of dbThemes) {
      const symbols = tickerMap.get(t.id) || [];
      if (symbols.length > 0) {
        themeList.push({ id: t.id, name: t.name, description: t.description, symbols });
      }
    }

    const totalThemes = themeList.length;

    // Get current progress
    const { data: progress } = await sb.from("full_update_progress").select("*").limit(1).single();
    let startIndex = 0;

    if (action === "start") {
      // Fresh scan: reset progress row then start from 0
      startIndex = 0;
      console.log(`Action=start: fresh scan, ${totalThemes} themes`);
      await sb.from("full_update_progress").update({
        last_theme_index: 0,
        total_themes: totalThemes,
        status: "in_progress",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      // action=chunk: resume from saved index
      if (progress && progress.last_theme_index > 0 && progress.last_theme_index < totalThemes) {
        startIndex = progress.last_theme_index;
        console.log(`Action=chunk: resuming from index ${startIndex}/${totalThemes}`);
      } else {
        startIndex = 0;
        console.log("Action=chunk: no valid progress, starting from 0");
      }
    }

    const endIndex = Math.min(startIndex + CHUNK_SIZE, totalThemes);

    // Update progress to in_progress
    await sb.from("full_update_progress").update({
      last_theme_index: startIndex,
      total_themes: totalThemes,
      status: "in_progress",
      last_updated: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    const skippedTickers: string[] = [];
    const invalidTickers: string[] = [];

    const themeResults: {
      theme_name: string;
      notes: string | null;
      tickers: { symbol: string; pct: number; price: number; skipped?: boolean; skipReason?: string }[];
      skipped_tickers: string[];
      invalid_tickers: string[];
    }[] = [];

    // Process chunk
    for (let i = startIndex; i < endIndex; i++) {
      const theme = themeList[i];
      const thisThemeSkipped: string[] = [];
      const thisThemeInvalid: string[] = [];
      const tickers: QuoteResult[] = [];

      console.log(`Processing theme ${i + 1}/${totalThemes}: "${theme.name}" (${theme.symbols.length} tickers)`);

      // Process tickers in sub-batches
      for (let batchStart = 0; batchStart < theme.symbols.length; batchStart += SUB_BATCH_SIZE) {
        const subBatch = theme.symbols.slice(batchStart, batchStart + SUB_BATCH_SIZE);

        for (const symbol of subBatch) {
          // Validate ticker first
          const valid = await isValidTicker(symbol);
          if (!valid) {
            console.log(`Skipped invalid ticker ${symbol} in theme "${theme.name}": no profile found`);
            tickers.push({ symbol, pct: 0, price: 0, skipped: true, skipReason: "invalid_ticker" });
            thisThemeInvalid.push(symbol);
            invalidTickers.push(`${symbol} (${theme.name})`);
            continue;
          }

          // Small delay between individual tickers within sub-batch
          await delay(1200);

          const result = await fetchQuoteWithRetry(symbol, theme.name);
          tickers.push(result);

          if (result.skipped) {
            thisThemeSkipped.push(symbol);
            skippedTickers.push(`${symbol} (${theme.name})`);
          }
        }

        // Delay between sub-batches
        if (batchStart + SUB_BATCH_SIZE < theme.symbols.length) {
          console.log(`Sub-batch complete, waiting ${SUB_BATCH_DELAY_MS / 1000}s...`);
          await delay(SUB_BATCH_DELAY_MS);
        }
      }

      themeResults.push({
        theme_name: theme.name,
        notes: theme.description,
        tickers: tickers.map(t => ({
          symbol: t.symbol,
          pct: t.pct,
          price: t.price,
          skipped: t.skipped,
          skipReason: t.skipReason,
        })),
        skipped_tickers: thisThemeSkipped,
        invalid_tickers: thisThemeInvalid,
      });

      const validCount = tickers.filter(t => !t.skipped).length;
      console.log(`Theme ${i + 1}/${totalThemes} "${theme.name}": ${validCount}/${tickers.length} valid, ${thisThemeSkipped.length} skipped, ${thisThemeInvalid.length} invalid`);

      // Save progress after each theme
      await sb.from("full_update_progress").update({
        last_theme_index: i + 1,
        status: "in_progress",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");

      // Delay between themes
      if (i + 1 < endIndex) await delay(2000);
    }

    const done = endIndex >= totalThemes;

    await sb.from("full_update_progress").update({
      last_theme_index: endIndex,
      total_themes: totalThemes,
      status: done ? "complete" : "in_progress",
      last_updated: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    return new Response(
      JSON.stringify({
        done,
        processed_from: startIndex,
        processed_to: endIndex,
        total_themes: totalThemes,
        skipped_tickers: skippedTickers,
        invalid_tickers: invalidTickers,
        themes: themeResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Full scan error:", error);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      await sb.from("full_update_progress").update({
        status: "paused_failed",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");
    } catch (_) { /* ignore */ }

    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
