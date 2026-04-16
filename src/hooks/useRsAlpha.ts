import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Filter thresholds (single source of truth — must match process-universe-queue/index.ts) ──
export const RS_FILTER_THRESHOLDS = {
  MIN_MARKET_CAP: 1000,           // $1B in Finnhub units (millions)
  MIN_DOLLAR_VOLUME: 10_000_000,  // $10M average daily dollar volume
  MIN_AVG_DAILY_RANGE: 3,         // 3% average daily range (14d)
  MIN_PRICE: 6,
};

export interface RsStock {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  marketCap: number | null;
  avgDollarVolume: number | null;
  adrPercent: number | null;
  adrSource: string | null;
  return1d: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  spyReturn1d: number | null;
  spyReturn1m: number | null;
  spyReturn3m: number | null;
  spyReturn6m: number | null;
  rs1d: number | null;
  rs1m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  rsOverall: number | null;
  rsCalculatedAt: string | null;
}

export interface RebuildProgress {
  status: "idle" | "running" | "complete";
  totalQueued: number;
  processed: number;
  qualified: number;
  failed: number;
  startedAt: string | null;
  lastUpdated: string | null;
}

export function useRsAlpha() {
  const [stocks, setStocks] = useState<RsStock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcStatus, setRecalcStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RebuildProgress>({
    status: "idle", totalQueued: 0, processed: 0, qualified: 0, failed: 0,
    startedAt: null, lastUpdated: null,
  });
  const pollRef = useRef<number | null>(null);

  // ── Load qualified universe from DB ──
  const loadStocks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: dbErr } = await supabase
        .from("qualified_rs_universe")
        .select("*")
        .order("rs_overall", { ascending: false, nullsFirst: false });
      if (dbErr) throw dbErr;
      const mapped: RsStock[] = (data ?? []).map((r) => ({
        symbol: r.symbol,
        companyName: r.company_name,
        sector: r.sector,
        price: r.current_price !== null ? Number(r.current_price) : null,
        marketCap: r.market_cap !== null ? Number(r.market_cap) : null,
        avgDollarVolume: r.avg_dollar_volume !== null ? Number(r.avg_dollar_volume) : null,
        adrPercent: r.adr_percent !== null ? Number(r.adr_percent) : null,
        adrSource: r.adr_source,
        return1d: r.return_1d !== null ? Number(r.return_1d) : null,
        return1m: r.return_1m !== null ? Number(r.return_1m) : null,
        return3m: r.return_3m !== null ? Number(r.return_3m) : null,
        return6m: r.return_6m !== null ? Number(r.return_6m) : null,
        spyReturn1d: r.spy_return_1d !== null ? Number(r.spy_return_1d) : null,
        spyReturn1m: r.spy_return_1m !== null ? Number(r.spy_return_1m) : null,
        spyReturn3m: r.spy_return_3m !== null ? Number(r.spy_return_3m) : null,
        spyReturn6m: r.spy_return_6m !== null ? Number(r.spy_return_6m) : null,
        rs1d: r.rs_1d !== null ? Number(r.rs_1d) : null,
        rs1m: r.rs_1m !== null ? Number(r.rs_1m) : null,
        rs3m: r.rs_3m !== null ? Number(r.rs_3m) : null,
        rs6m: r.rs_6m !== null ? Number(r.rs_6m) : null,
        rsOverall: r.rs_overall !== null ? Number(r.rs_overall) : null,
        rsCalculatedAt: r.rs_calculated_at,
      }));
      setStocks(mapped);
    } catch (e) {
      console.error("loadStocks error:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Load progress ──
  const loadProgress = useCallback(async () => {
    const { data } = await supabase.from("rs_scan_progress").select("*").eq("id", 1).maybeSingle();
    if (data) {
      setProgress({
        status: (data.status as any) ?? "idle",
        totalQueued: data.total_queued ?? 0,
        processed: data.processed ?? 0,
        qualified: data.qualified ?? 0,
        failed: data.failed ?? 0,
        startedAt: data.started_at,
        lastUpdated: data.last_updated,
      });
      if (data.status === "running") {
        setIsRebuilding(true);
      } else {
        setIsRebuilding(false);
      }
    }
  }, []);

  // ── Initial load + start progress polling ──
  useEffect(() => {
    loadStocks();
    loadProgress();
    pollRef.current = window.setInterval(() => {
      loadProgress();
    }, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadStocks, loadProgress]);

  // Reload stocks when rebuild completes
  useEffect(() => {
    if (progress.status === "complete" && progress.qualified > 0) {
      loadStocks();
    }
  }, [progress.status, progress.qualified, loadStocks]);

  // ── Trigger heavy rebuild (Stage 1) ──
  const rebuildUniverse = useCallback(async () => {
    setError(null);
    setIsRebuilding(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("seed-universe-queue", { body: {} });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      await loadProgress();
    } catch (e) {
      console.error("rebuildUniverse error:", e);
      setError(e instanceof Error ? e.message : String(e));
      setIsRebuilding(false);
    }
  }, [loadProgress]);

  // ── Recalculate RS scores (Stage 2 - light scan) ──
  const recalculateRs = useCallback(async () => {
    setError(null);
    setIsRecalculating(true);
    setRecalcStatus("Starting RS recalculation…");
    try {
      let offset = 0;
      let done = false;
      while (!done) {
        const { data, error: fnErr } = await supabase.functions.invoke("calculate-rs-scores", {
          body: { offset },
        });
        if (fnErr) throw new Error(fnErr.message);
        if (data?.error) throw new Error(data.error);

        done = data?.done ?? true;
        offset = data?.next_offset ?? offset;
        const total = data?.total ?? 0;
        setRecalcStatus(`Calculated ${data?.processed ?? offset} / ${total} stocks…`);
      }
      setRecalcStatus("Reloading…");
      await loadStocks();
      setRecalcStatus("");
    } catch (e) {
      console.error("recalculateRs error:", e);
      setError(e instanceof Error ? e.message : String(e));
      setRecalcStatus("");
    } finally {
      setIsRecalculating(false);
    }
  }, [loadStocks]);

  return {
    stocks,
    isLoading,
    isRebuilding,
    isRecalculating,
    recalcStatus,
    error,
    progress,
    rebuildUniverse,
    recalculateRs,
    reload: loadStocks,
  };
}
