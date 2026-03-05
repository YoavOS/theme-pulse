const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CHUNK_SIZE = 5; // themes per invocation to stay under edge function timeout
const MAX_RETRIES = 3;

interface QuoteResult {
  symbol: string;
  pct: number;
  price: number;
  error?: string;
}

async function fetchQuote(symbol: string): Promise<QuoteResult> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    if (res.status === 429) {
      return { symbol, pct: 0, price: 0, error: "rate_limited" };
    }
    if (!res.ok) {
      return { symbol, pct: 0, price: 0, error: `http_${res.status}` };
    }
    const data = await res.json();
    if (!data || data.c === 0) {
      return { symbol, pct: 0, price: 0, error: "no_data" };
    }
    const pct = data.dp ?? ((data.c - data.pc) / data.pc) * 100;
    return { symbol, pct: Math.round(pct * 100) / 100, price: data.c };
  } catch (e) {
    return { symbol, pct: 0, price: 0, error: String(e) };
  }
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

    // --- CHUNK: process next N themes ---
    // Load all themes + tickers
    const { data: dbThemes } = await sb.from("themes").select("id, name, description");
    const { data: dbTickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) throw new Error("Failed to read themes");

    const tickerMap = new Map<string, string[]>();
    for (const tk of dbTickers) {
      if (!tickerMap.has(tk.theme_id)) tickerMap.set(tk.theme_id, []);
      tickerMap.get(tk.theme_id)!.push(tk.ticker_symbol);
    }

    const themeList: { id: string; name: string; symbols: string[] }[] = [];
    for (const t of dbThemes) {
      const symbols = tickerMap.get(t.id) || [];
      if (symbols.length > 0) {
        themeList.push({ id: t.id, name: t.name, symbols });
      }
    }

    const totalThemes = themeList.length;

    // Get current progress
    const { data: progress } = await sb.from("full_update_progress").select("*").limit(1).single();
    let startIndex = 0;
    if (progress && (progress.status === "in_progress" || progress.status === "paused_failed") && progress.last_theme_index > 0) {
      startIndex = progress.last_theme_index;
    }

    // If already complete or starting fresh
    if (action === "start" && (!progress || progress.status === "complete" || progress.status === "idle")) {
      startIndex = 0;
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

    // Process this chunk of themes
    for (let i = startIndex; i < endIndex; i++) {
      const theme = themeList[i];
      const tickers: QuoteResult[] = [];
      let themeSkipped = false;

      // Fetch tickers in batches of 4
      for (let j = 0; j < theme.symbols.length; j += 4) {
        const batch = theme.symbols.slice(j, j + 4);
        let retryCount = 0;
        let batchResults: QuoteResult[] = [];

        while (retryCount < MAX_RETRIES) {
          batchResults = await Promise.all(batch.map(fetchQuote));
          const rateLimited = batchResults.some((r) => r.error === "rate_limited");

          if (!rateLimited) break;

          retryCount++;
          if (retryCount < MAX_RETRIES) {
            console.log(`Rate limited on theme ${i + 1}/${totalThemes} (${theme.name}), retry ${retryCount}/${MAX_RETRIES}, waiting 15s...`);
            await sb.from("full_update_progress").update({
              last_theme_index: i,
              status: "rate_limited_waiting",
              last_updated: new Date().toISOString(),
            }).neq("id", "00000000-0000-0000-0000-000000000000");
            await delay(15000); // 15s wait (short enough to stay under timeout)
          }
        }

        if (retryCount >= MAX_RETRIES) {
          console.log(`Skipped theme ${i + 1}/${totalThemes} (${theme.name}) after ${MAX_RETRIES} retries`);
          skipped.push(theme.name);
          themeSkipped = true;
          break;
        }

        tickers.push(...batchResults);
        if (j + 4 < theme.symbols.length) await delay(1200);
      }

      if (!themeSkipped) {
        console.log(`Completed theme ${i + 1}/${totalThemes}: ${theme.name}`);
      }

      // Save progress after each theme
      await sb.from("full_update_progress").update({
        last_theme_index: i + 1,
        status: "in_progress",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");

      if (i + 1 < endIndex) await delay(1500);
    }

    const done = endIndex >= totalThemes;

    // Mark complete or save position for next chunk
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Full scan error:", error);

    // Try to mark as failed
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
