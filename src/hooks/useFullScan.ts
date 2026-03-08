import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ThemeData } from "@/data/themeData";
import { useEodPerformance } from "@/hooks/useEodPerformance";

export interface ScanProgress {
  total: number;
  done: number;
  failed: number;
  pending: number;
  themes: number;
  scanning: boolean;
}

const PERF_CACHE_KEY = "ticker_perf_cache";
const PERF_CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // 4 hours

interface PerfCache {
  tickers: Record<string, { perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number; perf_ytd: number; price: number }>;
  fetchedAt: string;
}

function savePerfCache(data: PerfCache) {
  try { localStorage.setItem(PERF_CACHE_KEY, JSON.stringify(data)); } catch {}
}

function loadPerfCache(): PerfCache | null {
  try {
    const raw = localStorage.getItem(PERF_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerfCache;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > PERF_CACHE_MAX_AGE) {
      localStorage.removeItem(PERF_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

export function useFullScan(onComplete: (themes: ThemeData[], timeframe: string) => void) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [statusText, setStatusText] = useState("");
  const abortRef = useRef(false);
  const { calculateFromEod, checkCoverage } = useEodPerformance();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  const fetchStatus = useCallback(async (): Promise<ScanProgress | null> => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers });
      return await res.json() as ScanProgress;
    } catch { return null; }
  }, [supabaseUrl, anonKey]);

  // Build theme data from ticker_performance + theme_tickers for a given timeframe
  const buildThemesFromPerf = useCallback(async (timeframe: string = "Today"): Promise<ThemeData[]> => {
    // Get theme structure
    const { data: dbThemes } = await supabase.from("themes").select("id, name, description");
    const { data: dbTickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) return [];

    // Try to get perf data from local cache first, then from edge function
    let perfMap: Record<string, { perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number; perf_ytd: number; price: number }> = {};

    const cached = loadPerfCache();
    if (cached) {
      perfMap = cached.tickers;
    } else {
      // Fetch from edge function
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=results`, { headers });
        const data = await res.json();
        if (data.tickers) {
          for (const t of data.tickers) {
            perfMap[t.symbol] = {
              perf_1d: t.perf_1d, perf_1w: t.perf_1w, perf_1m: t.perf_1m,
              perf_3m: t.perf_3m, perf_ytd: t.perf_ytd, price: t.price,
            };
          }
          savePerfCache({ tickers: perfMap, fetchedAt: new Date().toISOString() });
        }
      } catch { return []; }
    }

    if (Object.keys(perfMap).length === 0) return [];

    // For non-1D timeframes, try to use EOD historical data if available
    const isHistorical = timeframe !== "Today";
    let eodPerfMap: Record<string, { perf_1w: number | null; perf_1m: number | null; perf_3m: number | null; perf_ytd: number | null }> = {};

    if (isHistorical) {
      try {
        const coverage = await checkCoverage();
        const tfReady = timeframe === "1W" ? coverage.ready1w
          : timeframe === "1M" ? coverage.ready1m
          : timeframe === "3M" ? coverage.ready3m
          : coverage.readyYtd;

        if (tfReady) {
          const allSymbols = Object.keys(perfMap);
          const todayPrices: Record<string, number> = {};
          for (const [s, p] of Object.entries(perfMap)) {
            todayPrices[s] = p.price;
          }
          eodPerfMap = await calculateFromEod(allSymbols, todayPrices);
        }
      } catch (e) {
        console.error("EOD perf calculation failed, falling back to scan data:", e);
      }
    }

    // Map timeframe to perf field
    const perfField = timeframe === "1W" ? "perf_1w" : timeframe === "1M" ? "perf_1m" : timeframe === "3M" ? "perf_3m" : timeframe === "YTD" ? "perf_ytd" : "perf_1d";
    const eodField = timeframe === "1W" ? "perf_1w" : timeframe === "1M" ? "perf_1m" : timeframe === "3M" ? "perf_3m" : "perf_ytd";

    // Build theme map
    const themeTickerMap = new Map<string, { name: string; description: string | null; symbols: string[] }>();
    for (const t of dbThemes) {
      themeTickerMap.set(t.id, { name: t.name, description: t.description, symbols: [] });
    }
    for (const tk of dbTickers) {
      const entry = themeTickerMap.get(tk.theme_id);
      if (entry) entry.symbols.push(tk.ticker_symbol);
    }

    const themes: ThemeData[] = [];
    for (const [, entry] of themeTickerMap) {
      if (entry.symbols.length === 0) continue;

      const tickers = entry.symbols.map(s => {
        const perf = perfMap[s];
        if (!perf) return { symbol: s, pct: 0, skipped: true, skipReason: "no_data" };

        // Prefer EOD-based performance for historical timeframes
        if (isHistorical && eodPerfMap[s]) {
          const eodVal = eodPerfMap[s][eodField];
          if (eodVal !== null && eodVal !== undefined) {
            return { symbol: s, pct: eodVal };
          }
        }

        return { symbol: s, pct: perf[perfField] || 0 };
      });

      const validTickers = tickers.filter(t => !t.skipped);
      const up_count = validTickers.filter(t => t.pct > 0).length;
      const down_count = validTickers.filter(t => t.pct <= 0).length;
      const na_count = tickers.filter(t => t.skipped).length;
      const performance_pct = validTickers.length > 0
        ? Math.round((validTickers.reduce((sum, t) => sum + t.pct, 0) / validTickers.length) * 100) / 100
        : 0;

      themes.push({
        theme_name: entry.name,
        performance_pct,
        up_count,
        down_count,
        na_count,
        valid_count: validTickers.length,
        tickers: tickers.sort((a, b) => (b.pct || 0) - (a.pct || 0)),
        notes: entry.description || undefined,
        dataSource: "real",
        lastUpdated: new Date().toISOString(),
      });
    }

    return themes;
  }, [supabaseUrl, anonKey, calculateFromEod, checkCoverage]);

  const clearProgress = useCallback(async () => {
    await fetch(`${supabaseUrl}/functions/v1/full-scan?action=reset`, { headers });
    setProgress(null);
    setStatusText("");
    setIsRunning(false);
    abortRef.current = true;
    localStorage.removeItem(PERF_CACHE_KEY);
    toast({ title: "Scan progress cleared" });
  }, [supabaseUrl, anonKey, toast]);

  const startFullScan = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;

    try {
      // Check if there's already a scan in progress (resume)
      const status = await fetchStatus();
      const hasResumable = status && status.pending > 0 && status.done > 0;

      if (!hasResumable) {
        // Fresh scan: populate ticker_performance
        setStatusText("Initializing scan...");
        const startRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=start`, { headers });
        const startData = await startRes.json();
        if (!startRes.ok) throw new Error(startData.error || `HTTP ${startRes.status}`);
        console.log(`Scan initialized: ${startData.total} unique tickers`);
        setStatusText(`Initialized: ${startData.total} tickers to scan`);
      } else {
        console.log(`Resuming scan: ${status.done} done, ${status.pending} pending, ${status.failed} failed`);
        setStatusText(`Resuming: ${status.done}/${status.total} done`);
      }

      // Process chunks until done
      let done = false;
      while (!done && !abortRef.current) {
        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=chunk`, { headers });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          console.error("Chunk failed:", err);
          setStatusText(`Scan paused — click Full Scan to resume`);
          setIsRunning(false);
          return;
        }

        const result = await res.json();
        done = result.done;

        // Update progress
        const p = await fetchStatus();
        if (p) {
          setProgress(p);
          setStatusText(`Scanning: ${p.done}/${p.total} tickers${p.failed > 0 ? ` · ${p.failed} failed` : ""}`);
        }

        if (!done) {
          // Brief pause between chunks
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (abortRef.current) { setIsRunning(false); return; }

      // Scan complete — build theme data and push to dashboard
      const finalStatus = await fetchStatus();
      setProgress(finalStatus);

      // Clear local perf cache so buildThemesFromPerf fetches fresh
      localStorage.removeItem(PERF_CACHE_KEY);

      // Build themes for all timeframes and push Today to dashboard
      const todayThemes = await buildThemesFromPerf("Today");
      if (todayThemes.length > 0) onComplete(todayThemes, "Today");

      const total = finalStatus?.total || 0;
      const failed = finalStatus?.failed || 0;
      const summaryParts = [`${total - failed}/${total} tickers scanned`];
      if (failed > 0) summaryParts.push(`${failed} unavailable`);

      setStatusText(`✅ ${summaryParts.join(" · ")}`);
      setIsRunning(false);

      toast({ title: "Full Scan Complete", description: summaryParts.join(". ") });
    } catch (err) {
      console.error("Full scan error:", err);
      setIsRunning(false);
      setStatusText("Scan failed — click Full Scan to retry");
      toast({ title: "Full Scan Error", description: String(err instanceof Error ? err.message : err), variant: "destructive" });
    }
  }, [fetchStatus, buildThemesFromPerf, supabaseUrl, anonKey, toast, onComplete]);

  // Load themes from cached scan data for a specific timeframe
  const loadTimeframe = useCallback(async (timeframe: string) => {
    const themes = await buildThemesFromPerf(timeframe);
    if (themes.length > 0) onComplete(themes, timeframe);
    return themes.length > 0;
  }, [buildThemesFromPerf, onComplete]);

  // Check for resumable/cached data on mount
  useEffect(() => {
    (async () => {
      const status = await fetchStatus();
      if (status && status.pending > 0 && status.done > 0) {
        setProgress(status);
        setStatusText(`Resumable: ${status.done}/${status.total} tickers — click Full Scan to resume`);
      } else if (status && status.done > 0 && status.pending === 0) {
        // Scan was completed — check if cache is fresh
        const cached = loadPerfCache();
        if (cached) {
          setStatusText(`Using cached data · ${status.done} tickers`);
          setProgress(status);
        }
      }
    })();
  }, [fetchStatus]);

  return {
    isRunning,
    progress,
    statusText,
    startFullScan,
    clearProgress,
    loadTimeframe,
    buildThemesFromPerf,
  };
}
