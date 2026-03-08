import { useState, useCallback, useRef } from "react";
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

export interface SentimentData {
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  score: number;
  reasoning: string | null;
}

interface AiSummaryCache {
  [themeName: string]: { summary: string; generatedAt: string; sentiment?: SentimentData | null };
}

const NEGATIVE_KEYWORDS = ["crash", "warning", "investigation", "lawsuit", "decline", "fraud", "recall", "layoff", "default", "bankruptcy"];

export const POSITIVE_KEYWORDS = ["beat", "record", "growth", "partnership", "upgrade", "raises", "wins", "expands", "approves", "strong", "surge", "rally", "breakout", "soars"];
export const NEGATIVE_HEADLINE_KEYWORDS = ["miss", "cut", "investigation", "downgrade", "concern", "decline", "lawsuit", "warning", "loses", "drops", "crash", "recall", "fraud", "layoff"];

export function getHeadlineSentimentTag(headline: string): "positive" | "negative" | "neutral" {
  const lower = headline.toLowerCase();
  if (POSITIVE_KEYWORDS.some(k => lower.includes(k))) return "positive";
  if (NEGATIVE_HEADLINE_KEYWORDS.some(k => lower.includes(k))) return "negative";
  return "neutral";
}

export function hasNegativeNews(articles: NewsArticle[]): boolean {
  return articles.some(a =>
    NEGATIVE_KEYWORDS.some(kw => a.headline.toLowerCase().includes(kw))
  );
}

// Per-theme news cache: theme symbols → articles
interface ThemeNewsCache {
  [key: string]: { articles: NewsArticle[]; fetchedAt: number };
}

