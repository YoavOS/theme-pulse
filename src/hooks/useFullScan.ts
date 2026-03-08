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
  tickers: { symbol: string; pct: number; price: number; skipped?: boolean; skipReason?: string }[];
  skipped_tickers: string[];
  invalid_tickers?: string[];
}

export function useFullScan(onChunkComplete: (themes: ThemeData[]) => void) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<FullScanProgress | null>(null);
  const [statusText, setStatusText] = useState("");
  const [totalSkipped, setTotalSkipped] = useState(0);
  const [totalInvalid, setTotalInvalid] = useState(0);
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
    setTotalInvalid(0);
    abortRef.current = true;
    toast({ title: "Scan progress cleared" });
  }, [supabaseUrl, anonKey, toast]);

  function chunkThemesToThemeData(chunkThemes: FullScanChunkTheme[]): ThemeData[] {
    return chunkThemes.map((t) => {
      const validTickers = t.tickers.filter((tk) => !tk.skipped);
      const skippedTickers = t.tickers.filter((tk) => tk.skipped);
      const up_count = validTickers.filter((tk) => tk.pct > 0).length;
      const down_count = validTickers.filter((tk) => tk.pct <= 0).length;
      const na_count = skippedTickers.length;
      const performance_pct =
        validTickers.length > 0
          ? Math.round(
              (validTickers.reduce((sum, tk) => sum + tk.pct, 0) / validTickers.length) * 100
            ) / 100
          : 0;
      return {
        theme_name: t.theme_name,
        performance_pct,
        up_count,
        down_count,
        na_count,
        valid_count: validTickers.length,
        tickers: t.tickers.map((tk) => ({
          symbol: tk.symbol,
          pct: tk.pct,
          skipped: tk.skipped,
          skipReason: tk.skipReason,
        })),
        notes: t.notes || undefined,
        dataSource: "real" as const,
        lastUpdated: new Date().toISOString(),
      };
    });
  }

  const startFullScan = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    setTotalSkipped(0);
    setTotalInvalid(0);
    let skippedCount = 0;
    let invalidCount = 0;

    try {
      // STEP 1: Check progress FIRST to decide start vs resume
      const existing = await fetchProgress();
      console.log("Button clicked – checking progress:", existing ? `index = ${existing.last_theme_index} / status = ${existing.status}` : "no progress row");

      let action: string;
      if (existing && (existing.status === "in_progress" || existing.status === "paused_failed" || existing.status === "rate_limited_waiting") && existing.last_theme_index > 0 && existing.last_theme_index < existing.total_themes) {
        action = "chunk"; // Resume
        setStatusText(`Resuming scan from theme ${existing.last_theme_index + 1}/${existing.total_themes}...`);
        setProgress(existing);
        console.log(`Resuming from ${existing.last_theme_index + 1}/${existing.total_themes}`);
      } else {
        action = "start"; // Fresh scan
        setStatusText("Starting full scan...");
        console.log("Starting fresh scan");
      }

      let done = false;
      let totalThemes = existing?.total_themes || 0;

      while (!done && !abortRef.current) {
        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=${action}`, { headers });

        // After first call, always use "chunk"
        action = "chunk";

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          console.error("Full scan chunk failed:", err);
          const latest = await fetchProgress();
          if (latest) {
            setProgress(latest);
            setStatusText(`Scan paused at theme ${latest.last_theme_index}/${latest.total_themes} — click Full Scan to resume`);
          }
          setIsRunning(false);
          return;
        }

        const result = await res.json();
        console.log("Chunk result:", result);
        totalThemes = result.total_themes || totalThemes;

        if (result.themes?.length > 0) {
          const converted = chunkThemesToThemeData(result.themes);
          onChunkComplete(converted);
          console.log(`Merged ${converted.length} themes into cache`);
        }

        if (result.skipped_tickers?.length > 0) {
          skippedCount += result.skipped_tickers.length;
          setTotalSkipped(skippedCount);
          console.warn("Skipped tickers:", result.skipped_tickers);
        }

        if (result.invalid_tickers?.length > 0) {
          invalidCount += result.invalid_tickers.length;
          setTotalInvalid(invalidCount);
          console.warn("Invalid tickers:", result.invalid_tickers);
        }

        done = result.done;

        // Update progress UI
        const p = await fetchProgress();
        if (p) setProgress(p);

        if (!done) {
          setStatusText(`Updated ${result.processed_to}/${totalThemes} themes${skippedCount > 0 ? ` | ${skippedCount} skipped` : ""}${invalidCount > 0 ? ` | ${invalidCount} invalid` : ""}...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (abortRef.current) {
        setIsRunning(false);
        return;
      }

      const summaryParts = [`All ${totalThemes} themes updated`];
      if (skippedCount > 0) summaryParts.push(`${skippedCount} tickers skipped (rate limit)`);
      if (invalidCount > 0) summaryParts.push(`${invalidCount} invalid tickers skipped`);

      setStatusText(`Complete — ${summaryParts.join(" | ")}`);
      setIsRunning(false);

      toast({
        title: "Full Scan Complete",
        description: summaryParts.join(". "),
      });
    } catch (err) {
      console.error("Full scan error:", err);
      setIsRunning(false);
      const latest = await fetchProgress();
      if (latest) {
        setProgress(latest);
        setStatusText(`Scan failed at theme ${latest.last_theme_index}/${latest.total_themes} — click Full Scan to resume`);
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
      if (p && (p.status === "in_progress" || p.status === "paused_failed") && p.last_theme_index > 0 && p.last_theme_index < p.total_themes) {
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
    totalInvalid,
    startFullScan,
    clearProgress,
  };
}
