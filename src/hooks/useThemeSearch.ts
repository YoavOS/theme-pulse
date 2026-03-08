import { useState, useCallback, useRef, useEffect } from "react";
import { ThemeData } from "@/data/themeData";

const HISTORY_KEY = "themeSearchHistory";
const MAX_HISTORY = 5;
const DEBOUNCE_MS = 800;

interface SearchResult {
  matchingThemes: string[];
  explanation: string;
}

export function useThemeSearch(themes: ThemeData[]) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch { return []; }
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const saveHistory = useCallback((q: string) => {
    setHistory(prev => {
      const next = [q, ...prev.filter(h => h !== q)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const executeSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResult(null); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    try {
      const themeSummaries = themes.map(t => ({
        name: t.theme_name,
        perf_1d: t.performance_pct,
        perf_1w: null,
        perf_1m: null,
        breadth: t.valid_count && t.valid_count > 0
          ? Math.round((t.up_count / t.valid_count) * 100)
          : null,
        score: t.rank ?? null,
        avgRelVol: null,
        sustainedVol: null,
        volumeDryUp: false,
        status: t.category ?? null,
      }));

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`${supabaseUrl}/functions/v1/natural-language-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ query: q, themes: themeSummaries }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();

      if (data.matchingThemes && Array.isArray(data.matchingThemes)) {
        setResult({ matchingThemes: data.matchingThemes, explanation: data.explanation || "" });
        saveHistory(q);
      } else {
        throw new Error("Invalid response");
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      // Fallback: simple client-side text matching on theme names
      const lower = q.toLowerCase();
      const matches = themes
        .filter(t => t.theme_name.toLowerCase().includes(lower))
        .map(t => t.theme_name);
      setResult({
        matchingThemes: matches,
        explanation: matches.length > 0
          ? `Matched ${matches.length} themes by name`
          : "No themes matched your query",
      });
      if (matches.length > 0) saveHistory(q);
    } finally {
      setIsSearching(false);
    }
  }, [themes, saveHistory]);

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResult(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => executeSearch(q), DEBOUNCE_MS);
  }, [executeSearch]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResult(null);
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const runSearch = useCallback((q: string) => {
    setQuery(q);
    executeSearch(q);
  }, [executeSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    query,
    setQuery: handleQueryChange,
    isSearching,
    result,
    clearSearch,
    runSearch,
    history,
  };
}