export function useThemeNews() {
  // Per-theme cache keyed by sorted symbol string
  const [themeCache, setThemeCache] = useState<ThemeNewsCache>({});
  const [marketNews, setMarketNews] = useState<NewsArticle[]>([]);
  const [marketFetchedAt, setMarketFetchedAt] = useState<number>(0);
  const [aiSummaries, setAiSummaries] = useState<AiSummaryCache>({});
  const [prefetchedThemes, setPrefetchedThemes] = useState<Set<string>>(new Set());
  const prefetchingRef = useRef(false);

  const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

  // Get cache key from symbols
  const getCacheKey = useCallback((symbols: string[]) => {
    return [...new Set(symbols)].sort().join(",");
  }, []);

  // Check if we have valid cached data for these symbols
  const hasCachedNews = useCallback((symbols: string[]) => {
    const key = getCacheKey(symbols);
    const cached = themeCache[key];
    return cached && (Date.now() - cached.fetchedAt < CACHE_TTL);
  }, [themeCache, getCacheKey]);

  // Fetch news for specific symbols (on-demand, for one theme)
  const fetchThemeNews = useCallback(async (symbols: string[]): Promise<NewsArticle[]> => {
    const key = getCacheKey(symbols);

    // Return from cache if fresh
    const cached = themeCache[key];
    if (cached && (Date.now() - cached.fetchedAt < CACHE_TTL)) {
      return cached.articles;
    }

    try {
      const uniqueSymbols = [...new Set(symbols)].slice(0, 8);
      const result = await supabase.functions.invoke("fetch-theme-news", {
        body: { symbols: uniqueSymbols, categories: [] },
      });

      if (result.error) {
        console.error("News fetch error:", result.error);
        return [];
      }

      const bySymbol = result.data?.bySymbol || {};
      const articles: NewsArticle[] = [];
      const seen = new Set<string>();
      for (const sym of uniqueSymbols) {
        for (const a of (bySymbol[sym] || [])) {
          if (!seen.has(a.url)) {
            seen.add(a.url);
            articles.push(a);
          }
        }
      }

      // Sort by recency
      articles.sort((a, b) => {
        const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
        const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
        return tb - ta;
      });

      setThemeCache(prev => ({ ...prev, [key]: { articles, fetchedAt: Date.now() } }));
      return articles;
    } catch (e) {
      console.error("News fetch failed:", e);
      return [];
    }
  }, [themeCache, getCacheKey]);

  // Fetch general market news only (for Insights tab)
  const fetchMarketNews = useCallback(async () => {
    if (Date.now() - marketFetchedAt < CACHE_TTL) return marketNews;

    try {
      const result = await supabase.functions.invoke("fetch-theme-news", {
        body: { symbols: [], categories: ["general"] },
      });

      if (result.error) return [];

      const articles: NewsArticle[] = result.data?.market || [];
      setMarketNews(articles);
      setMarketFetchedAt(Date.now());
      return articles;
    } catch {
      return [];
    }
  }, [marketFetchedAt, marketNews]);

  // Prefetch news for top N themes (background, rate-limited)
  const prefetchTopThemes = useCallback(async (
    themes: { name: string; symbols: string[] }[]
  ) => {
    if (prefetchingRef.current) return;
    prefetchingRef.current = true;

    const top5 = themes.slice(0, 5);
    for (const theme of top5) {
      const key = getCacheKey(theme.symbols);
      if (themeCache[key] && (Date.now() - themeCache[key].fetchedAt < CACHE_TTL)) {
        setPrefetchedThemes(prev => new Set(prev).add(theme.name));
        continue;
      }

      try {
        const articles = await fetchThemeNews(theme.symbols);
        setPrefetchedThemes(prev => new Set(prev).add(theme.name));
      } catch {}

      // 2s gap between theme fetches to stay well under rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    prefetchingRef.current = false;
  }, [getCacheKey, themeCache, fetchThemeNews]);

  // Get cached article count for badge (returns -1 if not fetched yet)
  const getThemeNewsCount = useCallback((symbols: string[]): number => {
    const key = getCacheKey(symbols);
    const cached = themeCache[key];
    if (!cached || (Date.now() - cached.fetchedAt >= CACHE_TTL)) return -1; // not yet fetched
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return cached.articles.filter(a =>
      a.published_at && new Date(a.published_at).getTime() > oneDayAgo
    ).length;
  }, [themeCache, getCacheKey]);

  // Get cached articles for a theme
  const getThemeArticles = useCallback((symbols: string[]): NewsArticle[] => {
    const key = getCacheKey(symbols);
    const cached = themeCache[key];
    if (!cached) return [];
    return cached.articles;
  }, [themeCache, getCacheKey]);

  const hasNegativeNewsForTheme = useCallback((symbols: string[]): boolean => {
    const articles = getThemeArticles(symbols);
    return hasNegativeNews(articles);
  }, [getThemeArticles]);

  const getAiSummary = useCallback(async (themeName: string, articles: NewsArticle[]): Promise<string | null> => {
    const cached = aiSummaries[themeName];
    if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL) {
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

      const sentimentData: SentimentData | null = result.data.sentiment && result.data.sentimentScore != null
        ? { sentiment: result.data.sentiment, score: result.data.sentimentScore, reasoning: result.data.sentimentReasoning || null }
        : null;

      setAiSummaries(prev => ({
        ...prev,
        [themeName]: {
          summary: result.data.summary,
          generatedAt: result.data.generatedAt,
          sentiment: sentimentData,
        },
      }));

      return result.data.summary as string;
    } catch {
      return null;
    }
  }, [aiSummaries]);

  // Get cached sentiment for a theme
  const getThemeSentiment = useCallback((themeName: string): SentimentData | null => {
    const cached = aiSummaries[themeName];
    if (!cached?.sentiment) return null;
    return cached.sentiment;
  }, [aiSummaries]);

  return {
    // On-demand fetch for a specific theme
    fetchThemeNews,
    // Market news for Insights
    fetchMarketNews,
    marketNews,
    // Prefetch top themes in background
    prefetchTopThemes,
    prefetchedThemes,
    // Badge helpers
    getThemeNewsCount,
    getThemeArticles,
    hasNegativeNews: hasNegativeNewsForTheme,
    // AI
    getAiSummary,
    aiSummaries,
    // Sentiment
    getThemeSentiment,
    // For backward compat — check if any news loaded
    news: Object.keys(themeCache).length > 0 ? themeCache : null,
    isLoading: false,
  };
}
