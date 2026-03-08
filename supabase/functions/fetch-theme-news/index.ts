import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CALL_DELAY_MS = 1100; // 1 call/sec — safe for 60/min free tier

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FinnhubNews {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON" }, 400);
    }

    const { symbols = [], categories = [] } = payload;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const fourHoursAgo = new Date(Date.now() - 4 * 3600000).toISOString();
    const fromDate = sevenDaysAgo.toISOString().split("T")[0];
    const toDate = new Date().toISOString().split("T")[0];

    const allArticles: {
      symbol: string | null;
      category: string | null;
      headline: string;
      summary: string | null;
      url: string;
      source: string | null;
      published_at: string | null;
    }[] = [];
    const seenUrls = new Set<string>();

    const addArticles = (items: FinnhubNews[], sym: string | null, cat: string | null) => {
      for (const item of items) {
        if (!item.url || !item.headline) continue;
        if (seenUrls.has(item.url)) continue;
        if (item.datetime && item.datetime * 1000 < sevenDaysAgo.getTime()) continue;
        seenUrls.add(item.url);
        allArticles.push({
          symbol: sym,
          category: cat,
          headline: item.headline,
          summary: item.summary || null,
          url: item.url,
          source: item.source || null,
          published_at: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
        });
      }
    };

    // 1. Check cache first for each symbol
    const symbolsToFetch = (symbols as string[]).slice(0, 8); // max 8 symbols per call
    const symbolsNeedingFetch: string[] = [];

    for (const sym of symbolsToFetch) {
      const { data: cached } = await sb
        .from("news_cache")
        .select("symbol, category, headline, summary, url, source, published_at")
        .eq("symbol", sym)
        .gte("fetched_at", fourHoursAgo)
        .limit(10);

      if (cached && cached.length > 0) {
        // Serve from cache
        for (const row of cached) {
          if (row.url && !seenUrls.has(row.url)) {
            seenUrls.add(row.url);
            allArticles.push({
              symbol: row.symbol,
              category: row.category,
              headline: row.headline,
              summary: row.summary,
              url: row.url,
              source: row.source,
              published_at: row.published_at,
            });
          }
        }
        console.log(`Cache hit for ${sym}: ${cached.length} articles`);
      } else {
        symbolsNeedingFetch.push(sym);
      }
    }

    // 2. Fetch from Finnhub only for uncached symbols
    for (const sym of symbolsNeedingFetch) {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${fromDate}&to=${toDate}&token=${FINNHUB_KEY}`
        );
        if (res.status === 429) {
          console.log(`Rate limited on ${sym}, stopping symbol fetches`);
          break; // Stop fetching more symbols on rate limit
        }
        if (res.ok) {
          const data: FinnhubNews[] = await res.json();
          addArticles(data.slice(0, 10), sym, null);
          console.log(`Fetched ${Math.min(data.length, 10)} articles for ${sym}`);
        }
      } catch (e) {
        console.log(`News fetch failed for ${sym}: ${e}`);
      }
      await delay(CALL_DELAY_MS);
    }

    // 3. Fetch market news by category (also cache-checked)
    for (const cat of (categories as string[])) {
      const { data: cached } = await sb
        .from("news_cache")
        .select("symbol, category, headline, summary, url, source, published_at")
        .eq("category", cat)
        .is("symbol", null)
        .gte("fetched_at", fourHoursAgo)
        .limit(15);

      if (cached && cached.length > 0) {
        for (const row of cached) {
          if (row.url && !seenUrls.has(row.url)) {
            seenUrls.add(row.url);
            allArticles.push({
              symbol: null,
              category: row.category,
              headline: row.headline,
              summary: row.summary,
              url: row.url,
              source: row.source,
              published_at: row.published_at,
            });
          }
        }
        console.log(`Cache hit for category ${cat}: ${cached.length} articles`);
      } else {
        try {
          const res = await fetch(
            `https://finnhub.io/api/v1/news?category=${encodeURIComponent(cat)}&token=${FINNHUB_KEY}`
          );
          if (res.ok) {
            const data: FinnhubNews[] = await res.json();
            addArticles(data.slice(0, 15), null, cat);
          }
        } catch (e) {
          console.log(`Market news fetch failed for ${cat}: ${e}`);
        }
        await delay(CALL_DELAY_MS);
      }
    }

    // 4. Upsert new articles into cache
    const newArticles = allArticles.filter(a => !a.published_at || true); // upsert all
    if (newArticles.length > 0) {
      for (let i = 0; i < newArticles.length; i += 50) {
        const batch = newArticles.slice(i, i + 50).map(a => ({
          ...a,
          fetched_at: new Date().toISOString(),
        }));
        await sb.from("news_cache").upsert(batch, { onConflict: "url", ignoreDuplicates: true });
      }
    }

    // Group results
    const bySymbol: Record<string, typeof allArticles> = {};
    const market: typeof allArticles = [];
    for (const a of allArticles) {
      if (a.symbol) {
        if (!bySymbol[a.symbol]) bySymbol[a.symbol] = [];
        bySymbol[a.symbol].push(a);
      } else {
        market.push(a);
      }
    }

    console.log(`Returning ${allArticles.length} articles (${symbolsNeedingFetch.length} fetched from API, ${symbolsToFetch.length - symbolsNeedingFetch.length} from cache)`);

    return jsonResponse({
      bySymbol,
      market,
      totalArticles: allArticles.length,
    });
  } catch (e) {
    console.error("Unhandled error in fetch-theme-news:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
