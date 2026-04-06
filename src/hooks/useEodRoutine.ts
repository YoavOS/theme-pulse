import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { calculateDispersion, getDispersionShortLabel } from "@/hooks/useDispersion";
import { saveWeeklyVolumeHistory } from "@/hooks/useVolumeDryUp";
import { ThemeData } from "@/data/themeData";
import { persistAlert, type AlertInsert } from "@/hooks/useAlertHistory";

// ── Types ──

export interface EodRoutineStep {
  id: number;
  label: string;
  emoji: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
}

export interface EodRoutineSummary {
  date: string;
  tickersScanned: number;
  eodPricesSaved: number;
  themesBreadthRecorded: number;
  dispersionScore: number;
  dispersionLabel: string;
  volumeAlerts: number;
  momentumAlerts: number;
  watchlistAlerts: number;
  newsRefreshed: number;
  weeklyReportGenerated: boolean;
  elapsedTime: string;
  completedAt: string;
  failedSteps: string[];
}

export interface EodRoutineState {
  isRunning: boolean;
  currentStep: number;
  totalSteps: number;
  steps: EodRoutineStep[];
  progress: number;
  summary: EodRoutineSummary | null;
  showConfirmDialog: boolean;
  lastCompletedToday: { time: string; summary: EodRoutineSummary } | null;
}

// ── Helpers ──

const ROUTINE_STORAGE_KEY = "lastEodRoutine";
const TOTAL_STEPS = 15;

function getTodayET() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, "0");
  const day = String(et.getDate()).padStart(2, "0");
  const dayOfWeek = et.getDay();
  return {
    dateStr: `${year}-${month}-${day}`,
    hour: et.getHours(),
    minute: et.getMinutes(),
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
  };
}

