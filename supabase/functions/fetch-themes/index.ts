const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALPHA_VANTAGE_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY") || "";

interface QuoteResult {
  symbol: string;
  pct: number;
  price: number;
  error?: string;
}

async function fetchQuote(symbol: string): Promise<QuoteResult> {
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data["Note"] || data["Information"]) {
      return { symbol, pct: 0, price: 0, error: "rate_limited" };
    }

    const quote = data["Global Quote"];
    if (!quote || !quote["10. change percent"]) {
      return { symbol, pct: 0, price: 0, error: "no_data" };
    }

    const pct = parseFloat(quote["10. change percent"].replace("%", ""));
    const price = parseFloat(quote["05. price"]);
    return { symbol, pct, price };
  } catch (e) {
    return { symbol, pct: 0, price: 0, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Read themes and tickers from DB
    const { data: dbThemes } = await sb.from("themes").select("id, name, description");
    const { data: dbTickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) {
      throw new Error("Failed to read themes from database");
    }

    // Build theme->tickers map
    const themeTickerMap = new Map<string, { name: string; description: string | null; symbols: string[] }>();
    for (const t of dbThemes) {
      themeTickerMap.set(t.id, { name: t.name, description: t.description, symbols: [] });
    }
    for (const tk of dbTickers) {
      const entry = themeTickerMap.get(tk.theme_id);
      if (entry) entry.symbols.push(tk.ticker_symbol);
    }

    const url = new URL(req.url);
    const themesParam = url.searchParams.get("themes");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "5"), 20);

    let themeEntries: { id: string; name: string; description: string | null; symbols: string[] }[];

    if (themesParam) {
      const requested = themesParam.split(",").map(t => t.trim());
      themeEntries = Array.from(themeTickerMap.entries())
        .filter(([, v]) => requested.includes(v.name))
        .map(([id, v]) => ({ id, ...v }));
    } else {
      // Only fetch themes that have tickers
      themeEntries = Array.from(themeTickerMap.entries())
        .filter(([, v]) => v.symbols.length > 0)
        .map(([id, v]) => ({ id, ...v }))
        .slice(0, limit);
    }

    const uniqueSymbols = [...new Set(themeEntries.flatMap(t => t.symbols))];
    console.log(`Fetching ${uniqueSymbols.length} symbols for ${themeEntries.length} themes`);

    const quoteMap: Record<string, QuoteResult> = {};
    const batchSize = 5;
    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchQuote));
      for (const r of results) quoteMap[r.symbol] = r;
      if (results.some(r => r.error === "rate_limited")) break;
      if (i + batchSize < uniqueSymbols.length) {
        await new Promise(r => setTimeout(r, 12000));
      }
    }

    const themes = themeEntries.map(({ name, description, symbols }) => {
      const tickers = symbols.map(s => {
        const q = quoteMap[s];
        return { symbol: s, pct: q?.pct ?? 0, price: q?.price ?? 0 };
      }).sort((a, b) => b.pct - a.pct);

      const up_count = tickers.filter(t => t.pct > 0).length;
      const down_count = tickers.filter(t => t.pct <= 0).length;
      const performance_pct = tickers.length > 0
        ? Math.round((tickers.reduce((sum, t) => sum + t.pct, 0) / tickers.length) * 100) / 100
        : 0;

      return { theme_name: name, notes: description, performance_pct, up_count, down_count, tickers };
    });

    const rateLimited = Object.values(quoteMap).some(q => q.error === "rate_limited");
    const allThemeNames = Array.from(themeTickerMap.values()).map(v => v.name);

    return new Response(
      JSON.stringify({
        themes,
        fetched_at: new Date().toISOString(),
        symbols_fetched: Object.keys(quoteMap).length,
        rate_limited: rateLimited,
        available_themes: allThemeNames,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Handler error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
