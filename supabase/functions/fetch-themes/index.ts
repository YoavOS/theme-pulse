const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { getHistoricalData, makeServiceClient, YahooPeriod } from "../_shared/yahooHistory.ts";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";

interface QuoteResult {
  symbol: string;
  pct: number;
  price: number;
  error?: string;
}

// Map our UI timeframe label → YahooPeriod for the historical helper.
function timeframeToYahooPeriod(timeframe: string): YahooPeriod | null {
  switch (timeframe) {
    case "1W": return "5d";
    case "1M": return "1mo";
    case "3M": return "3mo";
    case "6M": return "6mo";
    case "YTD": return "ytd";
    default: return null; // "Today" — uses Finnhub /quote
  }
}

// Today: Finnhub /quote (still works on free tier).
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

// Historical timeframe via shared Yahoo helper (cache → EOD → Yahoo).
async function fetchHistoricalQuote(
  sb: ReturnType<typeof makeServiceClient>,
  symbol: string,
  period: YahooPeriod
): Promise<QuoteResult> {
  const r = await getHistoricalData(sb, symbol, period);
  if (r.returnPct === null || r.endPrice === null) {
    return { symbol, pct: 0, price: 0, error: "no_data" };
  }
  return { symbol, pct: r.returnPct, price: r.endPrice };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = makeServiceClient();

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
    const yahooPeriod = timeframeToYahooPeriod(timeframe);
    const useHistorical = yahooPeriod !== null;

    console.log(`Fetching ${uniqueSymbols.length} symbols for ${themeEntries.length} themes, timeframe=${timeframe}, useHistorical=${useHistorical}`);

    const quoteMap: Record<string, QuoteResult> = {};
    let rateLimited = false;

    if (useHistorical) {
      // Historical: shared helper (cache → EOD → Yahoo). Small batch since Yahoo is slower.
      const batchSize = 5;
      for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
        const batch = uniqueSymbols.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(s => fetchHistoricalQuote(sb, s, yahooPeriod!)));
        for (const r of results) quoteMap[r.symbol] = r;
      }
    } else {
      // Today: Finnhub /quote (still works on free tier).
      const batchSize = 10;
      for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
        const batch = uniqueSymbols.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(s => fetchQuoteDaily(s)));
        for (const r of results) quoteMap[r.symbol] = r;
        if (results.some(r => r.error === "rate_limited")) { rateLimited = true; break; }
        if (i + batchSize < uniqueSymbols.length) await new Promise(r => setTimeout(r, 1200));
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
