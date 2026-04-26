import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FundamentalsScanProgress {
  status: "idle" | "running" | "paused" | "complete";
  totalQueued: number;
  processed: number;
  succeeded: number;
  failed: number;
  startedAt: string | null;
  lastUpdated: string | null;
  etaSeconds: number | null;
}

export interface FundamentalsCoverage {
  total: number;
  coverage: Record<string, { count: number; pct: number }>;
}

const INITIAL: FundamentalsScanProgress = {
  status: "idle", totalQueued: 0, processed: 0, succeeded: 0, failed: 0,
  startedAt: null, lastUpdated: null, etaSeconds: null,
};

export function useFundamentalsScan() {
  const [progress, setProgress] = useState<FundamentalsScanProgress>(INITIAL);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const loadProgress = useCallback(async () => {
    const { data } = await supabase
      .from("fundamentals_scan_progress")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return;
    const status = (data.status as FundamentalsScanProgress["status"]) ?? "idle";
    const total = data.total_queued ?? 0;
    const processed = data.processed ?? 0;
    const startedAt = data.started_at;

    let etaSeconds: number | null = null;
    if (status === "running" && startedAt && processed > 0 && total > processed) {
      const elapsedSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const rate = processed / elapsedSec;
      if (rate > 0) etaSeconds = Math.round((total - processed) / rate);
    }

    setProgress({
      status,
      totalQueued: total,
      processed,
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      startedAt,
      lastUpdated: data.last_updated,
      etaSeconds,
    });
  }, []);

  useEffect(() => {
    loadProgress();
    pollRef.current = window.setInterval(loadProgress, 5000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [loadProgress]);

  const startScan = useCallback(async (mode: "resume" | "restart" = "resume") => {
    setError(null); setIsMutating(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-fundamentals-queue", {
        body: { mode },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      await loadProgress();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsMutating(false);
    }
  }, [loadProgress]);

  const pauseScan = useCallback(async () => {
    setIsMutating(true);
    try {
      const { data, error } = await supabase.functions.invoke("pause-fundamentals-scan", {
        body: { action: "pause" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      await loadProgress();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsMutating(false);
    }
  }, [loadProgress]);

  const fetchCoverage = useCallback(async (): Promise<FundamentalsCoverage | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("fundamentals-coverage", { body: {} });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as FundamentalsCoverage;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const isRunning = progress.status === "running";
  const isPaused = progress.status === "paused";

  return { progress, isRunning, isPaused, isMutating, error, startScan, pauseScan, fetchCoverage };
}
