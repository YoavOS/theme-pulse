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

function getTimeframeFromTs(timeframe: string): number {
  const now = Math.floor(Date.now() / 1000);
  switch (timeframe) {
    case "1W": return now - 7 * 86400;
    case "1M": return now - 30 * 86400;
    case "3M": return now - 90 * 86400;
    case "YTD": {
      const jan1 = new Date(new Date().getFullYear(), 0, 1);
      return Math.floor(jan1.getTime() / 1000);
    }
    default: return 0; // "Today" — use /quote
  }
}

async function fetchQuoteDaily(symbol: string): Promise<QuoteResult> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    if (res.status === 429) return { symbol, pct: 0, price: 0, error: "rate_limited" };
    const data = await res.json();
    if (!data || data.c === 0) return { symbol, pct: 0, price: 0, error: "no_data" };
    const pct = data.dp ?? ((data.c - data.pc) / data.pc) * 100;
    return { symbol, pct: Math.round(pct * 100) / 100, price: data.c };
  } catch (e) {
    return { symbol, pct: 0, price: 0, error: String(e) };
  }
}

async function fetchQuoteCandle(symbol: string, fromTs: number): Promise<QuoteResult> {
  try {
    const toTs = Math.floor(Date.now() / 1000);
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${FINNHUB_KEY}`;
    const res = await fetch(url);
    if (res.status === 429) return { symbol, pct: 0, price: 0, error: "rate_limited" };
    const data = await res.json();

    // Finnhub returns { s: "no_data" } when no candles
    if (!data || data.s === "no_data" || !data.o || !data.c || data.o.length === 0 || data.c.length === 0) {
      return { symbol, pct: 0, price: 0, error: "no_data" };
    }

    const firstOpen = data.o[0];
    const lastClose = data.c[data.c.length - 1];
    if (firstOpen === 0) return { symbol, pct: 0, price: lastClose, error: "no_data" };

    const pct = ((lastClose - firstOpen) / firstOpen) * 100;
    return { symbol, pct: Math.round(pct * 100) / 100, price: lastClose };
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

    const { data: dbThemes } = await sb.from("themes").select("id, name, description");
    const { data: dbTickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) throw new Error("Failed to read themes from database");

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
    const timeframe = url.searchParams.get("timeframe") || "Today";

    let themeEntries: { id: string; name: string; description: string | null; symbols: string[] }[];

    if (themesParam) {
      const requested = themesParam.split(",").map(t => t.trim());
      themeEntries = Array.from(themeTickerMap.entries())
        .filter(([, v]) => requested.includes(v.name))
        .map(([id, v]) => ({ id, ...v }));
    } else {
      themeEntries = Array.from(themeTickerMap.entries())
        .filter(([, v]) => v.symbols.length > 0)
        .map(([id, v]) => ({ id, ...v }));
    }

    const uniqueSymbols = [...new Set(themeEntries.flatMap(t => t.symbols))];
    const fromTs = getTimeframeFromTs(timeframe);
    const useCandles = timeframe !== "Today" && fromTs > 0;

    console.log(`Fetching ${uniqueSymbols.length} symbols for ${themeEntries.length} themes, timeframe=${timeframe}, useCandles=${useCandles}`);

    const quoteMap: Record<string, QuoteResult> = {};
    const batchSize = 10;
    let rateLimited = false;

    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(s => useCandles ? fetchQuoteCandle(s, fromTs) : fetchQuoteDaily(s))
      );
      for (const r of results) quoteMap[r.symbol] = r;

      if (results.some(r => r.error === "rate_limited")) {
        rateLimited = true;
        break;
      }

      if (i + batchSize < uniqueSymbols.length) {
        await new Promise(r => setTimeout(r, 1200));
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

    const allThemeNames = Array.from(themeTickerMap.values()).map(v => v.name);

    return new Response(
      JSON.stringify({
        themes,
        fetched_at: new Date().toISOString(),
        symbols_fetched: Object.keys(quoteMap).length,
        rate_limited: rateLimited,
        available_themes: allThemeNames,
        timeframe,
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
