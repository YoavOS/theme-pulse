import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProgress = useCallback(async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const data = await res.json();
    return data.progress as FullScanProgress | null;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      const p = await fetchProgress();
      if (p) {
        setProgress(p);
        if (p.status === "rate_limited_waiting") {
          setStatusText(`Paused — waiting 60s for rate limit... (${p.last_theme_index}/${p.total_themes})`);
        } else if (p.status === "in_progress") {
          setStatusText(`Updating theme ${p.last_theme_index}/${p.total_themes}...`);
        } else if (p.status === "complete") {
          setStatusText("Full update complete — all themes refreshed");
          setIsRunning(false);
          stopPolling();
        }
      }
    }, 3000);
  }, [fetchProgress, stopPolling]);

  const startFullScan = useCallback(async () => {
    setIsRunning(true);
    setStatusText("Starting full scan...");

    // Check for unfinished progress
    const existing = await fetchProgress();
    if (existing && existing.status === "in_progress" && existing.last_theme_index < existing.total_themes && existing.last_theme_index > 0) {
      setStatusText(`Resuming from theme ${existing.last_theme_index + 1}/${existing.total_themes}...`);
    }

    startPolling();

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=start`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });

      const result = await res.json();

      if (result.error) {
        throw new Error(result.error);
      }

      setStatusText("Full update complete — all themes refreshed");
      setIsRunning(false);
      stopPolling();

      toast({
        title: "Full Scan Complete",
        description: `Updated ${result.total_themes} themes, ${result.symbols_fetched} symbols fetched`,
      });

      onComplete();
    } catch (err) {
      setIsRunning(false);
      stopPolling();
      setStatusText("Full scan failed");
      toast({
        title: "Full Scan Failed",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [fetchProgress, startPolling, stopPolling, toast, onComplete]);

  // Check for unfinished progress on mount
  useEffect(() => {
    fetchProgress().then((p) => {
      if (p && p.status === "in_progress" && p.last_theme_index < p.total_themes) {
        setProgress(p);
        setStatusText(`Resumable: theme ${p.last_theme_index}/${p.total_themes} — click to resume`);
      }
    });
  }, [fetchProgress]);

  // Cleanup
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    isRunning,
    progress,
    statusText,
    startFullScan,
  };
}
