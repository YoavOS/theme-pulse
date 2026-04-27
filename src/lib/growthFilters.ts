import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";

export type GrowthFilterId = "growth" | "highGrowth" | "oneil";

export interface GrowthFiltersState {
  growth: boolean;
  highGrowth: boolean;
  oneil: boolean;
}

export const DEFAULT_GROWTH_FILTERS: GrowthFiltersState = {
  growth: false,
  highGrowth: false,
  oneil: false,
};

const ge = (v: number | null | undefined, t: number): boolean =>
  v !== null && v !== undefined && Number.isFinite(v) && v >= t;

/**
 * "Growth Stocks Only" — at least 2 of 3 categories pass.
 *  - Revenue: Quarterly YoY ≥ 20% OR TTM YoY ≥ 15%
 *  - EPS:     Quarterly YoY ≥ 25% OR TTM YoY ≥ 25%   (only counted if data exists)
 *  - Profit:  ROE ≥ 15% OR Net Margin ≥ 10%
 */
export function passesGrowth(f: StockFundamentals | undefined): boolean {
  if (!f) return false;
  let pass = 0;
  let evaluated = 0;

  // Revenue
  const revQ = f.revenue_quarterly_yoy;
  const revTTM = f.revenue_ttm_yoy;
  if (revQ !== null || revTTM !== null) {
    evaluated++;
    if (ge(revQ, 20) || ge(revTTM, 15)) pass++;
  }

  // EPS — only counted if data exists
  const epsQ = f.eps_quarterly_yoy;
  const epsTTM = f.eps_ttm_yoy;
  if (epsQ !== null || epsTTM !== null) {
    evaluated++;
    if (ge(epsQ, 25) || ge(epsTTM, 25)) pass++;
  }

  // Profitability — ROE in 0-1 (yahoo) or already %; treat both. Threshold 15% means 0.15.
  const roe = f.roe;
  const nm = f.net_margin;
  if (roe !== null || nm !== null) {
    evaluated++;
    const roeOk = roe !== null && (roe >= 0.15 || roe >= 15); // covers fractional + percent
    const nmOk = nm !== null && (nm >= 0.10 || nm >= 10);
    if (roeOk || nmOk) pass++;
  }

  // Need at least 2 categories to pass, AND at least 2 categories evaluable.
  return evaluated >= 2 && pass >= 2;
}

/**
 * "High Growth" — all 3 strict criteria:
 *  - Revenue Quarterly YoY ≥ 25%
 *  - EPS Quarterly YoY ≥ 40%   (skipped if missing)
 *  - ROE ≥ 20%
 */
export function passesHighGrowth(f: StockFundamentals | undefined): boolean {
  if (!f) return false;
  if (!ge(f.revenue_quarterly_yoy, 25)) return false;
  if (f.eps_quarterly_yoy !== null && !ge(f.eps_quarterly_yoy, 40)) return false;
  const roe = f.roe;
  const roeOk = roe !== null && (roe >= 0.20 || roe >= 20);
  if (!roeOk) return false;
  return true;
}

/**
 * "O'Neil Growth (Improved)" — at least 4 of 5 pass.
 *  1. EPS Q YoY ≥ 30%       (fallback EPS TTM YoY ≥ 30%)
 *  2. Rev Q YoY ≥ 25%       (fallback Rev TTM YoY ≥ 25%)
 *  3. ROE ≥ 17%
 *  4. D/E low — proxy: Debt/Equity ≤ 1.5 (or null treated as fail)
 *  5. Net Margin positive (>0)
 *  Criteria with no data are counted as fail (so a stock can't pass by being un-measurable).
 */
export function passesONeil(f: StockFundamentals | undefined): boolean {
  if (!f) return false;
  let pass = 0;

  // 1. EPS growth (with TTM fallback)
  const epsQ = f.eps_quarterly_yoy;
  const epsTTM = f.eps_ttm_yoy;
  const epsVal = epsQ !== null ? epsQ : epsTTM;
  if (ge(epsVal, 30)) pass++;

  // 2. Revenue growth (with TTM fallback)
  const revQ = f.revenue_quarterly_yoy;
  const revTTM = f.revenue_ttm_yoy;
  const revVal = revQ !== null ? revQ : revTTM;
  if (ge(revVal, 25)) pass++;

  // 3. ROE ≥ 17%
  const roe = f.roe;
  const roeOk = roe !== null && (roe >= 0.17 || roe >= 17);
  if (roeOk) pass++;

  // 4. Low Debt/Equity
  const de = f.debt_to_equity;
  // Yahoo returns D/E as a percent-ish number (e.g. 45 = 0.45). Finnhub returns ratio.
  // Treat ≤ 1.5 OR ≤ 150 (percent form) as low.
  const deOk = de !== null && (de <= 1.5 || de <= 150);
  if (deOk) pass++;

  // 5. Net Margin positive
  const nm = f.net_margin;
  if (nm !== null && nm > 0) pass++;

  return pass >= 4;
}

export function passesAllActiveFilters(
  state: GrowthFiltersState,
  f: StockFundamentals | undefined
): boolean {
  if (state.growth && !passesGrowth(f)) return false;
  if (state.highGrowth && !passesHighGrowth(f)) return false;
  if (state.oneil && !passesONeil(f)) return false;
  return true;
}

export function anyActive(state: GrowthFiltersState): boolean {
  return state.growth || state.highGrowth || state.oneil;
}
