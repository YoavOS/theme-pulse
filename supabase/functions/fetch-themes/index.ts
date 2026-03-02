const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALPHA_VANTAGE_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY") || "";

// Theme -> ticker mappings
const THEME_TICKERS: Record<string, string[]> = {
  "Fiber Optics & Connectivity": ["AAOI", "LITE", "COHR", "VIAV", "CIEN"],
  "AI Infrastructure / Data Centers": ["VRT", "EQIX", "DLR", "ANET", "SMCI"],
  "GPU / AI Chips": ["NVDA", "AMD", "AVGO", "MRVL", "QCOM"],
  "Uranium & Nuclear Revival": ["CCJ", "LEU", "UEC", "NXE", "DNN"],
  "Quantum Computing": ["IONQ", "RGTI", "QUBT"],
  "Drone & Autonomous Systems": ["AVAV", "JOBY", "ACHR", "RKLB"],
  "Defense & Robotics": ["LMT", "RTX", "NOC", "LHX", "PLTR"],
  "Space Economy": ["ASTS", "RKLB", "LUNR"],
  "Cybersecurity": ["CRWD", "PANW", "ZS", "FTNT", "S"],
  "Semiconductors": ["TSM", "ASML", "KLAC", "LRCX", "AMAT"],
  "Gold & Precious Metals": ["NEM", "GOLD", "AEM", "GFI"],
  "AI Software / Agents": ["PLTR", "AI", "PATH"],
  "Electric Vehicles & Battery": ["TSLA", "RIVN", "LCID", "NIO"],
  "Solar Energy": ["ENPH", "SEDG", "FSLR", "RUN"],
  "Crypto & Blockchain": ["COIN", "MSTR", "MARA", "RIOT"],
  "Critical Minerals / Rare Earths": ["MP", "UUUU", "LAC"],
  "Copper & Base Metals": ["FCX", "SCCO", "TECK"],
  "Robotics & Industrial Automation": ["ISRG", "ROK", "TER"],
  "Fintech & Digital Payments": ["SQ", "PYPL", "AFRM", "SOFI"],
  "SaaS & Cloud Software": ["NOW", "CRM", "SNOW", "DDOG"],
};

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
      console.log(`Rate limited on ${symbol}:`, data["Note"] || data["Information"]);
      return { symbol, pct: 0, price: 0, error: "rate_limited" };
    }

    const quote = data["Global Quote"];
    if (!quote || !quote["10. change percent"]) {
      console.log(`No data for ${symbol}`);
      return { symbol, pct: 0, price: 0, error: "no_data" };
    }

    const pct = parseFloat(quote["10. change percent"].replace("%", ""));
    const price = parseFloat(quote["05. price"]);
    console.log(`${symbol}: ${pct}% @ $${price}`);
    return { symbol, pct, price };
  } catch (e) {
    console.error(`Error fetching ${symbol}:`, e);
    return { symbol, pct: 0, price: 0, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const themesParam = url.searchParams.get("themes");
    // Limit how many themes to fetch (default 3 for free tier friendliness)
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "3"), 20);

    let themeEntries: [string, string[]][];
    if (themesParam) {
      const requested = themesParam.split(",").map(t => t.trim());
      themeEntries = requested
        .filter(name => THEME_TICKERS[name])
        .map(name => [name, THEME_TICKERS[name]]);
    } else {
      themeEntries = Object.entries(THEME_TICKERS).slice(0, limit);
    }

    // Collect unique symbols
    const uniqueSymbols = [...new Set(themeEntries.flatMap(([, s]) => s))];
    console.log(`Fetching ${uniqueSymbols.length} unique symbols for ${themeEntries.length} themes`);

    // Alpha Vantage free: 25/day, 5/min. Fetch all at once (up to ~15 symbols for 3 themes).
    // For larger batches, we do sequential with small delays.
    const quoteMap: Record<string, QuoteResult> = {};

    // Fetch up to 5 concurrently, then wait 12s per extra batch
    const batchSize = 5;
    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchQuote));
      for (const r of results) {
        quoteMap[r.symbol] = r;
      }
      // Check if first batch was rate limited — if so, stop early
      if (results.some(r => r.error === "rate_limited")) {
        console.log("Rate limited, stopping early");
        break;
      }
      // Small delay between batches (not 65s — accept some may fail)
      if (i + batchSize < uniqueSymbols.length) {
        await new Promise(r => setTimeout(r, 12000));
      }
    }

    // Build theme results
    const themes = themeEntries.map(([theme_name, symbols]) => {
      const tickers = symbols.map(s => {
        const q = quoteMap[s];
        return { symbol: s, pct: q?.pct ?? 0, price: q?.price ?? 0 };
      }).sort((a, b) => b.pct - a.pct);

      const up_count = tickers.filter(t => t.pct > 0).length;
      const down_count = tickers.filter(t => t.pct <= 0).length;
      const performance_pct = tickers.length > 0
        ? tickers.reduce((sum, t) => sum + t.pct, 0) / tickers.length
        : 0;

      return {
        theme_name,
        performance_pct: Math.round(performance_pct * 100) / 100,
        up_count,
        down_count,
        tickers,
      };
    });

    const rateLimited = Object.values(quoteMap).some(q => q.error === "rate_limited");

    return new Response(
      JSON.stringify({
        themes,
        fetched_at: new Date().toISOString(),
        symbols_fetched: Object.keys(quoteMap).length,
        rate_limited: rateLimited,
        available_themes: Object.keys(THEME_TICKERS),
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
