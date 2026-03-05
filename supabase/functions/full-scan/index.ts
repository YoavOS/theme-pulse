const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";

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
    const action = url.searchParams.get("action"); // "status", "start", "reset"

    // --- STATUS: return current progress ---
    if (action === "status") {
      const { data } = await sb.from("full_update_progress").select("*").limit(1).single();
      return new Response(JSON.stringify({ progress: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- RESET: clear progress ---
    if (action === "reset") {
      await sb.from("full_update_progress").update({
        last_theme_index: 0,
        total_themes: 0,
        status: "idle",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000"); // update all rows
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- START / RESUME full scan ---
    // Load all themes + tickers from DB
    const { data: dbThemes } = await sb.from("themes").select("id, name, description");
    const { data: dbTickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) throw new Error("Failed to read themes");

    // Build ordered list of themes with their tickers
    const themeList: { id: string; name: string; description: string | null; symbols: string[] }[] = [];
    const tickerMap = new Map<string, string[]>();
    for (const tk of dbTickers) {
      if (!tickerMap.has(tk.theme_id)) tickerMap.set(tk.theme_id, []);
      tickerMap.get(tk.theme_id)!.push(tk.ticker_symbol);
    }
    for (const t of dbThemes) {
      const symbols = tickerMap.get(t.id) || [];
      if (symbols.length > 0) {
        themeList.push({ id: t.id, name: t.name, description: t.description, symbols });
      }
    }

    const totalThemes = themeList.length;

    // Check for resume point
    const { data: progress } = await sb.from("full_update_progress").select("*").limit(1).single();
    let startIndex = 0;
    if (progress && progress.status === "in_progress" && progress.last_theme_index > 0) {
      startIndex = progress.last_theme_index; // resume from next one
    }

    // Update progress to in_progress
    await sb.from("full_update_progress").update({
      last_theme_index: startIndex,
      total_themes: totalThemes,
      status: "in_progress",
      last_updated: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    // Process themes one by one
    const allResults: Record<string, { theme_name: string; performance_pct: number; up_count: number; down_count: number; tickers: QuoteResult[] }> = {};

    for (let i = startIndex; i < totalThemes; i++) {
      const theme = themeList[i];
      const tickers: QuoteResult[] = [];

      // Fetch tickers in batches of 4
      for (let j = 0; j < theme.symbols.length; j += 4) {
        const batch = theme.symbols.slice(j, j + 4);
        const results = await Promise.all(batch.map(fetchQuote));

        // Check for rate limit
        const rateLimited = results.some((r) => r.error === "rate_limited");
        if (rateLimited) {
          // Wait 60s and retry
          console.log(`Rate limited at theme ${i + 1}/${totalThemes} (${theme.name}), waiting 60s...`);
          await sb.from("full_update_progress").update({
            last_theme_index: i,
            status: "rate_limited_waiting",
            last_updated: new Date().toISOString(),
          }).neq("id", "00000000-0000-0000-0000-000000000000");

          await delay(60000);

          // Retry batch
          const retryResults = await Promise.all(batch.map(fetchQuote));
          tickers.push(...retryResults);
        } else {
          tickers.push(...results);
        }

        // Delay between ticker batches (1.5s)
        if (j + 4 < theme.symbols.length) {
          await delay(1500);
        }
      }

      const up_count = tickers.filter((t) => t.pct > 0).length;
      const down_count = tickers.filter((t) => t.pct <= 0).length;
      const performance_pct = tickers.length > 0
        ? Math.round((tickers.reduce((sum, t) => sum + t.pct, 0) / tickers.length) * 100) / 100
        : 0;

      allResults[theme.name] = {
        theme_name: theme.name,
        performance_pct,
        up_count,
        down_count,
        tickers: tickers.sort((a, b) => b.pct - a.pct),
      };

      // Save progress after each theme
      await sb.from("full_update_progress").update({
        last_theme_index: i + 1,
        status: "in_progress",
        last_updated: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");

      console.log(`Completed theme ${i + 1}/${totalThemes}: ${theme.name}`);

      // Delay between themes (2s)
      if (i + 1 < totalThemes) {
        await delay(2000);
      }
    }

    // Mark complete
    await sb.from("full_update_progress").update({
      last_theme_index: totalThemes,
      total_themes: totalThemes,
      status: "complete",
      last_updated: new Date().toISOString(),
    }).neq("id", "00000000-0000-0000-0000-000000000000");

    const themes = Object.values(allResults);

    return new Response(
      JSON.stringify({
        themes,
        fetched_at: new Date().toISOString(),
        symbols_fetched: themes.reduce((sum, t) => sum + t.tickers.length, 0),
        total_themes: totalThemes,
        started_from: startIndex,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Full scan error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
