const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CHUNK_SIZE = 3; // themes per invocation — smaller to avoid timeouts with many tickers
const MAX_RETRIES_PER_TICKER = 2;

interface QuoteResult {
  symbol: string;
  pct: number;
  price: number;
  error?: string;
  skipped?: boolean;
}

async function fetchQuoteWithRetry(symbol: string, themeName: string): Promise<QuoteResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_TICKER; attempt++) {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
      const res = await fetch(url);

      if (res.status === 429) {
        if (attempt < MAX_RETRIES_PER_TICKER) {
          console.log(`429 on ticker ${symbol} in "${themeName}", retry ${attempt + 1}/${MAX_RETRIES_PER_TICKER}, waiting 30s...`);
          await delay(30000);
          continue;
        }
        console.log(`Skipped ticker ${symbol} in "${themeName}": rate limit after ${MAX_RETRIES_PER_TICKER} retries`);
        return { symbol, pct: 0, price: 0, error: "rate_limited", skipped: true };
      }

      if (!res.ok) {
        return { symbol, pct: 0, price: 0, error: `http_${res.status}`, skipped: true };
      }

      const data = await res.json();
      if (!data || data.c === 0) {
        return { symbol, pct: 0, price: 0, error: "no_data" };
      }

      const pct = data.dp ?? ((data.c - data.pc) / data.pc) * 100;
      return { symbol, pct: Math.round(pct * 100) / 100, price: data.c };
    } catch (e) {
      if (attempt < MAX_RETRIES_PER_TICKER) {
        console.log(`Error on ticker ${symbol} in "${themeName}": ${e}, retry ${attempt + 1}`);
        await delay(5000);
        continue;
      }
      console.log(`Skipped ticker ${symbol} in "${themeName}": ${e} after retries`);
      return { symbol, pct: 0, price: 0, error: String(e), skipped: true };
    }
  }
  return { symbol, pct: 0, price: 0, error: "exhausted_retries", skipped: true };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

    // --- CHUNK: process next N themes and RETURN results ---
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
      // Fresh scan: always reset to 0
      startIndex = 0;
      console.log("Action=start: starting fresh from 0");
    } else {
      // action=chunk: resume from where we left off
      if (progress && progress.last_theme_index > 0 && progress.last_theme_index < totalThemes) {
        startIndex = progress.last_theme_index;
        console.log(`Action=chunk: resuming from index ${startIndex}/${totalThemes}`);
      } else {
        startIndex = 0;
        console.log("Action=chunk: no valid progress, starting from 0");
      }
    }

    const endIndex = Math.min(startIndex + CHUNK_SIZE, totalThemes);

    // Update progress
    await sb.from("full_update_progress").update({
      last_theme_index: startIndex,
      total_themes: totalThemes,
      status: "in_progress",
      last_updated: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    const skipped: string[] = [];
    const skippedTickers: string[] = [];

    // Results to return to frontend
    const themeResults: {
      theme_name: string;
      notes: string | null;
      tickers: { symbol: string; pct: number; price: number }[];
      skipped_tickers: string[];
    }[] = [];

    // Process this chunk of themes
    for (let i = startIndex; i < endIndex; i++) {
      const theme = themeList[i];
      const tickers: QuoteResult[] = [];
      const thisThemeSkipped: string[] = [];

      console.log(`Processing theme ${i + 1}/${totalThemes}: "${theme.name}" (${theme.symbols.length} tickers)`);

      // Fetch tickers one-by-one with 1.5s delay to stay safe
      for (let j = 0; j < theme.symbols.length; j++) {
        const symbol = theme.symbols[j];
        const result = await fetchQuoteWithRetry(symbol, theme.name);

        if (result.skipped) {
          thisThemeSkipped.push(symbol);
          skippedTickers.push(`${symbol} (${theme.name})`);
        }

        tickers.push(result);

        // Delay between individual tickers (1.5s)
        if (j + 1 < theme.symbols.length) {
          await delay(1500);
        }
      }

      // Build result — include ALL tickers (even skipped ones keep pct=0)
      const validTickers = tickers.map(t => ({
        symbol: t.symbol,
        pct: t.pct,
        price: t.price,
      }));

      themeResults.push({
        theme_name: theme.name,
        notes: theme.description,
        tickers: validTickers,
        skipped_tickers: thisThemeSkipped,
      });

      if (thisThemeSkipped.length > 0) {
        console.log(`Theme "${theme.name}": ${thisThemeSkipped.length} tickers skipped: ${thisThemeSkipped.join(", ")}`);
      } else {
        console.log(`Completed theme ${i + 1}/${totalThemes}: "${theme.name}" — all ${tickers.length} tickers OK`);
      }

      // Save progress after each theme
      await sb.from("full_update_progress").update({
        last_theme_index: i + 1,
        status: "in_progress",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");

      // Delay between themes (2s)
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
        skipped,
        skipped_tickers: skippedTickers,
        // KEY: return actual theme+ticker data so frontend can use it directly
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
