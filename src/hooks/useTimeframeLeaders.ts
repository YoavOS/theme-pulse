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
      const startDate = getStartDate(tf);

      // Get EOD data for this period
      const { data: eodRows } = await supabase
        .from("eod_prices")
        .select("symbol, date, close_price, theme_name")
        .gte("date", startDate)
        .order("date", { ascending: true });

      if (!eodRows || eodRows.length === 0) return;

      // Group by theme → dates → avg close
      const byTheme = new Map<string, Map<string, number[]>>();
      for (const r of eodRows) {
        if (!byTheme.has(r.theme_name)) byTheme.set(r.theme_name, new Map());
        const dates = byTheme.get(r.theme_name)!;
        if (!dates.has(r.date)) dates.set(r.date, []);
        dates.get(r.date)!.push(r.close_price);
      }

      const results: MomentumLeaderRow[] = [];
      for (const [theme, dateMap] of byTheme) {
        const sortedDates = [...dateMap.keys()].sort();
        if (sortedDates.length < 2) continue;

        const dailyAvgs = sortedDates.map(d => {
          const prices = dateMap.get(d)!;
          return prices.reduce((a, b) => a + b, 0) / prices.length;
        });

        const first = dailyAvgs[0];
        const last = dailyAvgs[dailyAvgs.length - 1];
        const perf = first > 0 ? Math.round(((last - first) / first) * 10000) / 100 : 0;

        // Is momentum accelerating? Compare first half vs second half
        const mid = Math.floor(dailyAvgs.length / 2);
        const firstHalfPerf = mid > 0 && dailyAvgs[0] > 0 ? (dailyAvgs[mid] - dailyAvgs[0]) / dailyAvgs[0] : 0;
        const secondHalfPerf = dailyAvgs[mid] > 0 ? (dailyAvgs[dailyAvgs.length - 1] - dailyAvgs[mid]) / dailyAvgs[mid] : 0;

        // Sparkline: sample points
        const step = Math.max(1, Math.floor(dailyAvgs.length / 7));
        const sparkline: number[] = [];
        for (let i = 0; i < dailyAvgs.length; i += step) sparkline.push(dailyAvgs[i]);
        if (sparkline[sparkline.length - 1] !== dailyAvgs[dailyAvgs.length - 1]) sparkline.push(dailyAvgs[dailyAvgs.length - 1]);

        results.push({
          themeName: theme,
          perf,
          trendAccelerating: secondHalfPerf > firstHalfPerf,
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
      const weeksLimit = tf === "1W" ? 1 : tf === "1M" ? 4 : 12;
      const { data } = await supabase
        .from("volume_history")
        .select("theme_name, sustained_vol_pct, avg_rel_vol, week_ending")
        .order("week_ending", { ascending: false })
        .limit(weeksLimit * 100); // themes × weeks

      if (!data || data.length === 0) return;

      const byTheme = new Map<string, { relVol: number; sustained: number; weekEnding: string }[]>();
      for (const r of data) {
        const arr = byTheme.get(r.theme_name) || [];
        arr.push({
          relVol: Number(r.avg_rel_vol ?? 0),
          sustained: Number(r.sustained_vol_pct ?? 0),
          weekEnding: r.week_ending,
        });
        byTheme.set(r.theme_name, arr);
      }

      // Only keep the most recent N weeks per theme
      const results: VolumeLeaderRow[] = [];
      for (const [theme, rows] of byTheme) {
        const sorted = rows.sort((a, b) => b.weekEnding.localeCompare(a.weekEnding)).slice(0, weeksLimit);
        if (sorted.length === 0) continue;

        const avgRelVol = Math.round((sorted.reduce((a, r) => a + r.relVol, 0) / sorted.length) * 100) / 100;
        const avgSustained = Math.round((sorted.reduce((a, r) => a + r.sustained, 0) / sorted.length) * 100) / 100;
        const trend = sorted.length >= 2
          ? sorted[0].relVol > sorted[sorted.length - 1].relVol + 0.2 ? "building" as const
            : sorted[0].relVol < sorted[sorted.length - 1].relVol - 0.2 ? "fading" as const
            : "flat" as const
          : "flat" as const;

        const elevatedWeeks = sorted.filter(r => r.relVol > 1.2).length;

        results.push({
          themeName: theme,
          avgRelVol,
          avgSustainedVol: avgSustained,
          trend,
          weekCount: sorted.length,
          consistent: elevatedWeeks >= 3,
        });
      }

      results.sort((a, b) => b.avgRelVol - a.avgRelVol);
      setVolumeData(prev => ({ ...prev, [tf]: results }));
    } catch (err) {
      console.error("fetchVolume error:", err);
    } finally {
      setLoading(l => ({ ...l, [key]: false }));
    }
  }, []);

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
