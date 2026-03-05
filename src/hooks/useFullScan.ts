import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export interface FullScanProgress {
  last_theme_index: number;
  total_themes: number;
  status: string;
  last_updated: string;
}

export function useFullScan(onComplete: () => void) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<FullScanProgress | null>(null);
  const [statusText, setStatusText] = useState("");
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
    abortRef.current = true;
    toast({ title: "Scan progress cleared" });
  }, [supabaseUrl, anonKey, toast]);

  const startFullScan = useCallback(async () => {
    setIsRunning(true);
    abortRef.current = false;
    setStatusText("Starting full scan...");

    try {
      // Loop: call edge function repeatedly, each processes a chunk
      let done = false;
      let isFirst = true;

      while (!done && !abortRef.current) {
        const action = isFirst ? "start" : "chunk";
        isFirst = false;

        // Fetch progress first for UI
        const p = await fetchProgress();
        if (p) {
          setProgress(p);
          if (p.status === "rate_limited_waiting") {
            setStatusText(`Rate limited — retrying... (${p.last_theme_index}/${p.total_themes})`);
          } else if (p.status === "in_progress" || p.status === "paused_failed") {
            setStatusText(`Updating theme ${p.last_theme_index}/${p.total_themes}...`);
          }
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=${action}`, { headers });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          console.error("Full scan chunk failed:", err);
          setStatusText(`Failed at chunk — will retry on next click (${err.error || "unknown error"})`);
          // Don't clear isRunning yet, fetch progress to show where we stopped
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

        if (result.skipped?.length > 0) {
          console.warn("Skipped themes:", result.skipped);
        }

        done = result.done;

        if (!done) {
          setStatusText(`Updating theme ${result.processed_to}/${result.total_themes}...`);
          // Small delay between chunks
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (abortRef.current) {
        setIsRunning(false);
        return;
      }

      setStatusText("Full update complete — all themes refreshed");
      setIsRunning(false);

      toast({
        title: "Full Scan Complete",
        description: "All themes have been updated",
      });

      onComplete();
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
  }, [fetchProgress, supabaseUrl, anonKey, toast, onComplete]);

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
    startFullScan,
    clearProgress,
  };
}
