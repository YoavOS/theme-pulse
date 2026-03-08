import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

export interface EodStatus {
  date: string;
  isWeekend: boolean;
  isAfterClose: boolean;
  alreadySaved: boolean;
  session: {
    saved_count: number;
    failed_count: number;
    total_tickers: number;
    status: string;
    completed_at: string | null;
  } | null;
}

export interface EodSaveProgress {
  total: number;
  saved: number;
  failed: number;
  currentTheme: string;
  saving: boolean;
}

const AUTO_SAVE_KEY = "autoSaveEOD";

export function useEodSave() {
  const { toast } = useToast();
  const [status, setStatus] = useState<EodStatus | null>(null);
  const [progress, setProgress] = useState<EodSaveProgress | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(() => localStorage.getItem(AUTO_SAVE_KEY) === "true");
  const abortRef = useRef(false);
  const autoSaveTriggeredRef = useRef(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  };

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/save-eod?action=check`, { headers });
      const data = await res.json() as EodStatus;
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, [supabaseUrl, anonKey]);

  const startEodSave = useCallback(async () => {
    setIsSaving(true);
    abortRef.current = false;

    try {
      // 1. Initialize session and get ticker list
      const startRes = await fetch(`${supabaseUrl}/functions/v1/save-eod?action=start`, {
        method: "POST",
        headers,
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || `HTTP ${startRes.status}`);

      const { tickers, date, total } = startData as {
        tickers: { symbol: string; theme_name: string }[];
        date: string;
        total: number;
      };

      setProgress({ total, saved: 0, failed: 0, currentTheme: "", saving: true });

      // 2. Process in chunks
      const CHUNK_SIZE = 12;
      let totalSaved = 0;
      let totalFailed = 0;

      for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
        if (abortRef.current) break;

        const chunk = tickers.slice(i, i + CHUNK_SIZE);
        const currentTheme = chunk[0]?.theme_name || "";

        setProgress({
          total,
          saved: totalSaved,
          failed: totalFailed,
          currentTheme,
          saving: true,
        });

        const res = await fetch(`${supabaseUrl}/functions/v1/save-eod?action=chunk`, {
          method: "POST",
          headers,
          body: JSON.stringify({ tickers: chunk, date }),
        });

        if (!res.ok) {
          console.error("EOD chunk failed:", await res.text());
          continue;
        }

        const result = await res.json();
        totalSaved += result.saved || 0;
        totalFailed += result.failed || 0;

        setProgress({
          total,
          saved: totalSaved,
          failed: totalFailed,
          currentTheme,
          saving: true,
        });
      }

      // 3. Mark session complete
      await fetch(`${supabaseUrl}/functions/v1/save-eod?action=complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ date }),
      });

      setProgress({ total, saved: totalSaved, failed: totalFailed, currentTheme: "", saving: false });
      setIsSaving(false);

      // Refresh status
      await checkStatus();

      toast({
        title: totalFailed > 0 ? "EOD Saved with warnings" : "EOD Save Complete",
        description: `${date} · ${totalSaved} tickers saved${totalFailed > 0 ? ` · ${totalFailed} failed` : ""}`,
        variant: totalFailed > 0 ? "destructive" : "default",
      });
    } catch (err) {
      console.error("EOD save error:", err);
      setIsSaving(false);
      setProgress(null);
      toast({
        title: "EOD Save Failed",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [supabaseUrl, anonKey, toast, checkStatus]);

  const toggleAutoSave = useCallback(() => {
    setAutoSave((prev) => {
      const next = !prev;
      localStorage.setItem(AUTO_SAVE_KEY, String(next));
      return next;
    });
  }, []);

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Auto-save logic: check every 60s if it's 4:05 PM ET on a weekday
  useEffect(() => {
    if (!autoSave) {
      autoSaveTriggeredRef.current = false;
      return;
    }

    const interval = setInterval(async () => {
      if (isSaving || autoSaveTriggeredRef.current) return;

      const s = await checkStatus();
      if (!s) return;

      // Check if it's after 4:05 PM ET, weekday, and not already saved
      if (!s.isWeekend && s.isAfterClose && !s.alreadySaved) {
        autoSaveTriggeredRef.current = true;
        toast({ title: "⚡ Auto-saving EOD data..." });
        startEodSave();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [autoSave, isSaving, checkStatus, startEodSave, toast]);

  const canSave = status ? !status.isWeekend && status.isAfterClose && !status.alreadySaved && !isSaving : false;

  const tooltip = !status
    ? "Checking..."
    : status.isWeekend
    ? "Market closed (weekend)"
    : !status.isAfterClose
    ? "Available after market close (4:00 PM ET)"
    : status.alreadySaved
    ? `EOD already saved today${status.session?.completed_at ? ` at ${new Date(status.session.completed_at).toLocaleTimeString()}` : ""}`
    : "Save end-of-day prices for all tickers";

  return {
    status,
    progress,
    isSaving,
    canSave,
    tooltip,
    autoSave,
    startEodSave,
    toggleAutoSave,
    checkStatus,
  };
}
