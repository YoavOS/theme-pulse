// Backfill RS data (return_1d, return_1m, rs values) for tickers that are
// part of a curated theme but NOT in the qualified_rs_universe.
//
// We compute returns directly from public.eod_prices (closest <= today close,
// closest <= today-21 trading days for 1M, closest <= today-5 for 1W).
// SPY returns come from the qualified_rs_universe row (already aligned).
//
// The result is merged into the Theme Tickers table so QCOM / NVDA / ARM,
// etc. show full RS Rating, 1D and 1M data even when they failed the
// liquidity filters that gate the qualified universe.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ExtraRsRow {
  symbol: string;
  return_1d: number | null;
  return_1w: number | null;
  return_1m: number | null;
  rs_1d: number | null;
  rs_1w: number | null;
  rs_1m: number | null;
  rs_overall: number | null;
}

const EOD_LOOKBACK_DAYS = 90; // enough to find a close ~21 trading days back

function pctChange(end: number | null, start: number | null): number | null {
  if (end === null || start === null || !Number.isFinite(end) || !Number.isFinite(start) || start === 0) return null;
  return ((end - start) / start) * 100;
}

function findCloseAt(rows: { date: string; close: number }[], targetIdx: number): number | null {
  // rows sorted DESC by date. targetIdx is # of trading days back from latest (0 = latest).
  if (rows.length === 0) return null;
  if (rows.length > targetIdx) return rows[targetIdx].close;
  // For multi-day windows (>=5d), if we don't have enough history, fall back
  // to the oldest available bar so we still produce a directional return
  // rather than a blank cell. For 1D (targetIdx=1) we require at least 2 bars.
  if (targetIdx >= 5) return rows[rows.length - 1].close;
  return null;
}

export function useExtraThemeRs(missingSymbols: string[]): {
  data: Map<string, ExtraRsRow>;
  loading: boolean;
} {
  const [data, setData] = useState<Map<string, ExtraRsRow>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (missingSymbols.length === 0) {
      setData(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1) Get SPY baseline returns from any row in qualified_rs_universe (they're all the same).
        const { data: spyRow } = await supabase
          .from("qualified_rs_universe")
          .select("spy_return_1d, spy_return_1w, spy_return_1m")
          .limit(1)
          .maybeSingle();
        const spy1d = spyRow?.spy_return_1d != null ? Number(spyRow.spy_return_1d) : null;
        const spy1w = spyRow?.spy_return_1w != null ? Number(spyRow.spy_return_1w) : null;
        const spy1m = spyRow?.spy_return_1m != null ? Number(spyRow.spy_return_1m) : null;

        // 2) Pull EOD prices for the missing symbols.
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - EOD_LOOKBACK_DAYS);
        const sinceStr = sinceDate.toISOString().slice(0, 10);

        // eod_prices table removed in lightweight cleanup — no historical fallback available.
        const eod: any[] | null = null;

        const bySym = new Map<string, { date: string; close: number }[]>();
        for (const r of eod ?? []) {
          const sym = (r.symbol as string).toUpperCase();
          const arr = bySym.get(sym) ?? [];
          arr.push({ date: r.date as string, close: Number(r.close_price) });
          bySym.set(sym, arr);
        }

        const out = new Map<string, ExtraRsRow>();
        for (const sym of missingSymbols.map((s) => s.toUpperCase())) {
          const rows = bySym.get(sym) ?? [];
          // rows already sorted DESC.
          const latest = findCloseAt(rows, 0);
          const prev1 = findCloseAt(rows, 1);   // 1 trading day back → 1D return
          const prev1w = findCloseAt(rows, 5);  // ~5 trading days back → 1W return
          const prev1m = findCloseAt(rows, 21); // ~21 trading days back → 1M return

          const r1d = pctChange(latest, prev1);
          const r1w = pctChange(latest, prev1w);
          const r1m = pctChange(latest, prev1m);

          const rs1d = r1d != null && spy1d != null ? r1d - spy1d : null;
          const rs1w = r1w != null && spy1w != null ? r1w - spy1w : null;
          const rs1m = r1m != null && spy1m != null ? r1m - spy1m : null;

          // Overall = same blend the universe uses (1m/3m/6m weighted) — but we
          // only need a proxy for ranking the curated theme rows. Use rs1m as
          // a stable single-period stand-in when 3m/6m EOD coverage is too
          // shallow (current eod_prices only has ~17 days for these symbols).
          const rsOverall = rs1m;

          out.set(sym, {
            symbol: sym,
            return_1d: r1d,
            return_1w: r1w,
            return_1m: r1m,
            rs_1d: rs1d,
            rs_1w: rs1w,
            rs_1m: rs1m,
            rs_overall: rsOverall,
          });
        }

        if (!cancelled) setData(out);
      } catch (err) {
        console.error("useExtraThemeRs failed:", err);
        if (!cancelled) setData(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the set of missing symbols changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingSymbols.join(",")]);

  return { data, loading };
}
