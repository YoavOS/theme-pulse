import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const NEWSDATA_KEY = Deno.env.get("NEWSDATA_API_KEY") || "";
const FINNHUB_DELAY_MS = 1100;
const NEWSDATA_DELAY_MS = 1200;
// Cache window — 45 minutes for combined news (per user request: 30-60 min)
const CACHE_TTL_MS = 45 * 60 * 1000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Article {
  symbol: string | null;
  category: string | null;
  headline: string;
  summary: string | null;
  url: string;
  source: string | null;
  published_at: string | null;
}

interface FinnhubNews {
  category?: string;
  datetime?: number;
  headline?: string;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

interface NewsDataItem {
  article_id?: string;
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  source_id?: string;
  source_name?: string;
  category?: string[];
}

// Normalize a headline for dedupe (lowercase, strip non-alpha, collapse spaces)
function normalizeForDedupe(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function dedupeArticles(articles: Article[]): Article[] {
  const seenUrl = new Set<string>();
  const seenKey = new Set<string>();
  const out: Article[] = [];
  for (const a of articles) {
    if (!a.headline || !a.url) continue;
    if (seenUrl.has(a.url)) continue;
    const key = `${normalizeForDedupe(a.headline)}|${(a.source || "").toLowerCase()}|${(a.published_at || "").slice(0, 10)}`;
    if (seenKey.has(key)) continue;
    seenUrl.add(a.url);
    seenKey.add(key);
    out.push(a);
  }
  return out;
}

function rankArticles(articles: Article[]): Article[] {
  const now = Date.now();
  return articles
    .map((a) => {
      const t = a.published_at ? new Date(a.published_at).getTime() : 0;
      const ageHours = t ? (now - t) / 3600000 : 999;
      // Recency-weighted score; newer = higher
      const score = Math.max(0, 100 - ageHours);
      return { a, score };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

// ---- NewsData.io fetchers ----
// Free plan: 200 credits/day, 1 request/sec. We'll keep it minimal.
async function fetchNewsDataForSymbols(symbols: string[]): Promise<Article[]> {
  if (!NEWSDATA_KEY || symbols.length === 0) return [];
  // Single query covering up to 5 symbols (NewsData supports OR via comma in q, max 100 chars)
  const q = symbols.slice(0, 5).join(" OR ");
  const url = `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(q)}&language=en&size=10`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`NewsData symbols query failed [${res.status}]`);
      return [];
    }
    const json = await res.json();
    const results: NewsDataItem[] = json.results || [];
    return results
      .filter((r) => r.title && r.link)
      .map((r) => ({
        symbol: null, // matched by query, not 1:1 to symbol
        category: "newsdata",
        headline: r.title!,
        summary: r.description || null,
        url: r.link!,
        source: r.source_name || r.source_id || null,
        published_at: r.pubDate ? new Date(r.pubDate).toISOString() : null,
      }));
  } catch (e) {
    console.log(`NewsData symbols error: ${e}`);
    return [];
  }
}

async function fetchNewsDataForCategory(category: string): Promise<Article[]> {
  if (!NEWSDATA_KEY) return [];
  // Map our 'general' to broad business/world coverage
  const cat = category === "general" ? "business,world,politics" : category;
  const url = `https://newsdata.io/api/1/latest?apikey=${NEWSDATA_KEY}&category=${encodeURIComponent(cat)}&language=en&size=10`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`NewsData category query failed [${res.status}]`);
      return [];
    }
    const json = await res.json();
    const results: NewsDataItem[] = json.results || [];
    return results
      .filter((r) => r.title && r.link)
      .map((r) => ({
        symbol: null,
        category,
        headline: r.title!,
        summary: r.description || null,
        url: r.link!,
        source: r.source_name || r.source_id || null,
        published_at: r.pubDate ? new Date(r.pubDate).toISOString() : null,
      }));
  } catch (e) {
    console.log(`NewsData category error: ${e}`);
    return [];
  }
}

