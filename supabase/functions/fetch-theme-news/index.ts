import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const CALL_DELAY_MS = 350; // ~3 calls/sec

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

    const { symbols = [], categories = ["general"] } = payload;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
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
        // Filter articles older than 7 days
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

    // Fetch company news for each symbol (limit to 15 symbols to stay within rate limits)
    const symbolsToFetch = (symbols as string[]).slice(0, 15);
    for (const sym of symbolsToFetch) {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${fromDate}&to=${toDate}&token=${FINNHUB_KEY}`
        );
        if (res.ok) {
          const data: FinnhubNews[] = await res.json();
          // Take top 10 per symbol
          addArticles(data.slice(0, 10), sym, null);
        }
      } catch (e) {
        console.log(`News fetch failed for ${sym}: ${e}`);
      }
      await delay(CALL_DELAY_MS);
    }

    // Fetch market news by category
    for (const cat of categories as string[]) {
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

    // Upsert into news_cache
    if (allArticles.length > 0) {
      // Batch upsert in groups of 50
      for (let i = 0; i < allArticles.length; i += 50) {
        const batch = allArticles.slice(i, i + 50).map(a => ({
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

    console.log(`Fetched ${allArticles.length} articles (${symbolsToFetch.length} symbols, ${categories.length} categories)`);

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
