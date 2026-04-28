// ─────────────────────────────────────────────────────────────────────────────
// useThemeMomentumIndex
//
// Computes a single 0-100 "Theme Momentum Index" for a given theme + a full
// breakdown of the metrics that go into it. Designed to be called on-demand
// from the Theme Momentum Index slide-in panel (one theme at a time).
//
// Score formula (balanced 4-component blend, each scaled to 0-100):
//   - avgRs        →  weight 0.30   (avg RS Rating across theme tickers)
//   - growthPass   →  weight 0.25   (% of theme stocks passing "Growth Stocks")
//   - volConsist   →  weight 0.20   (consistency: % of tickers with rel-vol >= 1.0)
//   - relSpy       →  weight 0.25   (theme perf vs SPY across 1D/1W/1M/3M, blended)
//
// Each component falls back gracefully (we just rebalance the active weights)
// so a theme with no fundamentals data still gets a score from RS + vs-SPY.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { passesGrowth } from "@/lib/growthFilters";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import type { ThemeData } from "@/data/themeData";
import type { SpyData } from "@/hooks/useSpyBenchmark";

export interface ThemeRelSpy {
  d1: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
}

export interface ThemeMomentumBreakdown {
  score: number;                 // 0-100
  rating: "Strong" | "Moderate" | "Weak" | "Insufficient Data";
  // Components (each 0-100, or null if not enough data)
  components: {
    avgRs: number | null;
    growthPass: number | null;
    volConsist: number | null;
    relSpy: number | null;
  };
  // Raw metrics surfaced in the panel
  avgRsRating: number | null;          // 0-99
  growthPassPct: number | null;        // 0-100
  growthStocksCount: number;           // # passing
  evaluatedStockCount: number;         // # with fundamentals data
  totalTickerCount: number;
  validTickerCount: number;            // non-skipped
  relSpy: ThemeRelSpy;                 // theme - spy per timeframe
  themePerf: ThemeRelSpy;              // raw theme % per timeframe
  spyPerf: ThemeRelSpy;
}

