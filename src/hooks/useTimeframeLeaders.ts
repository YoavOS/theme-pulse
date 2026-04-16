import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type Timeframe } from "./useTimeframeAvailability";

/* ── Momentum Leaders ─────────────────────────────── */

export interface MomentumLeaderRow {
  themeName: string;
  perf: number;
  trendAccelerating: boolean;
  sparkline: number[];
}

/* ── Breadth Leaders ──────────────────────────────── */

export interface BreadthLeaderRow {
  themeName: string;
  avgBreadth: number;
  trend: "improving" | "deteriorating" | "flat";
  daysAbove50: number;
  totalDays: number;
  peakBreadth: number;
  currentVsAvg: number;
}

/* ── Volume Leaders ───────────────────────────────── */

export interface VolumeLeaderRow {
  themeName: string;
  avgRelVol: number;
  avgSustainedVol: number;
  trend: "building" | "fading" | "flat";
  weekCount: number;
  consistent: boolean;
}

function getStartDate(tf: Timeframe): string {
  const d = new Date();
  if (tf === "1W") d.setDate(d.getDate() - 7);
  else if (tf === "1M") d.setDate(d.getDate() - 30);
  else if (tf === "3M") d.setDate(d.getDate() - 90);
  return d.toISOString().split("T")[0];
}

