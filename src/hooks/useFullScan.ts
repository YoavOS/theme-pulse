import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ThemeData } from "@/data/themeData";
import { runStageScan } from "@/lib/stageAnalysis";

export interface ScanProgress {
  total: number;
  done: number;
  failed: number;
  pending: number;
  themes: number;
  scanning: boolean;
}

const PERF_CACHE_KEY = "ticker_perf_cache";
const PERF_CACHE_MAX_AGE = 4 * 60 * 60 * 1000;

export interface PerfCache {
  tickers: Record<string, { perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number; perf_ytd: number; price: number }>;
  fetchedAt: string;
  scannedAt?: string; // when the scan itself last ran
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
  const [scanCompletedAt, setScanCompletedAt] = useState<Date | null>(null);
  const abortRef = useRef(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  const fetchStatus = useCallback(async (): Promise<ScanProgress | null> => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers });
      return await res.json() as ScanProgress;
    } catch { return null; }
  }, [supabaseUrl, anonKey]);

  // Build theme data from a freshly-completed scan + theme_tickers.
  /** Per-ticker results of the last Full Scan (localStorage cache → server). */
  const loadPerfMap = useCallback(async (): Promise<PerfCache | null> => {
    const cached = loadPerfCache();
    if (cached) return cached;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=results`, { headers });
      const data = await res.json();
      if (!data.tickers) return null;
      const tickers: PerfCache["tickers"] = {};
      for (const t of data.tickers) {
        tickers[String(t.symbol).toUpperCase()] = {
          perf_1d: t.perf_1d, perf_1w: t.perf_1w, perf_1m: t.perf_1m,
          perf_3m: t.perf_3m, perf_ytd: t.perf_ytd, price: t.price,
        };
      }
      const latest = (data.tickers as { last_scanned?: string }[])
        .map(t => t.last_scanned ?? "").sort().pop();
      const out: PerfCache = { tickers, fetchedAt: new Date().toISOString(), scannedAt: latest || undefined };
      savePerfCache(out);
      return out;
    } catch { return null; }
  }, [supabaseUrl, anonKey]);

  // No EOD/history reads — historical timeframes use the perf fields
  // returned by the scan itself.
  const buildThemesFromPerf = useCallback(async (
    timeframe: string = "Today",
    overallWeights?: { w1d: number; w1w: number; w1m: number; w3m: number },
  ): Promise<ThemeData[]> => {
    const { data: dbThemes } = await supabase.from("themes").select("id, name, description");
    const { data: dbTickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!dbThemes || !dbTickers) return [];

    const perfCache = await loadPerfMap();
    if (!perfCache) return [];
    const perfMap = perfCache.tickers;

    if (Object.keys(perfMap).length === 0) return [];

    const isOverall = timeframe === "Overall";
    const perfField = timeframe === "1W" ? "perf_1w" : timeframe === "1M" ? "perf_1m" : timeframe === "3M" ? "perf_3m" : timeframe === "YTD" ? "perf_ytd" : "perf_1d";

    // Normalize weights for Overall mode.
    const wRaw = overallWeights ?? { w1d: 0, w1w: 0, w1m: 60, w3m: 40 };
    const wTotal = wRaw.w1d + wRaw.w1w + wRaw.w1m + wRaw.w3m;
    const w = wTotal > 0
      ? { w1d: wRaw.w1d / wTotal, w1w: wRaw.w1w / wTotal, w1m: wRaw.w1m / wTotal, w3m: wRaw.w3m / wTotal }
      : { w1d: 0, w1w: 0, w1m: 0.6, w3m: 0.4 };

    const blend = (p: { perf_1d: number; perf_1w: number; perf_1m: number; perf_3m: number }) => {
      let num = 0, den = 0;
      const add = (val: number, weight: number) => {
        if (weight > 0 && val !== null && val !== undefined && !Number.isNaN(val)) {
          num += weight * val; den += weight;
        }
      };
      add(p.perf_1d, w.w1d);
      add(p.perf_1w, w.w1w);
      add(p.perf_1m, w.w1m);
      add(p.perf_3m, w.w3m);
      return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
    };

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
        const perf = perfMap[s.toUpperCase()] ?? perfMap[s];
        if (!perf) return { symbol: s, pct: 0, skipped: true, skipReason: "no_data" } as any;
        if (isOverall) {
          return {
            symbol: s,
            pct: blend(perf),
            pct_1d: perf.perf_1d ?? 0,
            pct_1w: perf.perf_1w ?? 0,
            pct_1m: perf.perf_1m ?? 0,
            pct_3m: perf.perf_3m ?? 0,
          };
        }
        return { symbol: s, pct: perf[perfField] || 0 };
      });

      const validTickers = tickers.filter(t => !t.skipped);
      const up_count = validTickers.filter(t => t.pct > 0).length;
      const down_count = validTickers.filter(t => t.pct <= 0).length;
      const na_count = tickers.filter(t => t.skipped).length;
      const avg = (key: string) => validTickers.length > 0
        ? Math.round((validTickers.reduce((sum, t: any) => sum + (t[key] ?? 0), 0) / validTickers.length) * 100) / 100
        : 0;
      const performance_pct = avg("pct");

      const themeOut: ThemeData = {
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
      };
      if (isOverall) {
        themeOut.perf_1d = avg("pct_1d");
        themeOut.perf_1w = avg("pct_1w");
        themeOut.perf_1m = avg("pct_1m");
        themeOut.perf_3m = avg("pct_3m");
      }
      themes.push(themeOut);
    }

    return themes;
  }, [loadPerfMap]);

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
      const status = await fetchStatus();
      const hasResumable = status && status.pending > 0 && status.done > 0;

      if (!hasResumable) {
        setStatusText("Initializing scan...");
        const startRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=start`, { headers });
        const startData = await startRes.json();
        if (!startRes.ok) throw new Error(startData.error || `HTTP ${startRes.status}`);
        setStatusText(`Initialized: ${startData.total} tickers to scan`);
      } else {
        setStatusText(`Resuming: ${status.done}/${status.total} done`);
      }

      let done = false;
      while (!done && !abortRef.current) {
        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=chunk`, { headers });
        if (!res.ok) {
          setStatusText(`Scan paused — click Full Scan to resume`);
          setIsRunning(false);
          return;
        }

        const result = await res.json();
        done = result.done;

        const lastSymbol = result.results
          ?.filter((r: { status: string }) => r.status === "done")
          ?.slice(-1)?.[0]?.symbol || "";

        const p = await fetchStatus();
        if (p) {
          setProgress(p);
          const symbolInfo = lastSymbol ? ` · ${lastSymbol}` : "";
          setStatusText(`Scanning: ${p.done}/${p.total} tickers${p.failed > 0 ? ` · ${p.failed} failed` : ""}${symbolInfo}`);
        }

        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      if (abortRef.current) { setIsRunning(false); return; }

      const finalStatus = await fetchStatus();
      setProgress(finalStatus);

      localStorage.removeItem(PERF_CACHE_KEY);

      const todayThemes = await buildThemesFromPerf("Today");
      if (todayThemes.length > 0) onComplete(todayThemes, "Today");

      const total = finalStatus?.total || 0;
      const failed = finalStatus?.failed || 0;
      const summaryParts = [`${total - failed}/${total} tickers scanned`];
      if (failed > 0) summaryParts.push(`${failed} unavailable`);

      setScanCompletedAt(new Date());

      // Full Scan also refreshes Weinstein stages and the Base Scanner (after the daily bars above are cached).
      try {
        setStatusText(`Updating stages & bases…`);
        const st = await runStageScan((d, t) => setStatusText(`Updating stages & bases: ${d}/${t}`));
        summaryParts.push(`stages ${st.processed}`);
      } catch (e) {
        console.warn("Stage scan after Full Scan failed", e);
        summaryParts.push("stages not updated");
      }

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

  const loadTimeframe = useCallback(async (
    timeframe: string,
    overallWeights?: { w1d: number; w1w: number; w1m: number; w3m: number },
  ) => {
    const themes = await buildThemesFromPerf(timeframe, overallWeights);
    if (themes.length > 0) onComplete(themes, timeframe);
    return themes.length > 0;
  }, [buildThemesFromPerf, onComplete]);

  useEffect(() => {
    (async () => {
      const status = await fetchStatus();
      if (status && status.pending > 0 && status.done > 0) {
        setProgress(status);
        setStatusText(`Resumable: ${status.done}/${status.total} tickers — click Full Scan to resume`);
      } else if (status && status.done > 0 && status.pending === 0) {
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
    scanCompletedAt,
    startFullScan,
    clearProgress,
    loadTimeframe,
    buildThemesFromPerf,
    loadPerfMap,
  };
}
