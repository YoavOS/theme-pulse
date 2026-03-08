import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface NewsArticle {
  symbol: string | null;
  category: string | null;
  headline: string;
  summary: string | null;
  url: string;
  source: string | null;
  published_at: string | null;
}

interface NewsState {
  bySymbol: Record<string, NewsArticle[]>;
  market: NewsArticle[];
  totalArticles: number;
  fetchedAt: string | null;
}

interface AiSummaryCache {
  [themeName: string]: { summary: string; generatedAt: string };
}

const NEGATIVE_KEYWORDS = ["crash", "warning", "investigation", "lawsuit", "decline", "fraud", "recall", "layoff", "default", "bankruptcy"];

export function hasNegativeNews(articles: NewsArticle[]): boolean {
  return articles.some(a =>
    NEGATIVE_KEYWORDS.some(kw => a.headline.toLowerCase().includes(kw))
  );
}

export function getThemeNewsCount(
  newsState: NewsState | null,
  symbols: string[]
): number {
  if (!newsState) return 0;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let count = 0;
  for (const sym of symbols) {
    const articles = newsState.bySymbol[sym] || [];
    count += articles.filter(a =>
      a.published_at && new Date(a.published_at).getTime() > oneDayAgo
    ).length;
  }
  return count;
}

export function getThemeArticles(
  newsState: NewsState | null,
  symbols: string[]
): NewsArticle[] {
  if (!newsState) return [];
  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const sym of symbols) {
    for (const a of (newsState.bySymbol[sym] || [])) {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        articles.push(a);
      }
    }
  }
  return articles.sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
    return tb - ta;
  });
}

export function useThemeNews() {
  const [news, setNews] = useState<NewsState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [aiSummaries, setAiSummaries] = useState<AiSummaryCache>({});
  const fetchedRef = useRef(false);
  const lastFetchRef = useRef<number>(0);

  const fetchNews = useCallback(async (symbols: string[]) => {
    // Throttle: don't fetch more than once per 5 minutes
    if (Date.now() - lastFetchRef.current < 5 * 60 * 1000 && fetchedRef.current) return;

    setIsLoading(true);
    try {
      // Deduplicate and limit symbols
      const uniqueSymbols = [...new Set(symbols)].slice(0, 15);

      const result = await supabase.functions.invoke("fetch-theme-news", {
        body: { symbols: uniqueSymbols, categories: ["general"] },
      });

      if (result.error) {
        console.error("News fetch error:", result.error);
        return;
      }

      setNews({
        bySymbol: result.data.bySymbol || {},
        market: result.data.market || [],
        totalArticles: result.data.totalArticles || 0,
        fetchedAt: new Date().toISOString(),
      });
      fetchedRef.current = true;
      lastFetchRef.current = Date.now();
    } catch (e) {
      console.error("News fetch failed:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAiSummary = useCallback(async (themeName: string, articles: NewsArticle[]) => {
    // Check cache (4-hour TTL)
    const cached = aiSummaries[themeName];
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < 4 * 60 * 60 * 1000) {
      return cached.summary;
    }

    if (articles.length === 0) return null;

    try {
      const result = await supabase.functions.invoke("summarize-theme-news", {
        body: {
          themeName,
          headlines: articles.slice(0, 10).map(a => ({
            headline: a.headline,
            source: a.source,
            symbol: a.symbol,
          })),
        },
      });

      if (result.error || !result.data?.summary) return null;

      setAiSummaries(prev => ({
        ...prev,
        [themeName]: { summary: result.data.summary, generatedAt: result.data.generatedAt },
      }));

      return result.data.summary as string;
    } catch {
      return null;
    }
  }, [aiSummaries]);

  return {
    news,
    isLoading,
    fetchNews,
    getThemeNewsCount: useCallback((symbols: string[]) => getThemeNewsCount(news, symbols), [news]),
    getThemeArticles: useCallback((symbols: string[]) => getThemeArticles(news, symbols), [news]),
    hasNegativeNews: useCallback((symbols: string[]) => {
      const articles = getThemeArticles(news, symbols);
      return hasNegativeNews(articles);
    }, [news]),
    getAiSummary,
    aiSummaries,
    marketNews: news?.market || [],
  };
}
