import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ThemeData } from "@/data/themeData";

export interface FullScanProgress {
  last_theme_index: number;
  total_themes: number;
  status: string;
  last_updated: string;
}

export interface FullScanChunkTheme {
  theme_name: string;
  notes: string | null;
  tickers: { symbol: string; pct: number; price: number }[];
  skipped_tickers: string[];
}

export function useFullScan(onChunkComplete: (themes: ThemeData[]) => void) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<FullScanProgress | null>(null);
  const [statusText, setStatusText] = useState("");
  const [totalSkipped, setTotalSkipped] = useState(0);
  const abortRef = useRef(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  const fetchProgress = useCallback(async (): Promise<FullScanProgress | null> => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers });
      const data = await res.json();
      return data.progress as FullScanProgress | null;
    } catch {
      return null;
    }
  }, [supabaseUrl, anonKey]);

  const clearProgress = useCallback(async () => {
    await fetch(`${supabaseUrl}/functions/v1/full-scan?action=reset`, { headers });
    setProgress(null);
    setStatusText("");
    setIsRunning(false);
    setTotalSkipped(0);
    abortRef.current = true;
    toast({ title: "Scan progress cleared" });
  }, [supabaseUrl, anonKey, toast]);

  // Convert chunk results to ThemeData format for merging into cache
  function chunkThemesToThemeData(chunkThemes: FullScanChunkTheme[]): ThemeData[] {
    return chunkThemes.map((t) => {
      const up_count = t.tickers.filter((tk) => tk.pct > 0).length;
      const down_count = t.tickers.filter((tk) => tk.pct <= 0).length;
      const performance_pct =
        t.tickers.length > 0
          ? Math.round(
              (t.tickers.reduce((sum, tk) => sum + tk.pct, 0) / t.tickers.length) * 100
            ) / 100
          : 0;
      return {
        theme_name: t.theme_name,
        performance_pct,
        up_count,
        down_count,
        tickers: t.tickers.map((tk) => ({ symbol: tk.symbol, pct: tk.pct })),
        notes: t.notes || undefined,
      };
    });
  }

  const startFullScan = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    setStatusText("Starting full scan...");
    setTotalSkipped(0);
    let skippedCount = 0;

    try {
      let done = false;
      let isFirst = true;

      while (!done && !abortRef.current) {
        const action = isFirst ? "start" : "chunk";
        isFirst = false;

        // Fetch progress for UI
        const p = await fetchProgress();
        if (p) {
          setProgress(p);
          if (p.status === "rate_limited_waiting") {
            setStatusText(`Rate limited — waiting... (${p.last_theme_index}/${p.total_themes})`);
          } else if (p.status === "in_progress" || p.status === "paused_failed") {
            setStatusText(`Updating theme ${p.last_theme_index}/${p.total_themes}...`);
          }
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=${action}`, { headers });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          console.error("Full scan chunk failed:", err);
          const latest = await fetchProgress();
          if (latest) {
            setProgress(latest);
            setStatusText(`Scan paused at theme ${latest.last_theme_index}/${latest.total_themes} — click to resume`);
          }
          setIsRunning(false);
          return;
        }

        const result = await res.json();
        console.log("Chunk result:", result);

        // KEY: merge chunk results into UI immediately
        if (result.themes?.length > 0) {
          const converted = chunkThemesToThemeData(result.themes);
          onChunkComplete(converted);
          console.log(`Merged ${converted.length} themes into cache from chunk`);
        }

        if (result.skipped_tickers?.length > 0) {
          skippedCount += result.skipped_tickers.length;
          setTotalSkipped(skippedCount);
          console.warn("Skipped tickers:", result.skipped_tickers);
        }

        done = result.done;

        if (!done) {
          setStatusText(`Updated ${result.processed_to}/${result.total_themes} themes${skippedCount > 0 ? ` | ${skippedCount} tickers skipped` : ""}...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (abortRef.current) {
        setIsRunning(false);
        return;
      }

      setStatusText(`Complete — all themes refreshed${skippedCount > 0 ? ` (${skippedCount} tickers skipped)` : ""}`);
      setIsRunning(false);

      toast({
        title: "Full Scan Complete",
        description: skippedCount > 0
          ? `All themes updated. ${skippedCount} tickers skipped due to rate limits.`
          : "All themes have been updated with real data.",
      });
    } catch (err) {
      console.error("Full scan error:", err);
      setIsRunning(false);
      const latest = await fetchProgress();
      if (latest) {
        setProgress(latest);
        setStatusText(`Scan failed at theme ${latest.last_theme_index}/${latest.total_themes} — click to resume`);
      } else {
        setStatusText("Full scan failed — click to retry");
      }
      toast({
        title: "Full Scan Error",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [fetchProgress, supabaseUrl, anonKey, toast, onChunkComplete]);

  // Check for unfinished progress on mount
  useEffect(() => {
    fetchProgress().then((p) => {
      if (p && (p.status === "in_progress" || p.status === "paused_failed") && p.last_theme_index < p.total_themes) {
        setProgress(p);
        setStatusText(`Resumable: theme ${p.last_theme_index}/${p.total_themes} — click Full Scan to resume`);
      }
    });
  }, [fetchProgress]);

  return {
    isRunning,
    progress,
    statusText,
    totalSkipped,
    startFullScan,
    clearProgress,
  };
}
