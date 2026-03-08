import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FundamentalsData {
  symbol: string;
  revenue_growth_1y: number | null;
  revenue_growth_3y: number | null;
  eps_growth_1y: number | null;
  eps_growth_3y: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  cash_per_share: number | null;
  free_cash_flow: number | null;
  target_high: number | null;
  target_low: number | null;
  target_mean: number | null;
  analyst_rating: string | null;
  market_cap: number | null;
  sector: string | null;
  stock_type: string | null;
  fundamental_score: number | null;
  ai_summary: string | null;
  last_updated: string | null;
  // Valuation
  pe_ratio: number | null;
  forward_pe: number | null;
  ps_ratio: number | null;
  pb_ratio: number | null;
  ev_ebitda: number | null;
  peg_ratio: number | null;
  valuation_score: number | null;
  valuation_label: string | null;
  // Smart Money
  institutional_ownership_pct: number | null;
  institutional_change: number | null;
  top_institutions: any[] | null;
  insider_sentiment_score: number | null;
  insider_sentiment_label: string | null;
  recent_insider_buys: number | null;
  recent_insider_sells: number | null;
  smart_money_score: number | null;
  smart_money_label: string | null;
}

interface FundamentalsCache {
  [key: string]: { data: Record<string, FundamentalsData>; fetchedAt: number };
}

const CACHE_TTL = 24 * 60 * 60 * 1000;

export function getScoreLabel(score: number): { text: string; color: string } {
  if (score >= 80) return { text: "Excellent fundamentals", color: "text-[#00f5c4]" };
  if (score >= 60) return { text: "Good fundamentals", color: "text-gain-medium" };
  if (score >= 40) return { text: "Mixed fundamentals", color: "text-[#facc15]" };
  if (score >= 20) return { text: "Weak fundamentals", color: "text-[#f5a623]" };
  return { text: "Poor fundamentals", color: "text-destructive" };
}

export function getScoreBadgeColor(score: number): string {
  if (score >= 70) return "text-primary bg-primary/10 border-primary/20";
  if (score >= 50) return "text-gain-medium bg-gain-medium/10 border-gain-medium/20";
  if (score >= 30) return "text-[#f5a623] bg-[#f5a623]/10 border-[#f5a623]/20";
  return "text-destructive bg-destructive/10 border-destructive/20";
}

export function getStockTypeInfo(type: string | null): { emoji: string; label: string; color: string } {
  switch (type) {
    case "growth": return { emoji: "🚀", label: "Growth", color: "text-primary bg-primary/15 border-primary/30" };
    case "value": return { emoji: "💎", label: "Value", color: "text-gain-medium bg-gain-medium/15 border-gain-medium/30" };
    case "blend": return { emoji: "⚖️", label: "Blend", color: "text-[#60a5fa] bg-[#60a5fa]/15 border-[#60a5fa]/30" };
    case "speculative": return { emoji: "⚠️", label: "Speculative", color: "text-[#f5a623] bg-[#f5a623]/15 border-[#f5a623]/30" };
    default: return { emoji: "—", label: "Unknown", color: "text-muted-foreground bg-secondary/60 border-border" };
  }
}

export function getValuationColor(label: string | null): string {
  switch (label) {
    case "Undervalued": return "text-[#00f5c4]";
    case "Fairly valued": return "text-gain-medium";
    case "Premium valuation": return "text-[#f5a623]";
    case "Expensive":
    case "Very expensive": return "text-destructive";
    case "Not yet profitable": return "text-[#f5a623]";
    default: return "text-muted-foreground";
  }
}

export function getSmartMoneyColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score > 75) return "text-[#00f5c4]";
  if (score > 50) return "text-gain-medium";
  if (score > 25) return "text-[#f5a623]";
  return "text-muted-foreground";
}

export function getMetricDot(value: number | null, thresholds: { green: number; yellow: number; reverse?: boolean }): string {
  if (value === null) return "bg-muted-foreground/30";
  if (thresholds.reverse) {
    if (value <= thresholds.green) return "bg-gain-medium";
    if (value <= thresholds.yellow) return "bg-[#facc15]";
    return "bg-destructive";
  }
  if (value >= thresholds.green) return "bg-gain-medium";
  if (value >= thresholds.yellow) return "bg-[#facc15]";
  return "bg-destructive";
}

export function useFundamentals() {
  const [cache, setCache] = useState<FundamentalsCache>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const prefetchingRef = useRef(false);

  const getCacheKey = useCallback((symbols: string[]) => {
    return [...new Set(symbols)].sort().join(",");
  }, []);

  const fetchFundamentals = useCallback(async (symbols: string[]): Promise<Record<string, FundamentalsData>> => {
    const key = getCacheKey(symbols);
    const cached = cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }

    setLoading(prev => new Set(prev).add(key));

    try {
      const uniqueSymbols = [...new Set(symbols)];
      const result = await supabase.functions.invoke("fetch-fundamentals", {
        body: { symbols: uniqueSymbols },
      });

      if (result.error) {
        console.error("Fundamentals fetch error:", result.error);
        return {};
      }

      const fundamentals: Record<string, FundamentalsData> = result.data?.fundamentals || {};
      setCache(prev => ({ ...prev, [key]: { data: fundamentals, fetchedAt: Date.now() } }));
      return fundamentals;
    } catch (e) {
      console.error("Fundamentals fetch failed:", e);
      return {};
    } finally {
      setLoading(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [cache, getCacheKey]);

  const getCachedFundamentals = useCallback((symbols: string[]): Record<string, FundamentalsData> | null => {
    const key = getCacheKey(symbols);
    const cached = cache[key];
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }
    return null;
  }, [cache, getCacheKey]);

  const isLoading = useCallback((symbols: string[]) => {
    return loading.has(getCacheKey(symbols));
  }, [loading, getCacheKey]);

  const getThemeFundamentalScore = useCallback((symbols: string[]): number | null => {
    const data = getCachedFundamentals(symbols);
    if (!data) return null;
    const scores = Object.values(data)
      .map(d => d.fundamental_score)
      .filter((s): s is number => s !== null);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [getCachedFundamentals]);

  const prefetchTopThemes = useCallback(async (
    themes: { symbols: string[] }[]
  ) => {
    if (prefetchingRef.current) return;
    prefetchingRef.current = true;

    for (const theme of themes.slice(0, 10)) {
      const key = getCacheKey(theme.symbols);
      if (cache[key] && Date.now() - cache[key].fetchedAt < CACHE_TTL) continue;
      await fetchFundamentals(theme.symbols);
      await new Promise(r => setTimeout(r, 500));
    }

    prefetchingRef.current = false;
  }, [cache, getCacheKey, fetchFundamentals]);

  return {
    fetchFundamentals,
    getCachedFundamentals,
    getThemeFundamentalScore,
    isLoading,
    prefetchTopThemes,
  };
}
