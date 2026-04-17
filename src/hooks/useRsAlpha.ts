import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Filter thresholds (single source of truth — must match process-universe-queue/index.ts) ──
export const RS_FILTER_THRESHOLDS = {
  MIN_MARKET_CAP: 1000,           // $1B in Finnhub units (millions)
  MIN_DOLLAR_VOLUME: 10_000_000,  // $10M average daily dollar volume
  MIN_AVG_DAILY_RANGE: 3,         // 3% average daily range (14d)
  MIN_PRICE: 6,
};

const SUPABASE_PAGE_SIZE = 1000;
const PERF_CHUNK_SIZE = 500;

const toNumberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

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
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  spyReturn1d: number | null;
  spyReturn1w: number | null;
  spyReturn1m: number | null;
  spyReturn3m: number | null;
  spyReturn6m: number | null;
  rs1d: number | null;
  rs1w: number | null;
  rs1m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  rsOverall: number | null;
  rsCalculatedAt: string | null;
}

export interface RebuildProgress {
  status: "idle" | "running" | "paused" | "complete";
  totalQueued: number;
  processed: number;
  qualified: number;
  failed: number;
  startedAt: string | null;
  lastUpdated: string | null;
  etaSeconds: number | null; // estimated seconds remaining
}

export function useRsAlpha() {
  const [stocks, setStocks] = useState<RsStock[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutatingScan, setIsMutatingScan] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcStatus, setRecalcStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RebuildProgress>({
    status: "idle", totalQueued: 0, processed: 0, qualified: 0, failed: 0,
    startedAt: null, lastUpdated: null, etaSeconds: null,
  });
  const pollRef = useRef<number | null>(null);

  // ── Load qualified universe from DB ──
  const loadStocks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const qualifiedRows: any[] = [];
      for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
        const { data, error: dbErr } = await supabase
          .from("qualified_rs_universe")
          .select("*")
          .order("rs_overall", { ascending: false, nullsFirst: false })
          .range(from, from + SUPABASE_PAGE_SIZE - 1);
        if (dbErr) throw dbErr;
        if (!data?.length) break;
        qualifiedRows.push(...data);
        if (data.length < SUPABASE_PAGE_SIZE) break;
      }

      const symbols = qualifiedRows.map((row) => row.symbol).filter(Boolean);
      const perfChunks = chunkArray(symbols, PERF_CHUNK_SIZE);
      const [spyPerfResult, ...perfResults] = await Promise.all([
        supabase
          .from("ticker_performance")
          .select("perf_1d")
          .eq("symbol", "SPY")
          .maybeSingle(),
        ...perfChunks.map((chunk) =>
          supabase
            .from("ticker_performance")
            .select("symbol, perf_1d, price")
            .in("symbol", chunk)
        ),
      ]);

      if (spyPerfResult.error) throw spyPerfResult.error;

      const livePerfMap = new Map<string, { perf1d: number | null; price: number | null }>();
      for (const result of perfResults) {
        if (result.error) throw result.error;
        for (const row of result.data ?? []) {
          livePerfMap.set(row.symbol, {
            perf1d: toNumberOrNull(row.perf_1d),
            price: toNumberOrNull(row.price),
          });
        }
      }

      const spyReturn1d = toNumberOrNull(spyPerfResult.data?.perf_1d);
      const mapped: RsStock[] = qualifiedRows.map((r) => {
        const livePerf = livePerfMap.get(r.symbol);
        const return1d = livePerf?.perf1d ?? toNumberOrNull(r.return_1d);
        const effectiveSpyReturn1d = spyReturn1d ?? toNumberOrNull(r.spy_return_1d);
        const rs1d =
          return1d !== null && effectiveSpyReturn1d !== null
            ? Math.round((return1d - effectiveSpyReturn1d) * 100) / 100
            : toNumberOrNull(r.rs_1d);

        return {
        symbol: r.symbol,
        companyName: r.company_name,
        sector: r.sector,
        price: livePerf?.price ?? toNumberOrNull(r.current_price),
        marketCap: toNumberOrNull(r.market_cap),
        avgDollarVolume: toNumberOrNull(r.avg_dollar_volume),
        adrPercent: toNumberOrNull(r.adr_percent),
        adrSource: r.adr_source,
        return1d,
        return1w: toNumberOrNull((r as any).return_1w),
        return1m: toNumberOrNull(r.return_1m),
        return3m: toNumberOrNull(r.return_3m),
        return6m: toNumberOrNull(r.return_6m),
        spyReturn1d: effectiveSpyReturn1d,
        spyReturn1w: toNumberOrNull((r as any).spy_return_1w),
        spyReturn1m: toNumberOrNull(r.spy_return_1m),
        spyReturn3m: toNumberOrNull(r.spy_return_3m),
        spyReturn6m: toNumberOrNull(r.spy_return_6m),
        rs1d,
        rs1w: toNumberOrNull((r as any).rs_1w),
        rs1m: toNumberOrNull(r.rs_1m),
        rs3m: toNumberOrNull(r.rs_3m),
        rs6m: toNumberOrNull(r.rs_6m),
        rsOverall: toNumberOrNull(r.rs_overall),
        rsCalculatedAt: r.rs_calculated_at,
      }});
      setStocks(mapped);
    } catch (e) {
      console.error("loadStocks error:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Load progress + compute ETA ──
  const loadProgress = useCallback(async () => {
    const { data } = await supabase.from("rs_scan_progress").select("*").eq("id", 1).maybeSingle();
    if (!data) return;
    const status = (data.status as RebuildProgress["status"]) ?? "idle";
    const total = data.total_queued ?? 0;
    const processed = data.processed ?? 0;
    const startedAt = data.started_at;

    let etaSeconds: number | null = null;
    if (status === "running" && startedAt && processed > 0 && total > processed) {
      const elapsedSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
      const rate = processed / elapsedSec; // symbols/sec
      if (rate > 0) etaSeconds = Math.round((total - processed) / rate);
    }

    setProgress({
      status,
      totalQueued: total,
      processed,
      qualified: data.qualified ?? 0,
      failed: data.failed ?? 0,
      startedAt,
      lastUpdated: data.last_updated,
      etaSeconds,
    });
  }, []);

  // ── Initial load + polling ──
  useEffect(() => {
    loadStocks();
    loadProgress();
    pollRef.current = window.setInterval(loadProgress, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadStocks, loadProgress]);

  // Reload stocks whenever qualified count grows
  useEffect(() => {
    if (progress.qualified > 0) {
      loadStocks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.qualified]);

  // ── Start / Resume heavy scan ──
  // mode "resume" (default) continues from last point; "restart" wipes and reseeds.
  const rebuildUniverse = useCallback(async (mode: "resume" | "restart" = "resume") => {
    setError(null);
    setIsMutatingScan(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("seed-universe-queue", {
        body: { mode },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      await loadProgress();
    } catch (e) {
      console.error("rebuildUniverse error:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsMutatingScan(false);
    }
  }, [loadProgress]);

  // ── Pause / Resume cron worker ──
  const pauseScan = useCallback(async () => {
    setIsMutatingScan(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("pause-universe-scan", {
        body: { action: "pause" },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      await loadProgress();
    } catch (e) {
      console.error("pauseScan error:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsMutatingScan(false);
    }
  }, [loadProgress]);

  const resumeScan = useCallback(async () => {
    // Resume = same as rebuild "resume" (re-enables cron, recovers stuck symbols)
    await rebuildUniverse("resume");
  }, [rebuildUniverse]);

  // ── Recalculate RS scores (Stage 2) ──
  // Uses raw fetch (not supabase.functions.invoke) so we can set a long
  // per-batch timeout and continue past transient failures.
  const recalculateRs = useCallback(async () => {
    setError(null);
    setIsRecalculating(true);
    setRecalcStatus("Starting RS recalculation…");

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
    const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const url = `${SUPABASE_URL}/functions/v1/calculate-rs-scores`;
    const PER_BATCH_TIMEOUT_MS = 120_000; // 2 min per batch

    const callBatch = async (offset: number) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token ?? ANON_KEY;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PER_BATCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: ANON_KEY,
          },
          body: JSON.stringify({ offset }),
          signal: ctrl.signal,
        });
        const text = await res.text();
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}: ${text.slice(0, 200)}`);
        if (json?.error) throw new Error(json.error);
        return json;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let offset = 0;
      let done = false;
      let consecutiveFailures = 0;
      while (!done) {
        try {
          const data = await callBatch(offset);
          consecutiveFailures = 0;
          done = data?.done ?? true;
          const nextOffset = data?.next_offset ?? null;
          const total = data?.total ?? 0;
          const processed = data?.processed ?? offset;
          setRecalcStatus(`Calculated ${processed} / ${total} stocks…`);
          if (done || nextOffset === null) break;
          offset = nextOffset;
        } catch (batchErr) {
          consecutiveFailures++;
          console.warn(`Batch at offset ${offset} failed (attempt ${consecutiveFailures}):`, batchErr);
          if (consecutiveFailures >= 3) throw batchErr;
          setRecalcStatus(`Retrying batch at ${offset} (attempt ${consecutiveFailures + 1})…`);
          await new Promise((r) => setTimeout(r, 2000 * consecutiveFailures));
        }
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

  const isRebuilding = progress.status === "running";
  const isPaused = progress.status === "paused";

  return {
    stocks,
    isLoading,
    isRebuilding,
    isPaused,
    isMutatingScan,
    isRecalculating,
    recalcStatus,
    error,
    progress,
    rebuildUniverse,         // call with "resume" (default) or "restart"
    pauseScan,
    resumeScan,
    recalculateRs,
    reload: loadStocks,
  };
}
