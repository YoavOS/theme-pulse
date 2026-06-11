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
  pct_today?: number;
  pct_1w?: number;
  pct_1m?: number;
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

    case "1W": return "5d";
    case "1M": return "1mo";
    case "3M": return "3mo";
    case "6M": return "6mo";
    case "YTD": return "ytd";
    default: return null; // "Today" — uses Finnhub /quote
  }
}

// Today: Yahoo /chart first (range=5d), Finnhub /quote as fallback.
async function fetchYahooDaily(symbol: string): Promise<QuoteResult | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice);
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (!price || !prev) return null;
    const pct = Math.round(((price - prev) / prev) * 10000) / 100;
    return { symbol, pct, price };
  } catch { return null; }
}

async function fetchQuoteDaily(symbol: string): Promise<QuoteResult> {
  const y = await fetchYahooDaily(symbol);
  if (y) return y;
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

// Overall: read 6mo cache once → derive today/1W/1M → weighted blend (50/30/20).
// Storage- and cloud-efficient: single cache row per symbol, no extra writes,
// and only triggers a Yahoo fetch when the cache row is missing/stale.
const OVERALL_W_TODAY = 0.5;
const OVERALL_W_1W = 0.3;
const OVERALL_W_1M = 0.2;

async function fetchOverallQuote(
  sb: ReturnType<typeof makeServiceClient>,
  symbol: string
): Promise<QuoteResult> {
  let ohlc: any[] | null = null;

  const cached = await sb
    .from("yahoo_history_cache")
    .select("ohlc")
    .eq("symbol", symbol)
    .eq("period", "6mo")
    .gte("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();

  if (cached.data?.ohlc && Array.isArray(cached.data.ohlc)) {
    ohlc = cached.data.ohlc;
  } else {
    // Trigger a single 6mo fetch (writes cache). Reuse helper to share rate limiting.
    await getHistoricalData(sb, symbol, "6mo");
    const re = await sb
      .from("yahoo_history_cache")
      .select("ohlc")
      .eq("symbol", symbol)
      .eq("period", "6mo")
      .maybeSingle();
    if (re.data?.ohlc && Array.isArray(re.data.ohlc)) ohlc = re.data.ohlc;
  }

  if (!ohlc || ohlc.length < 2) {
    return { symbol, pct: 0, price: 0, pct_today: 0, pct_1w: 0, pct_1m: 0, error: "no_data" };
  }

  const closes = ohlc.filter((b: any) => b?.close != null);
  if (closes.length < 2) return { symbol, pct: 0, price: 0, error: "no_data" };

  const end = Number(closes[closes.length - 1].close);
  const findStart = (daysBack: number): number | null => {
    const cutoff = Math.floor(Date.now() / 1000) - daysBack * 86400;
    const slice = closes.filter((b: any) => b.ts >= cutoff);
    return slice.length > 0 ? Number(slice[0].close) : null;
  };
  const todayStart = Number(closes[closes.length - 2].close);
  const w1Start = findStart(7);
  const m1Start = findStart(30);
  const ret = (s: number | null) =>
    s && end && s > 0 ? Math.round(((end - s) / s) * 10000) / 100 : null;

  const pT = ret(todayStart);
  const pW = ret(w1Start);
  const pM = ret(m1Start);

  let num = 0, den = 0;
  if (pT !== null) { num += OVERALL_W_TODAY * pT; den += OVERALL_W_TODAY; }
  if (pW !== null) { num += OVERALL_W_1W * pW; den += OVERALL_W_1W; }
  if (pM !== null) { num += OVERALL_W_1M * pM; den += OVERALL_W_1M; }
  const pct = den > 0 ? Math.round((num / den) * 100) / 100 : 0;

  return {
    symbol,
    pct,
    price: end,
    pct_today: pT ?? 0,
    pct_1w: pW ?? 0,
    pct_1m: pM ?? 0,
  };
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
    const isOverall = timeframe === "Overall";
    const yahooPeriod = isOverall ? null : timeframeToYahooPeriod(timeframe);
    const useHistorical = yahooPeriod !== null;


    console.log(`Fetching ${uniqueSymbols.length} symbols for ${themeEntries.length} themes, timeframe=${timeframe}, useHistorical=${useHistorical}`);

    const quoteMap: Record<string, QuoteResult> = {};
    let rateLimited = false;

    // Yahoo-first means we can fan out aggressively for both today and historical.
    const CONCURRENCY = isOverall ? 15 : 25;
    const fetcher = isOverall
      ? (s: string) => fetchOverallQuote(sb, s)
      : useHistorical
        ? (s: string) => fetchHistoricalQuote(sb, s, yahooPeriod!)
        : (s: string) => fetchQuoteDaily(s);


    let cursor = 0;
    const runWorker = async () => {
      while (cursor < uniqueSymbols.length) {
        const idx = cursor++;
        const r = await fetcher(uniqueSymbols[idx]);
        quoteMap[r.symbol] = r;
        if (r.error === "rate_limited") rateLimited = true;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, uniqueSymbols.length) }, () => runWorker())
    );

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
