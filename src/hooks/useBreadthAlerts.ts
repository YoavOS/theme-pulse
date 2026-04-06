import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { persistAlert } from "@/hooks/useAlertHistory";

const BREADTH_ALERTS_KEY = "breadth_alerts";

export interface BreadthAlert {
  themeName: string;
  type: "surge" | "collapse";
  yesterdayBreadth: number;
  todayBreadth: number;
  date: string;
}

function getTodayDateET(): string {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

function getYesterdayDateET(): string {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  // Go back 1 day; skip weekends
  et.setDate(et.getDate() - 1);
  if (et.getDay() === 0) et.setDate(et.getDate() - 2); // Sunday → Friday
  if (et.getDay() === 6) et.setDate(et.getDate() - 1); // Saturday → Friday
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

export function getStoredAlerts(): BreadthAlert[] {
  try {
    const raw = localStorage.getItem(BREADTH_ALERTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BreadthAlert[];
    // Only return today's alerts
    const today = getTodayDateET();
    return parsed.filter(a => a.date === today);
  } catch {
    return [];
  }
}

export function clearStoredAlerts() {
  localStorage.removeItem(BREADTH_ALERTS_KEY);
}

export function hasThemeBreadthEvent(themeName: string): BreadthAlert | null {
  const alerts = getStoredAlerts();
  return alerts.find(a => a.themeName === themeName) || null;
}

export function useBreadthAlerts() {
  /**
   * Called after a full scan completes. Saves today's breadth per theme
   * and compares against yesterday's breadth to detect unusual swings.
   */
  const checkBreadthAfterScan = useCallback(async () => {
    const todayDate = getTodayDateET();
    const yesterdayDate = getYesterdayDateET();

    try {
      // 1. Get all themes + tickers + perf
      const [themesRes, tickersRes, perfRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_performance").select("symbol, perf_1d, status"),
      ]);

      if (!themesRes.data || !tickersRes.data || !perfRes.data) return;

      const perfMap = new Map(perfRes.data.map(p => [p.symbol, p]));
      const themeSymbols = new Map<string, string[]>();
      for (const tk of tickersRes.data) {
        const arr = themeSymbols.get(tk.theme_id) || [];
        arr.push(tk.ticker_symbol);
        themeSymbols.set(tk.theme_id, arr);
      }

      // 2. Compute today's breadth for each theme and save to DB
      const breadthRows: {
        theme_name: string;
        date: string;
        advancing: number;
        declining: number;
        total: number;
        breadth_pct: number;
      }[] = [];

      for (const theme of themesRes.data) {
        const symbols = themeSymbols.get(theme.id) || [];
        if (symbols.length === 0) continue;

        const valid = symbols.filter(s => perfMap.get(s)?.status === "done");
        if (valid.length === 0) continue;

        const advancing = valid.filter(s => (perfMap.get(s)?.perf_1d || 0) > 0).length;
        const declining = valid.length - advancing;
        const breadthPct = Math.round((advancing / valid.length) * 100);

        breadthRows.push({
          theme_name: theme.name,
          date: todayDate,
          advancing,
          declining,
          total: valid.length,
          breadth_pct: breadthPct,
        });
      }

      // Upsert today's breadth in batches
      const BATCH = 50;
      for (let i = 0; i < breadthRows.length; i += BATCH) {
        await supabase
          .from("theme_breadth_history" as any)
          .upsert(breadthRows.slice(i, i + BATCH), { onConflict: "theme_name,date" });
      }

      // 3. Fetch yesterday's breadth
      const { data: yesterdayData } = await supabase
        .from("theme_breadth_history" as any)
        .select("theme_name, breadth_pct")
        .eq("date", yesterdayDate);

      if (!yesterdayData || yesterdayData.length === 0) {
        console.log("No yesterday breadth data — skipping breadth alert check");
        return;
      }

      const yesterdayMap = new Map<string, number>(
        (yesterdayData as any[]).map((r: any) => [r.theme_name, Number(r.breadth_pct)])
      );

      // 4. Detect unusual breadth changes
      const alerts: BreadthAlert[] = [];

      for (const row of breadthRows) {
        const yesterdayBreadth = yesterdayMap.get(row.theme_name);
        if (yesterdayBreadth === undefined) continue;

        const todayBreadth = row.breadth_pct;
        const change = todayBreadth - yesterdayBreadth;

        const isSurge = yesterdayBreadth < 35 && todayBreadth > 65;
        const isCollapse = yesterdayBreadth > 65 && todayBreadth < 35;
        const isLargeJump = Math.abs(change) > 40;

        if (isSurge || (isLargeJump && change > 0)) {
          alerts.push({
            themeName: row.theme_name,
            type: "surge",
            yesterdayBreadth,
            todayBreadth,
            date: todayDate,
          });
        } else if (isCollapse || (isLargeJump && change < 0)) {
          alerts.push({
            themeName: row.theme_name,
            type: "collapse",
            yesterdayBreadth,
            todayBreadth,
            date: todayDate,
          });
        }
      }

      // 5. Save alerts to localStorage and show toasts
      if (alerts.length > 0) {
        localStorage.setItem(BREADTH_ALERTS_KEY, JSON.stringify(alerts));

        for (const alert of alerts) {
          if (alert.type === "surge") {
            toast.success(
              `🚀 ${alert.themeName} breadth surged from ${alert.yesterdayBreadth}% → ${alert.todayBreadth}% today — potential rotation signal`,
              { duration: 10000 }
            );
          } else {
            toast.warning(
              `⚠ ${alert.themeName} breadth collapsed from ${alert.yesterdayBreadth}% → ${alert.todayBreadth}% today — watch for reversal`,
              { duration: 10000 }
            );
          }
        }
      }

      console.log(`Breadth check: ${breadthRows.length} themes saved, ${alerts.length} alerts triggered`);
    } catch (err) {
      console.error("Breadth alert check failed:", err);
    }
  }, []);

  return { checkBreadthAfterScan };
}
