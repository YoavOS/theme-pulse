import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

function getTodayET(): { dateStr: string; hour: number; isWeekend: boolean } {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, "0");
  const day = String(et.getDate()).padStart(2, "0");
  return {
    dateStr: `${year}-${month}-${day}`,
    hour: et.getHours(),
    isWeekend: et.getDay() === 0 || et.getDay() === 6,
  };
}

export function useSaveEodFromScan(scanCompletedAt: Date | null) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [alreadySavedToday, setAlreadySavedToday] = useState(false);
  const [savedAtTime, setSavedAtTime] = useState<string | null>(null);

  const { dateStr, hour } = getTodayET();
  const isAfterClose = hour >= 16;

  // Check if EOD already saved today
  useEffect(() => {
    async function check() {
      const { data } = await supabase
        .from("eod_save_sessions")
        .select("completed_at, status")
        .eq("date", dateStr)
        .eq("status", "completed")
        .maybeSingle();

      if (data) {
        setAlreadySavedToday(true);
        setSavedAtTime(data.completed_at);
      }
    }
    check();
  }, [dateStr]);

  // Re-check after saving
  const refreshStatus = useCallback(async () => {
    const { data } = await supabase
      .from("eod_save_sessions")
      .select("completed_at, status")
      .eq("date", dateStr)
      .eq("status", "completed")
      .maybeSingle();

    if (data) {
      setAlreadySavedToday(true);
      setSavedAtTime(data.completed_at);
    }
  }, [dateStr]);

  const saveEodFromScan = useCallback(async () => {
    setIsSaving(true);

    try {
      // 1. Read all completed ticker_performance data (already in DB from scan)
      const { data: perfData, error: perfErr } = await supabase
        .from("ticker_performance")
        .select("symbol, price, perf_1d")
        .eq("status", "done");

      if (perfErr || !perfData || perfData.length === 0) {
        throw new Error("No scan data available to save");
      }

      // 2. Get theme mappings for theme_name
      const { data: themes } = await supabase.from("themes").select("id, name");
      const { data: tickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

      const themeMap = new Map<string, string>();
      if (themes && tickers) {
        const idToName = new Map(themes.map(t => [t.id, t.name]));
        for (const t of tickers) {
          if (!themeMap.has(t.ticker_symbol)) {
            themeMap.set(t.ticker_symbol, idToName.get(t.theme_id) || "Unknown");
          }
        }
      }

      // 3. Upsert into eod_prices in batches
      const rows = perfData.map(p => ({
        symbol: p.symbol,
        theme_name: themeMap.get(p.symbol) || "Unknown",
        date: dateStr,
        close_price: p.price || 0,
        open_price: null,
        high_price: null,
        low_price: null,
        volume: null,
        source: "scan_save",
        is_backfill: false,
      }));

      const BATCH = 50;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await supabase
          .from("eod_prices")
          .upsert(rows.slice(i, i + BATCH), { onConflict: "symbol,date" });
        if (error) console.error("Upsert batch error:", error);
      }

      // 4. Upsert eod_save_sessions
      await supabase
        .from("eod_save_sessions")
        .upsert({
          date: dateStr,
          status: "completed",
          total_tickers: rows.length,
          saved_count: rows.length,
          failed_count: 0,
          failed_symbols: [],
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }, { onConflict: "date" });

      setAlreadySavedToday(true);
      setSavedAtTime(new Date().toISOString());
      setIsSaving(false);

      toast({
        title: "EOD data saved from scan",
        description: `${rows.length} tickers written to history for ${dateStr}`,
      });
    } catch (err) {
      setIsSaving(false);
      toast({
        title: "Failed to save EOD from scan",
        description: String(err instanceof Error ? err.message : err),
        variant: "destructive",
      });
    }
  }, [dateStr, toast]);

  // Determine visibility and style
  const scanCompleted = scanCompletedAt !== null;
  const showButton = scanCompleted;

  const tooltip = alreadySavedToday
    ? `EOD already saved today${savedAtTime ? ` at ${new Date(savedAtTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}`
    : isAfterClose
    ? "Save scan prices as EOD historical data"
    : "Prices may not reflect final EOD values";

  return {
    showButton,
    isSaving,
    isAfterClose,
    alreadySavedToday,
    tooltip,
    saveEodFromScan,
    refreshStatus,
    tickerCount: null, // will be shown from scan progress
  };
}