function getLastFriday(): string {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const dayOfWeek = et.getDay();
  const daysBack = dayOfWeek === 0 ? 2 : dayOfWeek === 6 ? 1 : dayOfWeek === 5 ? 0 : dayOfWeek;
  et.setDate(et.getDate() - daysBack);
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

function getStoredCompletion(): { time: string; summary: EodRoutineSummary } | null {
  try {
    const raw = localStorage.getItem(ROUTINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { dateStr } = getTodayET();
    if (parsed.date === dateStr) return { time: parsed.time, summary: parsed.summary };
    return null;
  } catch {
    return null;
  }
}

function getPreviousTradingDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Hook ──

export function useEodRoutine(
  onDashboardUpdate?: (themes: ThemeData[], timeframe: string) => void,
  buildThemesFromPerf?: (timeframe: string) => Promise<ThemeData[]>,
) {
  const { toast } = useToast();
  const [state, setState] = useState<EodRoutineState>({
    isRunning: false,
    currentStep: 0,
    totalSteps: TOTAL_STEPS,
    steps: [],
    progress: 0,
    summary: null,
    showConfirmDialog: false,
    lastCompletedToday: getStoredCompletion(),
  });

  const abortRef = useRef(false);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };

  const { dateStr, hour, minute, dayOfWeek, isWeekend } = getTodayET();
  const isAfterClose = hour >= 16;
  const isBeforeOpen = hour < 9 || (hour === 9 && minute < 30);
  const isEnabled = isWeekend || isAfterClose || isBeforeOpen;
  const isFriday = dayOfWeek === 5;
  const shouldSaveVolume = isFriday || isWeekend;
  const usePc = isWeekend;
  const targetDate = isWeekend ? getLastFriday() : dateStr;

  const buttonLabel = state.lastCompletedToday
    ? `✓ EOD Complete · last run at ${state.lastCompletedToday.time}`
    : isWeekend
    ? "📅 EOD Routine (Friday Close)"
    : isBeforeOpen
    ? "📅 EOD Routine (Yesterday's Close)"
    : "📅 EOD Routine";

  const tooltip = !isEnabled
    ? "Available when market is closed (before 9:30 AM or after 4:00 PM ET)"
    : state.lastCompletedToday
    ? "Routine already completed today. Click to re-run."
    : "Run complete end-of-day workflow";

  const openConfirmDialog = useCallback(() => setState(s => ({ ...s, showConfirmDialog: true })), []);
  const closeConfirmDialog = useCallback(() => setState(s => ({ ...s, showConfirmDialog: false })), []);

  const updateStep = useCallback((stepId: number, updates: Partial<EodRoutineStep>) => {
    setState(s => ({
      ...s,
      steps: s.steps.map(step => step.id === stepId ? { ...step, ...updates } : step),
    }));
  }, []);

  const setProgressPct = useCallback((step: number) => {
    const pct = Math.min(100, Math.round((step / TOTAL_STEPS) * 100));
    setState(s => ({ ...s, currentStep: step, progress: pct }));
  }, []);

  const runRoutine = useCallback(async () => {
    setState(s => ({ ...s, showConfirmDialog: false }));
    abortRef.current = false;
    const startTime = Date.now();

    const initialSteps: EodRoutineStep[] = [
      { id: 1, label: "Full Scan", emoji: "📡", status: "pending" },
      { id: 2, label: "Save EOD Prices", emoji: "💾", status: "pending" },
      { id: 3, label: "Save Breadth History", emoji: "📊", status: "pending" },
      { id: 4, label: "Calculate Dispersion", emoji: "📈", status: "pending" },
      { id: 5, label: "Volume Analysis", emoji: "⚡", status: shouldSaveVolume ? "pending" : "skipped" },
      { id: 6, label: "Breadth Alerts", emoji: "🔔", status: "pending" },
      { id: 7, label: "Volume Alerts", emoji: "⚡", status: "pending" },
      { id: 8, label: "Momentum Alerts", emoji: "🚀", status: "pending" },
      { id: 9, label: "Watchlist Alerts", emoji: "📌", status: "pending" },
      { id: 10, label: "SPY Benchmark", emoji: "🏦", status: "pending" },
      { id: 11, label: "Theme Intelligence", emoji: "🧠", status: "pending" },
      { id: 12, label: "AI Narrative", emoji: "✍️", status: "pending" },
      { id: 13, label: "News Refresh", emoji: "📰", status: "pending" },
      { id: 14, label: "Fundamentals Refresh", emoji: "📋", status: "pending" },
      { id: 15, label: "Weekly Report", emoji: "🗞", status: shouldSaveVolume ? "pending" : "skipped" },
    ];

    setState(s => ({
      ...s,
      isRunning: true,
      currentStep: 1,
      steps: initialSteps,
      progress: 0,
      summary: null,
    }));

    let tickersScanned = 0;
    let eodPricesSaved = 0;
    let themesBreadthRecorded = 0;
    let dispersionScore = 0;
    let dispersionLabel = "";
    let volumeAlerts = 0;
    let momentumAlerts = 0;
    let watchlistAlerts = 0;
    let newsRefreshed = 0;
    let weeklyReportGenerated = false;
    const failedSteps: string[] = [];

    let scanPerfData: { symbol: string; price: number; perf_1d: number; perf_1w?: number }[] = [];
    let themes: { id: string; name: string }[] = [];
    let tickers: { theme_id: string; ticker_symbol: string }[] = [];
    let themeMap = new Map<string, string>(); // symbol -> theme name
    let themeSymbolsMap = new Map<string, string[]>(); // theme_id -> symbols

    const persistSaveSession = async (overrides: {
      completed_at?: string | null;
      dispersion_score?: number | null;
      failed_count?: number;
      failed_symbols?: string[];
      saved_count?: number;
      status?: string;
      total_tickers?: number;
    } = {}) => {
      const { error } = await supabase.from("eod_save_sessions").upsert({
        date: targetDate,
        status: "in_progress",
        total_tickers: tickersScanned,
        saved_count: eodPricesSaved,
        failed_count: Math.max(0, tickersScanned - eodPricesSaved),
        failed_symbols: [],
        started_at: new Date(startTime).toISOString(),
        completed_at: null,
        dispersion_score: null,
        ...overrides,
      }, { onConflict: "date" });

      if (error) {
        console.error("Failed to persist EOD session:", error);
      }
    };

    try {
      await persistSaveSession();

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: DATA COLLECTION (blocking — abort on failure)
      // ═══════════════════════════════════════════════════════════════

      // STEP 1: Full Scan — identical to manual Full Scan button
      updateStep(1, { status: "running", detail: "Initializing scan..." });
      setProgressPct(1);

      const startRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=start`, { headers });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Failed to initialize scan");

      const totalTickers = startData.total || 0;
      updateStep(1, { detail: `Scanning: 0 / ${totalTickers}` });

      let scanDone = false;
      let chunkFailures = 0;
      while (!scanDone && !abortRef.current) {
        try {
          const chunkRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=chunk`, { headers });
          if (!chunkRes.ok) {
            let errorMessage = `HTTP ${chunkRes.status}`;
            try {
              const errorBody = await chunkRes.json();
              errorMessage = errorBody?.error || errorMessage;
            } catch {
              // Ignore JSON parse failures on transient chunk errors
            }
            throw new Error(errorMessage);
          }

          const chunkData = await chunkRes.json();
          scanDone = chunkData.done;
          chunkFailures = 0;
        } catch (error) {
          chunkFailures += 1;

          const statusRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers }).catch(() => null);
          const statusData = statusRes && statusRes.ok ? await statusRes.json() : null;
          const done = statusData?.done || 0;
          const total = statusData?.total || totalTickers;
          const pending = statusData?.pending ?? Math.max(total - done, 0);

          updateStep(1, {
            detail: chunkFailures < 3
              ? `Transient scan error — retrying (${done} / ${total})`
              : `Scan failed at ${done} / ${total}`,
          });
          setState(s => ({
            ...s,
            progress: Math.round((done / Math.max(total, 1)) * (100 / TOTAL_STEPS)),
          }));

          if (pending === 0 && done > 0) {
            scanDone = true;
            break;
          }

          if (chunkFailures >= 3) {
            throw new Error(`Scan chunk failed after ${chunkFailures} attempts: ${error instanceof Error ? error.message : String(error)}`);
          }

          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const statusRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers });
        const statusData = await statusRes.json();
        const done = statusData.done || 0;
        const total = statusData.total || totalTickers;
        updateStep(1, { detail: `Scanning: ${done} / ${total}` });
        setState(s => ({ ...s, progress: Math.round((done / Math.max(total, 1)) * (100 / TOTAL_STEPS)) }));

        if (!scanDone) await new Promise(r => setTimeout(r, 300));
      }

      // Verify scan completeness
      const { data: perfData, error: perfErr } = await supabase
        .from("ticker_performance")
        .select("symbol, price, perf_1d, perf_1w")
        .not("price", "is", null)
        .gt("price", 0);

      if (perfErr || !perfData || perfData.length === 0) {
        throw new Error("No scan data available after scan completed");
      }

      const expectedMin = Math.floor(totalTickers * 0.75);
      if (perfData.length < expectedMin) {
        throw new Error(`Scan incomplete — only ${perfData.length}/${totalTickers} tickers have valid prices. Try again.`);
      }

      scanPerfData = perfData;
      tickersScanned = perfData.length;
      updateStep(1, { status: "done", detail: `${tickersScanned} tickers` });

      // ★ DASHBOARD UPDATE: Build themes and push to dashboard (identical to Full Scan)
      if (buildThemesFromPerf && onDashboardUpdate) {
        try {
          // Clear perf cache so buildThemesFromPerf fetches fresh from DB
          localStorage.removeItem("ticker_perf_cache");
          const freshThemes = await buildThemesFromPerf("Today");
          if (freshThemes.length > 0) {
            onDashboardUpdate(freshThemes, "Today");
          }
        } catch (e) {
          console.warn("Dashboard update after scan failed:", e);
        }
      }

      setProgressPct(2);

      // STEP 2: Save EOD Prices
      updateStep(2, { status: "running", detail: "Preparing..." });

      const [themesRes, tickersRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
      ]);

      themes = themesRes.data || [];
      tickers = tickersRes.data || [];

      const idToName = new Map(themes.map(t => [t.id, t.name]));
      for (const t of tickers) {
        if (!themeMap.has(t.ticker_symbol)) {
          themeMap.set(t.ticker_symbol, idToName.get(t.theme_id) || "Unknown");
        }
      }

      // Build themeSymbolsMap for reuse
      for (const tk of tickers) {
        const arr = themeSymbolsMap.get(tk.theme_id) || [];
        arr.push(tk.ticker_symbol);
        themeSymbolsMap.set(tk.theme_id, arr);
      }

      // Deduplicate by symbol — only save once per symbol
      const seenSymbols = new Set<string>();
      const eodRows: any[] = [];
      for (const p of scanPerfData) {
        if (seenSymbols.has(p.symbol)) continue;
        seenSymbols.add(p.symbol);
        eodRows.push({
          symbol: p.symbol,
          theme_name: themeMap.get(p.symbol) || "Unknown",
          date: targetDate,
          close_price: p.price || 0,
          open_price: null,
          high_price: null,
          low_price: null,
          volume: null,
          source: usePc ? "friday_pc_save" : "scan_save",
          is_backfill: false,
        });
      }

      if (eodRows.length === 0) {
        throw new Error("No EOD rows were prepared from the scan results");
      }

      updateStep(2, { detail: `Saving ${eodRows.length} prices...` });

      const BATCH = 50;
      for (let i = 0; i < eodRows.length; i += BATCH) {
        const { error } = await supabase
          .from("eod_prices")
          .upsert(eodRows.slice(i, i + BATCH), { onConflict: "symbol,date" });
        if (error) {
          throw new Error(`Failed to save EOD prices: ${error.message}`);
        }
      }

      // Verify save for exactly the symbols written by this routine.
      let savedCount = 0;
      for (let i = 0; i < eodRows.length; i += BATCH) {
        const symbols = eodRows.slice(i, i + BATCH).map(row => row.symbol);
        const { count, error } = await supabase
          .from("eod_prices")
          .select("symbol", { count: "exact", head: true })
          .eq("date", targetDate)
          .in("symbol", symbols);

        if (error) {
          throw new Error(`Failed to verify saved EOD prices: ${error.message}`);
        }

        savedCount += count || 0;
      }

      eodPricesSaved = savedCount;
      if (eodPricesSaved < Math.floor(tickersScanned * 0.75)) {
        console.warn(`EOD save incomplete: ${eodPricesSaved}/${tickersScanned} — continuing anyway`);
      }

      await persistSaveSession({
        completed_at: new Date().toISOString(),
        failed_count: Math.max(0, tickersScanned - eodPricesSaved),
        saved_count: eodPricesSaved,
        status: "completed",
        total_tickers: tickersScanned,
      });

      updateStep(2, { status: "done", detail: `${eodPricesSaved} rows` });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: ANALYTICS (sequential — individual failures don't abort)
      // ═══════════════════════════════════════════════════════════════

      const perfMap = new Map(scanPerfData.map(p => [p.symbol, p]));

      // STEP 3: Save Breadth History
      setProgressPct(3);
      updateStep(3, { status: "running", detail: "Calculating..." });

      try {
        const breadthRows: any[] = [];
        for (const theme of themes) {
          const symbols = themeSymbolsMap.get(theme.id) || [];
          if (symbols.length === 0) continue;
          const valid = symbols.filter(s => perfMap.has(s));
          if (valid.length === 0) continue;
          const advancing = valid.filter(s => (perfMap.get(s)?.perf_1d || 0) > 0).length;
          const declining = valid.length - advancing;
          const breadthPct = Math.round((advancing / valid.length) * 100);
          breadthRows.push({
            theme_name: theme.name,
            date: targetDate,
            advancing,
            declining,
            total: valid.length,
            breadth_pct: breadthPct,
          });
        }
        for (let i = 0; i < breadthRows.length; i += BATCH) {
          await supabase.from("theme_breadth_history").upsert(breadthRows.slice(i, i + BATCH), { onConflict: "theme_name,date" });
        }
        themesBreadthRecorded = breadthRows.length;
        updateStep(3, { status: "done", detail: `${themesBreadthRecorded} themes` });
      } catch (err) {
        console.error("Breadth save failed:", err);
        failedSteps.push("Breadth History");
        updateStep(3, { status: "failed", detail: "Failed" });
      }

      // STEP 4: Calculate Dispersion
      setProgressPct(4);
      updateStep(4, { status: "running", detail: "Analyzing..." });

      try {
        const themePerfs: number[] = [];
        for (const theme of themes) {
          const symbols = themeSymbolsMap.get(theme.id) || [];
          const validPerfs = symbols.map(s => perfMap.get(s)?.perf_1d).filter((v): v is number => v !== undefined);
          if (validPerfs.length > 0) {
            themePerfs.push(validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length);
          }
        }
        dispersionScore = calculateDispersion(themePerfs);
        dispersionLabel = getDispersionShortLabel(dispersionScore);

        await persistSaveSession({
          completed_at: new Date().toISOString(),
          dispersion_score: dispersionScore,
          failed_count: Math.max(0, tickersScanned - eodPricesSaved),
          saved_count: eodPricesSaved,
          status: "completed",
          total_tickers: tickersScanned,
        });

        updateStep(4, { status: "done", detail: `${dispersionScore.toFixed(1)}σ (${dispersionLabel})` });
      } catch (err) {
        console.error("Dispersion calc failed:", err);
        failedSteps.push("Dispersion");
        updateStep(4, { status: "failed", detail: "Failed" });
      }

      // STEP 5: Volume Analysis & Dry-Up Detection
      setProgressPct(5);
      if (shouldSaveVolume) {
        updateStep(5, { status: "running", detail: "Saving weekly volume..." });
        try {
          await saveWeeklyVolumeHistory();
          updateStep(5, { status: "done", detail: "Complete" });
        } catch (err) {
          console.error("Volume history failed:", err);
          failedSteps.push("Volume History");
          updateStep(5, { status: "failed", detail: "Failed" });
        }
      }

      // STEP 6: Breadth Alerts
      setProgressPct(6);
      updateStep(6, { status: "running", detail: "Checking breadth shifts..." });

      let breadthAlertCount = 0;
      try {
        const yesterdayDate = getPreviousTradingDate(targetDate);
        const [todayBreadth, yesterdayBreadth] = await Promise.all([
          supabase.from("theme_breadth_history").select("theme_name, breadth_pct").eq("date", targetDate),
          supabase.from("theme_breadth_history").select("theme_name, breadth_pct").eq("date", yesterdayDate),
        ]);

        if (todayBreadth.data && yesterdayBreadth.data) {
          const yesterdayMap = new Map(yesterdayBreadth.data.map(r => [r.theme_name, r.breadth_pct]));
          for (const row of todayBreadth.data) {
            const yesterdayVal = yesterdayMap.get(row.theme_name);
            if (yesterdayVal === undefined) continue;
            const change = (row.breadth_pct ?? 0) - yesterdayVal;
            const isSurge = yesterdayVal < 35 && (row.breadth_pct ?? 0) > 65;
            const isCollapse = yesterdayVal > 65 && (row.breadth_pct ?? 0) < 35;
            const isLargeJump = Math.abs(change) > 40;

            if (isSurge || (isLargeJump && change > 0)) {
              breadthAlertCount++;
              toast({ title: `🚀 ${row.theme_name} breadth surged`, description: `${yesterdayVal}% → ${row.breadth_pct}% — potential rotation signal`, duration: 10000 });
              persistAlert({ date: targetDate, theme_name: row.theme_name, alert_type: "breadth_surge", severity: "medium", title: `${row.theme_name} breadth surged`, description: `${yesterdayVal}% → ${row.breadth_pct}% — potential rotation signal`, value_before: yesterdayVal, value_after: row.breadth_pct ?? 0 });
            } else if (isCollapse || (isLargeJump && change < 0)) {
              breadthAlertCount++;
              toast({ title: `⚠ ${row.theme_name} breadth collapsed`, description: `${yesterdayVal}% → ${row.breadth_pct}% — watch for reversal`, variant: "destructive", duration: 10000 });
              persistAlert({ date: targetDate, theme_name: row.theme_name, alert_type: "breadth_collapse", severity: "high", title: `${row.theme_name} breadth collapsed`, description: `${yesterdayVal}% → ${row.breadth_pct}% — watch for reversal`, value_before: yesterdayVal, value_after: row.breadth_pct ?? 0 });
            }
          }
        }
        updateStep(6, { status: "done", detail: breadthAlertCount > 0 ? `${breadthAlertCount} alerts` : "No alerts" });
      } catch (err) {
        console.error("Breadth alerts failed:", err);
        failedSteps.push("Breadth Alerts");
        updateStep(6, { status: "failed", detail: "Failed" });
      }

      // STEP 7: Volume Alerts
      setProgressPct(7);
      updateStep(7, { status: "running", detail: "Checking volume..." });

      try {
        const { data: volData } = await supabase.from("ticker_volume_cache").select("symbol, today_vol, avg_20d");
        if (volData) {
          const volMap = new Map(volData.map(v => [v.symbol, v]));
          for (const theme of themes) {
            const symbols = themeSymbolsMap.get(theme.id) || [];
            const relVols = symbols.map(s => {
              const v = volMap.get(s);
              if (!v || !v.avg_20d || v.avg_20d <= 0 || !v.today_vol) return null;
              return Number(v.today_vol) / Number(v.avg_20d);
            }).filter((v): v is number => v !== null);

            if (relVols.length === 0) continue;
            const avgRelVol = relVols.reduce((a, b) => a + b, 0) / relVols.length;

            if (avgRelVol > 2.5) {
              volumeAlerts++;
              toast({ title: `⚡ ${theme.name} unusual volume spike`, description: `${avgRelVol.toFixed(1)}× average volume`, duration: 8000 });
              persistAlert({ date: targetDate, theme_name: theme.name, alert_type: "volume_spike", severity: avgRelVol > 3 ? "high" : "medium", title: `${theme.name} unusual volume spike`, description: `${avgRelVol.toFixed(1)}× average volume`, value_after: avgRelVol, threshold: 2.5 });
            }
          }
        }
        updateStep(7, { status: "done", detail: volumeAlerts > 0 ? `${volumeAlerts} alerts` : "No alerts" });
      } catch (err) {
        console.error("Volume alerts failed:", err);
        failedSteps.push("Volume Alerts");
        updateStep(7, { status: "failed", detail: "Failed" });
      }

      // STEP 8: Momentum Alerts
      setProgressPct(8);
      updateStep(8, { status: "running", detail: "Checking momentum..." });

      try {
        // Get last 5 EOD sessions for historical comparison
        const { data: recentEod } = await supabase
          .from("eod_prices")
          .select("symbol, date, close_price")
          .order("date", { ascending: false })
          .limit(5000);

        const todayBreadthData = await supabase.from("theme_breadth_history").select("theme_name, breadth_pct").eq("date", targetDate);
        const breadthMap = new Map((todayBreadthData.data || []).map(r => [r.theme_name, r.breadth_pct ?? 0]));

        for (const theme of themes) {
          const symbols = themeSymbolsMap.get(theme.id) || [];
          const validPerfs = symbols.map(s => perfMap.get(s)?.perf_1d).filter((v): v is number => v !== undefined);
          if (validPerfs.length === 0) continue;
          const avgPerf = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
          const breadth = breadthMap.get(theme.name) ?? 50;

          // Breaking out: up >3% with breadth >75%
          if (avgPerf > 3 && breadth > 75) {
            momentumAlerts++;
            toast({ title: `🚀 ${theme.name} breaking out`, description: `+${avgPerf.toFixed(1)}% with ${breadth}% breadth`, duration: 8000 });
          }

          // Check for new 5-day highs/lows using EOD data
          if (recentEod) {
            const uniqueDates = [...new Set(recentEod.filter(r => symbols.includes(r.symbol)).map(r => r.date))].sort().reverse().slice(0, 5);
            if (uniqueDates.length >= 3) {
              const datePerfs: number[] = [];
              for (const d of uniqueDates) {
                const dayRows = recentEod.filter(r => r.date === d && symbols.includes(r.symbol));
                if (dayRows.length > 0) {
                  // Use close prices to calculate a simple avg
                  const avg = dayRows.reduce((s, r) => s + Number(r.close_price), 0) / dayRows.length;
                  datePerfs.push(avg);
                }
              }
              // Simple high/low check vs today's avg price
              const todayAvgPrice = symbols.map(s => perfMap.get(s)?.price || 0).filter(v => v > 0);
              if (todayAvgPrice.length > 0 && datePerfs.length >= 3) {
                const todayAvg = todayAvgPrice.reduce((a, b) => a + b, 0) / todayAvgPrice.length;
                const isNewHigh = datePerfs.every(p => todayAvg > p);
                const isNewLow = datePerfs.every(p => todayAvg < p);
                if (isNewHigh && avgPerf > 1) {
                  momentumAlerts++;
                  toast({ title: `📈 ${theme.name} new 5-day high`, description: `Avg price at highest in 5 sessions`, duration: 6000 });
                }
                if (isNewLow && avgPerf < -1) {
                  momentumAlerts++;
                  toast({ title: `📉 ${theme.name} new 5-day low`, description: `Avg price at lowest in 5 sessions`, duration: 6000 });
                }
              }
            }
          }
        }
        updateStep(8, { status: "done", detail: momentumAlerts > 0 ? `${momentumAlerts} alerts` : "No alerts" });
      } catch (err) {
        console.error("Momentum alerts failed:", err);
        failedSteps.push("Momentum Alerts");
        updateStep(8, { status: "failed", detail: "Failed" });
      }

      // STEP 9: Watchlist Alerts
      setProgressPct(9);
      updateStep(9, { status: "running", detail: "Checking watchlist..." });

      try {
        const pinnedRaw = localStorage.getItem("pinnedThemes");
        const alertsRaw = localStorage.getItem("watchlistAlerts");
        const pinned: string[] = pinnedRaw ? JSON.parse(pinnedRaw) : [];
        const alertConfigs: Record<string, { up: number | null; down: number | null; relVol: number | null }> = alertsRaw ? JSON.parse(alertsRaw) : {};

        if (pinned.length > 0) {
          for (const themeName of pinned) {
            const config = alertConfigs[themeName];
            if (!config) continue;

            const theme = themes.find(t => t.name === themeName);
            if (!theme) continue;

            const symbols = themeSymbolsMap.get(theme.id) || [];
            const perf1wVals = symbols.map(s => perfMap.get(s)?.perf_1w).filter((v): v is number => v !== undefined);
            const avgPerf1w = perf1wVals.length > 0 ? perf1wVals.reduce((a, b) => a + b, 0) / perf1wVals.length : 0;

            if (config.up !== null && avgPerf1w > config.up) {
              watchlistAlerts++;
              toast({ title: `📌 ${themeName} hit upside target`, description: `1W: +${avgPerf1w.toFixed(1)}% (threshold: ${config.up}%)`, duration: 10000 });
            }
            if (config.down !== null && avgPerf1w < -Math.abs(config.down)) {
              watchlistAlerts++;
              toast({ title: `📌 ${themeName} hit downside target`, description: `1W: ${avgPerf1w.toFixed(1)}% (threshold: -${Math.abs(config.down)}%)`, variant: "destructive", duration: 10000 });
            }
          }
        }
        updateStep(9, { status: "done", detail: watchlistAlerts > 0 ? `${watchlistAlerts} alerts` : "No alerts" });
      } catch (err) {
        console.error("Watchlist alerts failed:", err);
        failedSteps.push("Watchlist Alerts");
        updateStep(9, { status: "failed", detail: "Failed" });
      }

      // STEP 10: SPY Benchmark Update
      setProgressPct(10);
      updateStep(10, { status: "running", detail: "Updating SPY..." });

      try {
        const spyData = scanPerfData.find(p => p.symbol === "SPY");
        if (spyData) {
          // Save SPY to eod_prices with __BENCHMARK__ theme
          await supabase.from("eod_prices").upsert({
            symbol: "SPY",
            theme_name: "__BENCHMARK__",
            date: targetDate,
            close_price: spyData.price,
            source: usePc ? "friday_pc_save" : "scan_save",
            is_backfill: false,
          }, { onConflict: "symbol,date" });

          // Clear SPY cache so it refreshes
          localStorage.removeItem("spyBenchmark");
          updateStep(10, { status: "done", detail: `SPY: ${spyData.perf_1d >= 0 ? "+" : ""}${spyData.perf_1d.toFixed(2)}%` });
        } else {
          updateStep(10, { status: "done", detail: "SPY not in scan" });
        }
      } catch (err) {
        console.error("SPY update failed:", err);
        failedSteps.push("SPY Benchmark");
        updateStep(10, { status: "failed", detail: "Failed" });
      }

      // STEP 11: Update Theme Intelligence (React state update via dashboard callback)
      setProgressPct(11);
      updateStep(11, { status: "running", detail: "Refreshing intelligence..." });

      try {
        // The dashboard was already updated in Step 1. This step ensures all derived data is fresh.
        // Re-trigger buildThemesFromPerf for "Today" to refresh all views
        if (buildThemesFromPerf && onDashboardUpdate) {
          const freshThemes = await buildThemesFromPerf("Today");
          if (freshThemes.length > 0) {
            onDashboardUpdate(freshThemes, "Today");
          }
        }
        updateStep(11, { status: "done", detail: "Updated" });
      } catch (err) {
        console.error("Intelligence update failed:", err);
        failedSteps.push("Theme Intelligence");
        updateStep(11, { status: "failed", detail: "Failed" });
      }

      setState(s => ({ ...s, progress: 80 }));

      // ═══════════════════════════════════════════════════════════════
      // PHASE 3: INTELLIGENCE (background, non-blocking)
      // ═══════════════════════════════════════════════════════════════

      const backgroundTasks: Promise<void>[] = [];

      // STEP 12: AI Narrative
      updateStep(12, { status: "running", detail: "Generating..." });
      backgroundTasks.push((async () => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/generate-theme-narrative`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ts: Date.now() }),
          });
          if (res.ok) {
            updateStep(12, { status: "done", detail: "Generated" });
          } else {
            updateStep(12, { status: "failed", detail: "Failed" });
            failedSteps.push("AI Narrative");
          }
        } catch {
          updateStep(12, { status: "failed", detail: "Failed" });
          failedSteps.push("AI Narrative");
        }
      })());

      // STEP 13: News Refresh
      updateStep(13, { status: "running", detail: "Fetching news..." });
      backgroundTasks.push((async () => {
        try {
          // Get top 5 themes by absolute performance
          const themePerfs: { name: string; perf: number }[] = [];
          for (const theme of themes) {
            const symbols = themeSymbolsMap.get(theme.id) || [];
            const validPerfs = symbols.map(s => perfMap.get(s)?.perf_1d).filter((v): v is number => v !== undefined);
            if (validPerfs.length > 0) {
              const avg = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
              themePerfs.push({ name: theme.name, perf: Math.abs(avg) });
            }
          }
          const top5 = themePerfs.sort((a, b) => b.perf - a.perf).slice(0, 5);
          for (const t of top5) {
            await fetch(`${supabaseUrl}/functions/v1/fetch-theme-news`, {
              method: "POST",
              headers,
              body: JSON.stringify({ themeName: t.name }),
            }).catch(() => {});
          }
          newsRefreshed = top5.length;
          updateStep(13, { status: "done", detail: `${newsRefreshed} themes` });
        } catch {
          updateStep(13, { status: "failed", detail: "Failed" });
          failedSteps.push("News Refresh");
        }
      })());

      // STEP 14: Fundamentals Refresh
      updateStep(14, { status: "running", detail: "Checking staleness..." });
      backgroundTasks.push((async () => {
        try {
          const { data: staleFund } = await supabase
            .from("fundamentals_cache")
            .select("symbol, last_updated")
            .order("last_updated", { ascending: true })
            .limit(1);

          const staleCutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
          const needsRefresh = !staleFund || staleFund.length === 0 ||
            (staleFund[0].last_updated && staleFund[0].last_updated < staleCutoff);

          if (needsRefresh) {
            const themePerfs: { name: string; symbols: string[]; perf: number }[] = [];
            for (const theme of themes) {
              const symbols = themeSymbolsMap.get(theme.id) || [];
              const validPerfs = symbols.map(s => perfMap.get(s)?.perf_1d).filter((v): v is number => v !== undefined);
              if (validPerfs.length > 0) {
                const avg = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
                themePerfs.push({ name: theme.name, symbols, perf: Math.abs(avg) });
              }
            }
            const top10Themes = themePerfs.sort((a, b) => b.perf - a.perf).slice(0, 10);
            const symbolsToFetch = [...new Set(top10Themes.flatMap(t => t.symbols))].slice(0, 50);

            for (let i = 0; i < symbolsToFetch.length; i += 10) {
              const batch = symbolsToFetch.slice(i, i + 10);
              await fetch(`${supabaseUrl}/functions/v1/fetch-fundamentals`, {
                method: "POST",
                headers,
                body: JSON.stringify({ symbols: batch }),
              }).catch(() => {});
            }
            updateStep(14, { status: "done", detail: `${symbolsToFetch.length} symbols` });
          } else {
            updateStep(14, { status: "done", detail: "Cache fresh" });
          }
        } catch {
          updateStep(14, { status: "failed", detail: "Failed" });
          failedSteps.push("Fundamentals Refresh");
        }
      })());

      // STEP 15: Weekly Report (Fridays/weekends only)
      if (shouldSaveVolume) {
        updateStep(15, { status: "running", detail: "Generating report..." });
        backgroundTasks.push((async () => {
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-weekly-report`, {
              method: "POST",
              headers,
              body: JSON.stringify({}),
            });
            const body = await res.json().catch(() => null);

            if (body?.insufficient_data) {
              updateStep(15, { status: "skipped", detail: `Waiting for more data (${body.days_available} days)` });
              toast({ title: "🗞 Weekly report pending", description: body.error });
            } else if (res.ok) {
              weeklyReportGenerated = true;
              updateStep(15, { status: "done", detail: "Generated" });
              toast({ title: "📊 Weekly report generated" });
            } else {
              updateStep(15, { status: "failed", detail: body?.error || "Failed" });
              failedSteps.push("Weekly Report");
            }
          } catch {
            updateStep(15, { status: "failed", detail: "Failed" });
            failedSteps.push("Weekly Report");
          }
        })());
      }

      // Wait for all background tasks (don't block on failures)
      await Promise.allSettled(backgroundTasks);

      setState(s => ({ ...s, progress: 100 }));

      // ═══════════════════════════════════════════════════════════════
      // COMPLETION
      // ═══════════════════════════════════════════════════════════════

      const elapsedMs = Date.now() - startTime;
      const summary: EodRoutineSummary = {
        date: targetDate,
        tickersScanned,
        eodPricesSaved,
        themesBreadthRecorded,
        dispersionScore,
        dispersionLabel,
        volumeAlerts,
        momentumAlerts,
        watchlistAlerts,
        newsRefreshed,
        weeklyReportGenerated,
        elapsedTime: formatElapsed(elapsedMs),
        completedAt: new Date().toISOString(),
        failedSteps,
      };

      const completionTime = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      localStorage.setItem(ROUTINE_STORAGE_KEY, JSON.stringify({
        date: dateStr,
        time: completionTime,
        summary,
      }));

      setState(s => ({
        ...s,
        isRunning: false,
        summary,
        lastCompletedToday: { time: completionTime, summary },
      }));

      toast({
        title: "✓ EOD Routine complete",
        description: `${tickersScanned} tickers · ${eodPricesSaved} EOD saved · ${dispersionScore.toFixed(1)}σ dispersion`,
        className: "border-[hsl(174,80%,50%)]/40 bg-[hsl(174,80%,50%)]/10 text-[hsl(174,80%,50%)]",
      });

    } catch (err) {
      console.error("EOD Routine failed:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);

      await persistSaveSession({
        completed_at: eodPricesSaved > 0 ? new Date().toISOString() : null,
        dispersion_score: dispersionScore || null,
        failed_count: Math.max(0, tickersScanned - eodPricesSaved),
        saved_count: eodPricesSaved,
        status: eodPricesSaved > 0 ? "completed" : "failed",
        total_tickers: tickersScanned,
      });

      toast({
        title: "EOD Routine failed",
        description: errorMsg,
        variant: "destructive",
      });

      setState(s => ({ ...s, isRunning: false }));
    }
  }, [toast, supabaseUrl, anonKey, targetDate, usePc, shouldSaveVolume, updateStep, setProgressPct, dateStr, buildThemesFromPerf, onDashboardUpdate]);

  const dismissSummary = useCallback(() => {
    setState(s => ({ ...s, summary: null }));
  }, []);

  useEffect(() => {
    const stored = getStoredCompletion();
    if (stored) setState(s => ({ ...s, lastCompletedToday: stored }));
  }, []);

  return {
    state,
    isEnabled,
    isWeekend,
    buttonLabel,
    tooltip,
    targetDate,
    openConfirmDialog,
    closeConfirmDialog,
    runRoutine,
    dismissSummary,
  };
}