// ---- Finnhub fetchers ----
async function fetchFinnhubForSymbol(sym: string, fromDate: string, toDate: string, sevenDaysAgoMs: number): Promise<Article[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${fromDate}&to=${toDate}&token=${FINNHUB_KEY}`
    );
    if (res.status === 429) {
      console.log(`Finnhub rate limited on ${sym}`);
      return [];
    }
    if (!res.ok) return [];
    const data: FinnhubNews[] = await res.json();
    return data
      .filter((n) => n.url && n.headline && (!n.datetime || n.datetime * 1000 >= sevenDaysAgoMs))
      .slice(0, 10)
      .map((n) => ({
        symbol: sym,
        category: null,
        headline: n.headline!,
        summary: n.summary || null,
        url: n.url!,
        source: n.source || null,
        published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
      }));
  } catch (e) {
    console.log(`Finnhub fetch failed for ${sym}: ${e}`);
    return [];
  }
}

async function fetchFinnhubForCategory(cat: string): Promise<Article[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=${encodeURIComponent(cat)}&token=${FINNHUB_KEY}`);
    if (!res.ok) return [];
    const data: FinnhubNews[] = await res.json();
    return data.slice(0, 15).map((n) => ({
      symbol: null,
      category: cat,
      headline: n.headline || "",
      summary: n.summary || null,
      url: n.url || "",
      source: n.source || null,
      published_at: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
    }));
  } catch (e) {
    console.log(`Finnhub category fetch failed for ${cat}: ${e}`);
    return [];
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

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "bad_request", message: "Invalid JSON" }, 400);
    }

    const { symbols = [], categories = [] } = payload;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const fromDate = sevenDaysAgo.toISOString().split("T")[0];
    const toDate = new Date().toISOString().split("T")[0];

    const symbolsToFetch: string[] = (symbols as string[]).slice(0, 8);
    const allArticles: Article[] = [];

    // News is fetched fresh every request — no persistent cache.
    // (Strict "lightweight DB" policy: temporary news data is never stored.)
    const symbolsNeedingFetch: string[] = [...symbolsToFetch];

    // ---------- Parallel fetch from both sources ----------
    const fetchTasks: Promise<{ articles: Article[] }>[] = [];

    if (symbolsNeedingFetch.length > 0) {
      fetchTasks.push((async () => {
        const out: Article[] = [];
        for (const sym of symbolsNeedingFetch) {
          const arts = await fetchFinnhubForSymbol(sym, fromDate, toDate, sevenDaysAgo.getTime());
          out.push(...arts);
          await delay(FINNHUB_DELAY_MS);
        }
        return { articles: out };
      })());
    }

    if (symbolsToFetch.length > 0) {
      fetchTasks.push((async () => {
        const arts = await fetchNewsDataForSymbols(symbolsToFetch);
        return { articles: arts };
      })());
    }

    for (const cat of categories as string[]) {
      fetchTasks.push((async () => {
        const [fh, nd] = await Promise.all([
          fetchFinnhubForCategory(cat),
          fetchNewsDataForCategory(cat),
        ]);
        return { articles: [...fh, ...nd] };
      })());
    }

    const results = await Promise.all(fetchTasks);
    for (const r of results) allArticles.push(...r.articles);

    // ---------- Dedupe + rank ----------
    const deduped = dedupeArticles(allArticles);
    const ranked = rankArticles(deduped);


    // ---------- 6. Group results ----------
    const bySymbol: Record<string, Article[]> = {};
    const market: Article[] = [];
    // Articles tagged with a specific symbol go to that bucket; everything else (NewsData broad,
    // category news) is shared across all requested symbols so the UI can surface thematic context.
    const sharedThematic: Article[] = [];
    for (const a of ranked) {
      if (a.symbol) {
        if (!bySymbol[a.symbol]) bySymbol[a.symbol] = [];
        bySymbol[a.symbol].push(a);
      } else if (a.category && (a.category.startsWith("newsdata") || symbolsToFetch.length > 0)) {
        sharedThematic.push(a);
      } else {
        market.push(a);
      }
    }
    // Distribute shared thematic news across requested symbols (so theme view sees broader context)
    for (const sym of symbolsToFetch) {
      if (!bySymbol[sym]) bySymbol[sym] = [];
      // Add up to 5 thematic articles per symbol bucket without duplicating existing URLs
      const existingUrls = new Set(bySymbol[sym].map((a) => a.url));
      let added = 0;
      for (const a of sharedThematic) {
        if (added >= 5) break;
        if (!existingUrls.has(a.url)) {
          bySymbol[sym].push(a);
          existingUrls.add(a.url);
          added++;
        }
      }
    }
    // Anything truly market-wide
    market.push(...sharedThematic.filter((a) => symbolsToFetch.length === 0));

    console.log(
      `Returning ${ranked.length} articles (Finnhub+NewsData, ${symbolsNeedingFetch.length} symbols fetched live, ${symbolsToFetch.length - symbolsNeedingFetch.length} from cache)`
    );

    return jsonResponse({
      bySymbol,
      market,
      totalArticles: ranked.length,
      sources: {
        finnhub: !!FINNHUB_KEY,
        newsdata: !!NEWSDATA_KEY,
      },
    });
  } catch (e) {
    console.error("Unhandled error in fetch-theme-news:", e);
    return jsonResponse({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});
