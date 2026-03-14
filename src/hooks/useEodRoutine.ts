import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { calculateDispersion, getDispersionShortLabel } from "@/hooks/useDispersion";
import { saveWeeklyVolumeHistory } from "@/hooks/useVolumeDryUp";

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
  alertsTriggered: number;
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

const ROUTINE_STORAGE_KEY = "lastEodRoutine";

function getTodayET(): { dateStr: string; hour: number; minute: number; dayOfWeek: number; isWeekend: boolean } {
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
    if (parsed.date === dateStr) {
      return { time: parsed.time, summary: parsed.summary };
    }
    return null;
  } catch {
    return null;
  }
}

export function useEodRoutine() {
  const { toast } = useToast();
  const [state, setState] = useState<EodRoutineState>({
    isRunning: false,
    currentStep: 0,
    totalSteps: 6,
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
    : "📅 EOD Routine";

  const tooltip = !isEnabled
    ? "Available when market is closed (before 9:30 AM or after 4:00 PM ET)"
    : state.lastCompletedToday
    ? "Routine already completed today. Click to re-run."
    : "Run complete end-of-day workflow";

  const openConfirmDialog = useCallback(() => {
    setState(s => ({ ...s, showConfirmDialog: true }));
  }, []);

  const closeConfirmDialog = useCallback(() => {
    setState(s => ({ ...s, showConfirmDialog: false }));
  }, []);

  const updateStep = useCallback((stepId: number, updates: Partial<EodRoutineStep>) => {
    setState(s => ({
      ...s,
      steps: s.steps.map(step => step.id === stepId ? { ...step, ...updates } : step),
    }));
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
      { id: 5, label: "Save Volume History", emoji: "⚡", status: shouldSaveVolume ? "pending" : "skipped" },
      { id: 6, label: "Check Alerts", emoji: "🔔", status: "pending" },
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
    let alertsTriggered = 0;
    let weeklyReportGenerated = false;
    const failedSteps: string[] = [];

    let scanPerfData: { symbol: string; price: number; perf_1d: number }[] = [];
    let themeMap = new Map<string, string>();

    try {
      // PHASE 1: DATA COLLECTION
      updateStep(1, { status: "running", detail: "Initializing scan..." });

      const startRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=start`, { headers });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Failed to initialize scan");

      const totalTickers = startData.total || 0;
      updateStep(1, { detail: `Scanning: 0 / ${totalTickers}` });

      let scanDone = false;
      while (!scanDone && !abortRef.current) {
        const chunkRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=chunk`, { headers });
        if (!chunkRes.ok) throw new Error("Scan chunk failed");
        const chunkData = await chunkRes.json();
        scanDone = chunkData.done;

        const statusRes = await fetch(`${supabaseUrl}/functions/v1/full-scan?action=status`, { headers });
        const statusData = await statusRes.json();
        const done = statusData.done || 0;
        const total = statusData.total || totalTickers;
        updateStep(1, { detail: `Scanning: ${done} / ${total}` });
        setState(s => ({ ...s, progress: Math.round((done / total) * 16.67) }));

        if (!scanDone) await new Promise(r => setTimeout(r, 300));
      }

      // FIX: Fetch ALL tickers with valid prices, not just status="done"
      const { data: perfData, error: perfErr } = await supabase
        .from("ticker_performance")
        .select("symbol, price, perf_1d")
        .not("price", "is", null)
        .gt("price", 0);

      if (perfErr || !perfData || perfData.length === 0) {
        throw new Error("No scan data available");
      }

      scanPerfData = perfData;
      tickersScanned = perfData.length;
      updateStep(1, { status: "done", detail: `${tickersScanned} tickers` });
      setState(s => ({ ...s, currentStep: 2, progress: 17 }));

      // STEP 2: Save EOD Prices
      updateStep(2, { status: "running", detail: "Preparing..." });

      const { data: themes } = await supabase.from("themes").select("id, name");
      const { data: tickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

      if (themes && tickers) {
        const idToName = new Map(themes.map(t => [t.id, t.name]));
        for (const t of tickers) {
          if (!themeMap.has(t.ticker_symbol)) {
            themeMap.set(t.ticker_symbol, idToName.get(t.theme_id) || "Unknown");
          }
        }
      }

      const BATCH = 50;
      const eodRows = scanPerfData.map(p => ({
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
      }));

      updateStep(2, { detail: `Saving ${eodRows.length} prices...` });

      for (let i = 0; i < eodRows.length; i += BATCH) {
        const { error } = await supabase
          .from("eod_prices")
          .upsert(eodRows.slice(i, i + BATCH), { onConflict: "symbol,date" });
        if (error) console.error("EOD upsert batch error:", error);
      }

      eodPricesSaved = eodRows.length;
      updateStep(2, { status: "done", detail: `${eodPricesSaved} rows` });
      setState(s => ({ ...s, currentStep: 3, progress: 33 }));

      // PHASE 2: ANALYTICS
      updateStep(3, { status: "running", detail: "Calculating..." });

      try {
        const perfMap = new Map(scanPerfData.map(p => [p.symbol, p]));
        const themeSymbolsMap = new Map<string, string[]>();
        if (tickers) {
          for (const tk of tickers) {
            const arr = themeSymbolsMap.get(tk.theme_id) || [];
            arr.push(tk.ticker_symbol);
            themeSymbolsMap.set(tk.theme_id, arr);
          }
        }

        const breadthRows: {
          theme_name: string;
          date: string;
          advancing: number;
          declining: number;
          total: number;
          breadth_pct: number;
        }[] = [];

        if (themes) {
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
        }

        for (let i = 0; i < breadthRows.length; i += BATCH) {
          await supabase
            .from("theme_breadth_history")
            .upsert(breadthRows.slice(i, i + BATCH), { onConflict: "theme_name,date" });
        }

        themesBreadthRecorded = breadthRows.length;
        updateStep(3, { status: "done", detail: `${themesBreadthRecorded} themes` });
      } catch (err) {
        console.error("Breadth save failed:", err);
        failedSteps.push("Breadth History");
        updateStep(3, { status: "failed", detail: "Failed" });
      }

      setState(s => ({ ...s, currentStep: 4, progress: 50 }));

      // STEP 4: Calculate Dispersion
      updateStep(4, { status: "running", detail: "Analyzing..." });

      try {
        const themePerfs: number[] = [];
        const themeSymbolsMap2 = new Map<string, string[]>();
        if (tickers) {
          for (const tk of tickers) {
            const arr = themeSymbolsMap2.get(tk.theme_id) || [];
            arr.push(tk.ticker_symbol);
            themeSymbolsMap2.set(tk.theme_id, arr);
          }
        }

        const perfMap = new Map(scanPerfData.map(p => [p.symbol, p.perf_1d || 0]));

        if (themes) {
          for (const theme of themes) {
            const symbols = themeSymbolsMap2.get(theme.id) || [];
            const validPerfs = symbols.map(s => perfMap.get(s)).filter((v): v is number => v !== undefined);
            if (validPerfs.length > 0) {
              const avg = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
              themePerfs.push(avg);
            }
          }
        }

        dispersionScore = calculateDispersion(themePerfs);
        dispersionLabel = getDispersionShortLabel(dispersionScore);

        await supabase
          .from("eod_save_sessions")
          .upsert({
            date: targetDate,
            status: "completed",
            total_tickers: tickersScanned,
            saved_count: eodPricesSaved,
            failed_count: 0,
            failed_symbols: [],
            dispersion_score: dispersionScore,
            started_at: new Date(startTime).toISOString(),
            completed_at: new Date().toISOString(),
          }, { onConflict: "date" });

        updateStep(4, { status: "done", detail: `${dispersionScore.toFixed(1)}σ (${dispersionLabel})` });
      } catch (err) {
        console.error("Dispersion calc failed:", err);
        failedSteps.push("Dispersion");
        updateStep(4, { status: "failed", detail: "Failed" });
      }

      setState(s => ({ ...s, currentStep: 5, progress: 67 }));

      // STEP 5: Save Volume History (Fridays only)
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

      setState(s => ({ ...s, currentStep: 6, progress: 83 }));

      // STEP 6: Run Alert Checks
      updateStep(6, { status: "running", detail: "Checking alerts..." });

      try {
        const yesterdayDate = (() => {
          const d = new Date(targetDate);
          d.setDate(d.getDate() - 1);
          if (d.getDay() === 0) d.setDate(d.getDate() - 2);
          if (d.getDay() === 6) d.setDate(d.getDate() - 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();

        const [todayBreadth, yesterdayBreadth] = await Promise.all([
          supabase.from("theme_breadth_history").select("theme_name, breadth_pct").eq("date", targetDate),
          supabase.from("theme_breadth_history").select("theme_name, breadth_pct").eq("date", yesterdayDate),
        ]);

        if (todayBreadth.data && yesterdayBreadth.data) {
          const yesterdayMap = new Map(yesterdayBreadth.data.map(r => [r.theme_name, r.breadth_pct]));

          for (const row of todayBreadth.data) {
            const yesterdayVal = yesterdayMap.get(row.theme_name);
            if (yesterdayVal === undefined) continue;

            const change = row.breadth_pct - yesterdayVal;
            const isSurge = yesterdayVal < 35 && row.breadth_pct > 65;
            const isCollapse = yesterdayVal > 65 && row.breadth_pct < 35;
            const isLargeJump = Math.abs(change) > 40;

            if (isSurge || (isLargeJump && change > 0)) {
              alertsTriggered++;
              toast({
                title: `🚀 ${row.theme_name} breadth surged`,
                description: `${yesterdayVal}% → ${row.breadth_pct}% — potential rotation signal`,
                duration: 10000,
              });
            } else if (isCollapse || (isLargeJump && change < 0)) {
              alertsTriggered++;
              toast({
                title: `⚠ ${row.theme_name} breadth collapsed`,
                description: `${yesterdayVal}% → ${row.breadth_pct}% — watch for reversal`,
                variant: "destructive",
                duration: 10000,
              });
            }
          }
        }

        updateStep(6, { status: "done", detail: alertsTriggered > 0 ? `${alertsTriggered} alerts` : "No alerts" });
      } catch (err) {
        console.error("Alert check failed:", err);
        failedSteps.push("Alerts");
        updateStep(6, { status: "failed", detail: "Failed" });
      }

      setState(s => ({ ...s, progress: 100 }));

      // PHASE 3: INTELLIGENCE (non-blocking background)
      const backgroundTasks: Promise<void>[] = [];

      if (shouldSaveVolume) {
        backgroundTasks.push((async () => {
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-weekly-report`, {
              method: "POST",
              headers,
              body: JSON.stringify({}),
            });
            if (res.ok) weeklyReportGenerated = true;
          } catch (err) {
            console.warn("Weekly report generation failed:", err);
          }
        })());
      }

      backgroundTasks.push((async () => {
        try {
          const perfMap = new Map(scanPerfData.map(p => [p.symbol, p.perf_1d || 0]));
          const themeSymbolsMap = new Map<string, string[]>();
          if (tickers) {
            for (const tk of tickers) {
              const arr = themeSymbolsMap.get(tk.theme_id) || [];
              arr.push(tk.ticker_symbol);
              themeSymbolsMap.set(tk.theme_id, arr);
            }
          }

          const themePerfs: { name: string; perf: number }[] = [];
          if (themes) {
            for (const theme of themes) {
              const symbols = themeSymbolsMap.get(theme.id) || [];
              const validPerfs = symbols.map(s => perfMap.get(s)).filter((v): v is number => v !== undefined);
              if (validPerfs.length > 0) {
                const avg = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
                themePerfs.push({ name: theme.name, perf: Math.abs(avg) });
              }
            }
          }

          const top5 = themePerfs.sort((a, b) => b.perf - a.perf).slice(0, 5);
          for (const theme of top5) {
            await fetch(`${supabaseUrl}/functions/v1/fetch-theme-news`, {
              method: "POST",
              headers,
              body: JSON.stringify({ themeName: theme.name }),
            }).catch(() => {});
          }
        } catch (err) {
          console.warn("News refresh failed:", err);
        }
      })());

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
            const perfMap = new Map(scanPerfData.map(p => [p.symbol, p.perf_1d || 0]));
            const themeSymbolsMap = new Map<string, string[]>();
            if (tickers) {
              for (const tk of tickers) {
                const arr = themeSymbolsMap.get(tk.theme_id) || [];
                arr.push(tk.ticker_symbol);
                themeSymbolsMap.set(tk.theme_id, arr);
              }
            }

            const themePerfs: { name: string; symbols: string[]; perf: number }[] = [];
            if (themes) {
              for (const theme of themes) {
                const symbols = themeSymbolsMap.get(theme.id) || [];
                const validPerfs = symbols.map(s => perfMap.get(s)).filter((v): v is number => v !== undefined);
                if (validPerfs.length > 0) {
                  const avg = validPerfs.reduce((a, b) => a + b, 0) / validPerfs.length;
                  themePerfs.push({ name: theme.name, symbols, perf: Math.abs(avg) });
                }
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
          }
        } catch (err) {
          console.warn("Fundamentals refresh failed:", err);
        }
      })());

      Promise.all(backgroundTasks).catch(() => {});

      const elapsedMs = Date.now() - startTime;
      const summary: EodRoutineSummary = {
        date: targetDate,
        tickersScanned,
        eodPricesSaved,
        themesBreadthRecorded,
        dispersionScore,
        dispersionLabel,
        alertsTriggered,
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
        description: "All data saved and analytics updated",
        className: "border-[hsl(174,80%,50%)]/40 bg-[hsl(174,80%,50%)]/10 text-[hsl(174,80%,50%)]",
      });

    } catch (err) {
      console.error("EOD Routine failed:", err);
      const errorStep = state.steps.find(s => s.status === "running");
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (errorStep?.id === 1) {
        toast({
          title: "EOD Routine failed at scan",
          description: "No data saved. Try again.",
          variant: "destructive",
        });
      } else if (errorStep?.id === 2) {
        toast({
          title: "Scan complete but EOD save failed",
          description: "Prices not stored",
          variant: "destructive",
        });
      } else {
        toast({
          title: "EOD Routine failed",
          description: errorMsg,
          variant: "destructive",
        });
      }

      setState(s => ({ ...s, isRunning: false }));
    }
  }, [toast, supabaseUrl, headers, targetDate, usePc, shouldSaveVolume, updateStep, dateStr]);

  const dismissSummary = useCallback(() => {
    setState(s => ({ ...s, summary: null }));
  }, []);

  useEffect(() => {
    const stored = getStoredCompletion();
    if (stored) {
      setState(s => ({ ...s, lastCompletedToday: stored }));
    }
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