interface UniverseRow {
  symbol: string;
  rs_overall: number | null;
  return_1d: number | null;
  return_1w: number | null;
  return_1m: number | null;
  return_3m: number | null;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function avg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter(
    (v): v is number => v !== null && v !== undefined && Number.isFinite(v)
  );
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

// Map a "vs SPY" delta (in % points) to a 0-100 component.
// +5% over SPY → 100, 0% → 50, -5% → 0. Clamped.
function relSpyToScore(delta: number | null): number | null {
  if (delta === null || !Number.isFinite(delta)) return null;
  return clamp(50 + delta * 10);
}

export function useThemeMomentumIndex(
  theme: ThemeData | null,
  spy: SpyData,
  options: {
    relVolBySymbol?: Map<string, number>;     // optional volume map (rel vol)
    fundamentalsBySymbol?: Map<string, StockFundamentals>;
  } = {}
): { breakdown: ThemeMomentumBreakdown | null; isLoading: boolean } {
  const [universeRows, setUniverseRows] = useState<UniverseRow[] | null>(null);
  const [universeAll, setUniverseAll] = useState<(number | null)[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const symbolsKey = useMemo(() => {
    if (!theme) return "";
    return theme.tickers
      .filter((t) => !t.skipped)
      .map((t) => t.symbol.toUpperCase())
      .sort()
      .join(",");
  }, [theme]);

  // Fetch RS data (per-ticker and full universe distribution for ranking)
  useEffect(() => {
    if (!symbolsKey) {
      setUniverseRows(null);
      setUniverseAll(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const symbols = symbolsKey.split(",");
        // Theme tickers' RS rows
        const { data: themeData } = await supabase
          .from("qualified_rs_universe")
          .select("symbol, rs_overall, return_1d, return_1w, return_1m, return_3m")
          .in("symbol", symbols);

        // Universe rs_overall distribution (paginated)
        const all: (number | null)[] = [];
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("qualified_rs_universe")
            .select("rs_overall")
            .range(from, from + PAGE - 1);
          if (error) break;
          if (!data || data.length === 0) break;
          for (const r of data) all.push((r as any).rs_overall);
          if (data.length < PAGE) break;
        }

        if (!cancelled) {
          setUniverseRows((themeData ?? []) as UniverseRow[]);
          setUniverseAll(all);
        }
      } catch (err) {
        console.error("Theme Momentum Index fetch failed:", err);
        if (!cancelled) {
          setUniverseRows([]);
          setUniverseAll([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbolsKey]);

  const breakdown = useMemo<ThemeMomentumBreakdown | null>(() => {
    if (!theme) return null;

    const validTickers = theme.tickers.filter((t) => !t.skipped);
    const totalTickerCount = theme.tickers.length;
    const validTickerCount = validTickers.length;

    // ── Avg RS Rating ─────────────────────────────────────────────────────
    let avgRsRating: number | null = null;
    if (universeRows && universeAll && universeAll.length > 0) {
      // Compute rating for each universe row, then look up theme tickers.
      const ratings = computeRsRatings(universeAll);
      // We don't have symbol order with universeAll; need a separate map.
      // Compute the rating of each theme ticker by ranking its rs_overall
      // inside the universe distribution directly (cheap & order-free).
      const sortedUniverse = universeAll
        .filter((v): v is number => v !== null && Number.isFinite(v))
        .sort((a, b) => a - b);
      const n = sortedUniverse.length;

      const themeRatings: number[] = [];
      for (const row of universeRows) {
        const v = row.rs_overall;
        if (v === null || !Number.isFinite(v) || n === 0) continue;
        // Binary search for rank
        let lo = 0, hi = n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sortedUniverse[mid] <= v) lo = mid + 1;
          else hi = mid;
        }
        const rating = clamp(Math.round(1 + (lo / n) * 98), 1, 99);
        themeRatings.push(rating);
      }
      if (themeRatings.length > 0) {
        avgRsRating = themeRatings.reduce((s, v) => s + v, 0) / themeRatings.length;
      }
      // Reference `ratings` to satisfy lint; kept for potential future use.
      void ratings;
    }

    // ── Growth pass % ─────────────────────────────────────────────────────
    let growthPassPct: number | null = null;
    let growthStocksCount = 0;
    let evaluatedStockCount = 0;
    if (options.fundamentalsBySymbol && options.fundamentalsBySymbol.size > 0) {
      for (const t of validTickers) {
        const f = options.fundamentalsBySymbol.get(t.symbol.toUpperCase());
        if (!f) continue;
        evaluatedStockCount++;
        if (passesGrowth(f)) growthStocksCount++;
      }
      if (evaluatedStockCount > 0) {
        growthPassPct = (growthStocksCount / evaluatedStockCount) * 100;
      }
    }

    // ── Volume consistency ───────────────────────────────────────────────
    let volConsist: number | null = null;
    if (options.relVolBySymbol && options.relVolBySymbol.size > 0 && validTickerCount > 0) {
      let withVol = 0;
      let aboveOne = 0;
      for (const t of validTickers) {
        const rv = options.relVolBySymbol.get(t.symbol.toUpperCase());
        if (rv === null || rv === undefined || !Number.isFinite(rv)) continue;
        withVol++;
        if (rv >= 1.0) aboveOne++;
      }
      if (withVol >= 3) volConsist = (aboveOne / withVol) * 100;
    }

    // ── Relative-to-SPY across timeframes ────────────────────────────────
    // ThemeData only carries one performance_pct (the active timeframe).
    // For the panel we also surface universe-derived returns averaged across
    // theme tickers so vs-SPY for 1W/1M/3M is comparable across themes.
    const themePerf: ThemeRelSpy = {
      d1: avg((universeRows ?? []).map((r) => r.return_1d)),
      w1: avg((universeRows ?? []).map((r) => r.return_1w)),
      m1: avg((universeRows ?? []).map((r) => r.return_1m)),
      m3: avg((universeRows ?? []).map((r) => r.return_3m)),
    };
    const spyPerf: ThemeRelSpy = {
      d1: spy.perf_1d,
      w1: spy.perf_1w,
      m1: spy.perf_1m,
      m3: spy.perf_3m,
    };
    const sub = (a: number | null, b: number | null): number | null =>
      a === null || b === null ? null : Math.round((a - b) * 100) / 100;
    const relSpy: ThemeRelSpy = {
      d1: sub(themePerf.d1, spyPerf.d1),
      w1: sub(themePerf.w1, spyPerf.w1),
      m1: sub(themePerf.m1, spyPerf.m1),
      m3: sub(themePerf.m3, spyPerf.m3),
    };
    // Blend the four timeframe deltas (drop nulls).
    const blendedRelSpy = avg([relSpy.d1, relSpy.w1, relSpy.m1, relSpy.m3]);

    // ── Component scores ─────────────────────────────────────────────────
    const cAvgRs = avgRsRating !== null ? clamp((avgRsRating / 99) * 100) : null;
    const cGrowth = growthPassPct;
    const cVol = volConsist;
    const cRel = relSpyToScore(blendedRelSpy);

    // Weighted blend with active rebalancing.
    const weights = { avgRs: 0.30, growth: 0.25, vol: 0.20, rel: 0.25 };
    const parts: { val: number; w: number }[] = [];
    if (cAvgRs !== null) parts.push({ val: cAvgRs, w: weights.avgRs });
    if (cGrowth !== null) parts.push({ val: cGrowth, w: weights.growth });
    if (cVol !== null) parts.push({ val: cVol, w: weights.vol });
    if (cRel !== null) parts.push({ val: cRel, w: weights.rel });

    let score = 0;
    let rating: ThemeMomentumBreakdown["rating"] = "Insufficient Data";
    if (parts.length === 0) {
      score = 0;
      rating = "Insufficient Data";
    } else {
      const totalW = parts.reduce((s, p) => s + p.w, 0);
      score = Math.round(parts.reduce((s, p) => s + p.val * p.w, 0) / totalW);
      rating = score >= 70 ? "Strong" : score >= 45 ? "Moderate" : "Weak";
    }

    return {
      score,
      rating,
      components: { avgRs: cAvgRs, growthPass: cGrowth, volConsist: cVol, relSpy: cRel },
      avgRsRating: avgRsRating !== null ? Math.round(avgRsRating) : null,
      growthPassPct,
      growthStocksCount,
      evaluatedStockCount,
      totalTickerCount,
      validTickerCount,
      relSpy,
      themePerf,
      spyPerf,
    };
  }, [theme, universeRows, universeAll, options.fundamentalsBySymbol, options.relVolBySymbol, spy]);

  return { breakdown, isLoading };
}