export function useTimeframeLeaders() {
  const [momentumData, setMomentumData] = useState<Record<string, MomentumLeaderRow[]>>({});
  const [breadthData, setBreadthData] = useState<Record<string, BreadthLeaderRow[]>>({});
  const [volumeData, setVolumeData] = useState<Record<string, VolumeLeaderRow[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const fetched = useRef<Set<string>>(new Set());

  const fetchMomentum = useCallback(async (tf: Timeframe) => {
    const key = `momentum-${tf}`;
    if (fetched.current.has(key)) return;
    fetched.current.add(key);
    setLoading(l => ({ ...l, [key]: true }));

    try {
      // Decide which perf column to read from ticker_performance.
      // This is the Yahoo-backfilled, period-accurate source — guaranteed
      // distinct values for 1W vs 1M vs 3M.
      const perfCol: "perf_1w" | "perf_1m" | "perf_3m" =
        tf === "1W" ? "perf_1w" : tf === "1M" ? "perf_1m" : "perf_3m";

      // Pull theme membership + per-symbol perf in parallel
      const [themesRes, ttRes, perfRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_performance").select(`symbol, ${perfCol}`),
      ]);

      const themeNameById = new Map<string, string>();
      for (const t of themesRes.data ?? []) themeNameById.set(t.id, t.name);

      const perfBySymbol = new Map<string, number | null>();
      for (const r of (perfRes.data ?? []) as Array<Record<string, unknown>>) {
        const v = r[perfCol];
        perfBySymbol.set(String(r.symbol), v == null ? null : Number(v));
      }

      // Group symbols → theme
      const symbolsByTheme = new Map<string, string[]>();
      for (const tt of ttRes.data ?? []) {
        const themeName = themeNameById.get(tt.theme_id);
        if (!themeName) continue;
        const arr = symbolsByTheme.get(themeName) ?? [];
        arr.push(tt.ticker_symbol);
        symbolsByTheme.set(themeName, arr);
      }

      // For each theme: average per-ticker perf for the timeframe
      const startDate = getStartDate(tf);
      const { data: eodRows } = await supabase
        .from("eod_prices")
        .select("symbol, date, close_price, theme_name")
        .gte("date", startDate)
        .order("date", { ascending: true });

      const sparklineByTheme = new Map<string, number[]>();
      if (eodRows && eodRows.length > 0) {
        const byTheme = new Map<string, Map<string, number[]>>();
        for (const r of eodRows) {
          if (!byTheme.has(r.theme_name)) byTheme.set(r.theme_name, new Map());
          const dates = byTheme.get(r.theme_name)!;
          if (!dates.has(r.date)) dates.set(r.date, []);
          dates.get(r.date)!.push(r.close_price);
        }
        for (const [theme, dateMap] of byTheme) {
          const sortedDates = [...dateMap.keys()].sort();
          const dailyAvgs = sortedDates.map(d => {
            const prices = dateMap.get(d)!;
            return prices.reduce((a, b) => a + b, 0) / prices.length;
          });
          const step = Math.max(1, Math.floor(dailyAvgs.length / 7));
          const sparkline: number[] = [];
          for (let i = 0; i < dailyAvgs.length; i += step) sparkline.push(dailyAvgs[i]);
          if (sparkline.length > 0 && sparkline[sparkline.length - 1] !== dailyAvgs[dailyAvgs.length - 1]) {
            sparkline.push(dailyAvgs[dailyAvgs.length - 1]);
          }
          sparklineByTheme.set(theme, sparkline);
        }
      }

      const results: MomentumLeaderRow[] = [];
      for (const [theme, symbols] of symbolsByTheme) {
        const perfs = symbols
          .map(s => perfBySymbol.get(s))
          .filter((v): v is number => v != null && Number.isFinite(v));
        if (perfs.length === 0) continue;

        const avg = perfs.reduce((a, b) => a + b, 0) / perfs.length;
        const sparkline = sparklineByTheme.get(theme) ?? [];

        // Accelerating = more than half of tickers outperform the theme avg
        const winners = perfs.filter(p => p > avg).length;
        const trendAccelerating = winners / perfs.length > 0.5;

        results.push({
          themeName: theme,
          perf: Math.round(avg * 100) / 100,
          trendAccelerating,
          sparkline,
        });
      }

      results.sort((a, b) => b.perf - a.perf);
      setMomentumData(prev => ({ ...prev, [tf]: results.slice(0, 10) }));
    } catch (err) {
      console.error("fetchMomentum error:", err);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, []);

  const fetchBreadth = useCallback(async (tf: Timeframe) => {
    const key = `breadth-${tf}`;
    if (fetched.current.has(key)) return;
    fetched.current.add(key);
    setLoading(l => ({ ...l, [key]: true }));

    try {
      const startDate = getStartDate(tf);
      const { data } = await supabase
        .from("theme_breadth_history")
        .select("theme_name, breadth_pct, date")
        .gte("date", startDate)
        .order("date", { ascending: true });

      if (!data || data.length === 0) return;

      const byTheme = new Map<string, { date: string; pct: number }[]>();
      for (const r of data) {
        const arr = byTheme.get(r.theme_name) || [];
        arr.push({ date: r.date, pct: Number(r.breadth_pct) });
        byTheme.set(r.theme_name, arr);
      }

      const results: BreadthLeaderRow[] = [];
      for (const [theme, rows] of byTheme) {
        const sorted = rows.sort((a, b) => a.date.localeCompare(b.date));
        const pcts = sorted.map(r => r.pct);
        const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
        const daysAbove50 = pcts.filter(p => p >= 50).length;
        const peak = Math.max(...pcts);
        const current = pcts[pcts.length - 1];
        const mid = Math.floor(pcts.length / 2);
        const firstHalf = pcts.slice(0, mid);
        const secondHalf = pcts.slice(mid);
        const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
        const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
        const trend = avgSecond > avgFirst + 5 ? "improving" as const : avgSecond < avgFirst - 5 ? "deteriorating" as const : "flat" as const;

        results.push({
          themeName: theme,
          avgBreadth: Math.round(avg),
          trend,
          daysAbove50,
          totalDays: pcts.length,
          peakBreadth: Math.round(peak),
          currentVsAvg: Math.round(current - avg),
        });
      }

      results.sort((a, b) => b.avgBreadth - a.avgBreadth);
      setBreadthData(prev => ({ ...prev, [tf]: results }));
    } catch (err) {
      console.error("fetchBreadth error:", err);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, []);

  const fetchVolume = useCallback(async (tf: Timeframe) => {
    const key = `volume-${tf}`;
    if (fetched.current.has(key)) return;
    fetched.current.add(key);
    setLoading(l => ({ ...l, [key]: true }));

    try {
      // Period-aware perf column from Yahoo backfill
      const perfCol: "perf_1w" | "perf_1m" | "perf_3m" =
        tf === "1W" ? "perf_1w" : tf === "1M" ? "perf_1m" : "perf_3m";

      const [themesRes, ttRes, perfRes, volRes, histRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
        supabase.from("ticker_performance").select(`symbol, ${perfCol}`),
        supabase.from("ticker_volume_cache").select("symbol, today_vol, avg_20d, avg_3m"),
        supabase.from("volume_history").select("theme_name, sustained_vol_pct, avg_rel_vol, week_ending").order("week_ending", { ascending: false }),
      ]);

      const themeNameById = new Map<string, string>();
      for (const t of themesRes.data ?? []) themeNameById.set(t.id, t.name);

      const perfBySymbol = new Map<string, number | null>();
      for (const r of (perfRes.data ?? []) as Array<Record<string, unknown>>) {
        const v = r[perfCol];
        perfBySymbol.set(String(r.symbol), v == null ? null : Number(v));
      }

      // Per-ticker relative volume — pick the right baseline for the timeframe.
      // 1W → today vs 20d avg; 1M/3M → today vs 3m avg (slower baseline = more
      // meaningful for longer periods).
      const baseline: "avg_20d" | "avg_3m" = tf === "1W" ? "avg_20d" : "avg_3m";
      const relVolBySymbol = new Map<string, number | null>();
      for (const r of volRes.data ?? []) {
        const today = Number(r.today_vol ?? 0);
        const avg = Number((r as Record<string, unknown>)[baseline] ?? 0);
        relVolBySymbol.set(r.symbol, avg > 0 ? today / avg : null);
      }

      // Group symbols by theme
      const symbolsByTheme = new Map<string, string[]>();
      for (const tt of ttRes.data ?? []) {
        const themeName = themeNameById.get(tt.theme_id);
        if (!themeName) continue;
        const arr = symbolsByTheme.get(themeName) ?? [];
        arr.push(tt.ticker_symbol);
        symbolsByTheme.set(themeName, arr);
      }

      // Sustained-vol fallback from weekly history (best available aggregate)
      const weeksLimit = tf === "1W" ? 1 : tf === "1M" ? 4 : 12;
      const sustainedByTheme = new Map<string, { sus: number; weeks: number }>();
      const grouped = new Map<string, Array<{ sus: number; rel: number; w: string }>>();
      for (const r of histRes.data ?? []) {
        const arr = grouped.get(r.theme_name) ?? [];
        arr.push({ sus: Number(r.sustained_vol_pct ?? 0), rel: Number(r.avg_rel_vol ?? 0), w: r.week_ending });
        grouped.set(r.theme_name, arr);
      }
      for (const [theme, rows] of grouped) {
        const slice = rows.slice(0, weeksLimit);
        const sus = slice.reduce((a, r) => a + r.sus, 0) / slice.length;
        sustainedByTheme.set(theme, { sus, weeks: slice.length });
      }

      const results: VolumeLeaderRow[] = [];
      for (const [theme, symbols] of symbolsByTheme) {
        const relVols = symbols
          .map(s => relVolBySymbol.get(s))
          .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
        const perfs = symbols
          .map(s => perfBySymbol.get(s))
          .filter((v): v is number => v != null && Number.isFinite(v));
        if (relVols.length === 0) continue;

        const avgRelVol = Math.round((relVols.reduce((a, b) => a + b, 0) / relVols.length) * 100) / 100;
        const avgPerf = perfs.length > 0 ? perfs.reduce((a, b) => a + b, 0) / perfs.length : 0;

        const sus = sustainedByTheme.get(theme);
        const trend: "building" | "fading" | "flat" =
          avgPerf > 5 && avgRelVol > 1.2 ? "building"
          : avgPerf < -5 && avgRelVol > 1.2 ? "fading"
          : "flat";

        results.push({
          themeName: theme,
          avgRelVol,
          avgSustainedVol: sus ? Math.round(sus.sus * 100) / 100 : 0,
          trend,
          weekCount: sus?.weeks ?? 0,
          // Consistent = high relVol AND positive perf for this timeframe
          consistent: avgRelVol > 1.4 && avgPerf > 0,
        });
      }

      // Sort by relVol × |perf| so leaders differ per timeframe
      results.sort((a, b) => {
        const aScore = a.avgRelVol * (1 + Math.abs(perfsAvg(a, results) ? 0 : 0));
        const bScore = b.avgRelVol * (1 + Math.abs(perfsAvg(b, results) ? 0 : 0));
        return bScore - aScore;
      });

      // Better: rank by composite (relVol weight 60%, perf weight 40%)
      const maxAbsPerf = Math.max(1, ...symbolsByTheme.size > 0 ? [...sustainedByTheme.values()].map(v => Math.abs(v.sus)) : [1]);
      results.sort((a, b) => {
        const aPerf = sustainedByTheme.get(a.themeName)?.sus ?? 0;
        const bPerf = sustainedByTheme.get(b.themeName)?.sus ?? 0;
        const aScore = a.avgRelVol * 0.6 + (Math.abs(aPerf) / maxAbsPerf) * 0.4;
        const bScore = b.avgRelVol * 0.6 + (Math.abs(bPerf) / maxAbsPerf) * 0.4;
        return bScore - aScore;
      });

      setVolumeData(prev => ({ ...prev, [tf]: results }));
    } catch (err) {
      console.error("fetchVolume error:", err);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, []);

  // helper kept for clarity, unused after final sort
  function perfsAvg(_a: VolumeLeaderRow, _all: VolumeLeaderRow[]): number { return 0; }

  const clearCache = useCallback(() => {
    fetched.current.clear();
    setMomentumData({});
    setBreadthData({});
    setVolumeData({});
  }, []);

  return {
    momentumData,
    breadthData,
    volumeData,
    loading,
    fetchMomentum,
    fetchBreadth,
    fetchVolume,
    clearCache,
  };
}
