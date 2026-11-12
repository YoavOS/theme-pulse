// Damodaran's two accounting fixes, computed in the panel so the R&D life can be changed live.
// PURE (no imports from the app) so it can be unit-tested directly.
//
// 1. R&D is an investment, not an expense. Capitalise it over an amortizable life of N years:
//      research asset   = Σ R&D(t−j) × (N − j)/N   for j = 0..N−1   (this year's fully unamortized)
//      amortization     = Σ R&D(t−j) / N           for j = 1..N
//      operating income + R&D(t) − amortization;   invested capital + research asset (a year earlier)
// 2. Operating leases are debt. Add the lease liability to invested capital and add back the interest
//    hidden in the lease expense (≈ lease debt × pre-tax cost of debt) to operating income.
// Free cash flow is unchanged by either adjustment — only what is called "operating" vs "investing".

export interface AdjustInputs {
  ebitTtm: number | null; revenueTtm: number | null; rndTtm: number | null; taxRate: number;
  icBase: number | null; leaseNow: number | null; leaseBase: number | null;
  rndAnnual: { end: string; val: number }[];
  costOfDebt: number; costOfDebtSource: string;
  costOfCapital: number | null; industry: string | null;
  industryMargin: string | null; industryAdjMargin: string | null;
  defaultLife: number;
}

export interface RndRow { fy: string; rnd: number; unamortizedShare: number; unamortized: number; amortization: number; filled: boolean }
export interface Adjusted {
  reported: { ebit: number; margin: number; ic: number | null; roic: number | null; spread: number | null };
  adjusted: { ebit: number; margin: number; ic: number | null; roic: number | null; spread: number | null };
  rnd: null | { life: number; rows: RndRow[]; assetNow: number; assetPrior: number; amortization: number; current: number; ebitChange: number; filledYears: number; shareOfRevenue: number };
  lease: null | { debtNow: number; debtBase: number; costOfDebt: number; ebitChange: number };
  notes: string[];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nopat = (ebit: number, t: number) => (ebit > 0 ? ebit * (1 - t) : ebit);

export function computeAdjusted(a: AdjustInputs, opts: { life: number; rnd: boolean; lease: boolean }): Adjusted | null {
  if (!fin(a.ebitTtm) || !fin(a.revenueTtm) || a.revenueTtm <= 0) return null;
  const notes: string[] = [];
  const t = a.taxRate;
  const roicOf = (ebit: number, ic: number | null) => (fin(ic) && ic > 0 ? (nopat(ebit, t) / ic) * 100 : null);
  const spreadOf = (r: number | null) => (fin(r) && fin(a.costOfCapital) ? r - a.costOfCapital : null);

  const repRoic = roicOf(a.ebitTtm, a.icBase);
  const reported = { ebit: a.ebitTtm, margin: (a.ebitTtm / a.revenueTtm) * 100, ic: a.icBase, roic: repRoic, spread: spreadOf(repRoic) };

  let ebit = a.ebitTtm;
  let ic = a.icBase;
  let rnd: Adjusted["rnd"] = null;
  const N = Math.max(1, Math.min(15, Math.round(opts.life)));
  if (opts.rnd) {
    const ys = a.rndAnnual.filter((r) => fin(r.val) && r.val >= 0);
    if (ys.length >= 2) {
      // years 0..N (N+1 values); missing older years repeat the oldest known value (flagged)
      const vals: { fy: string; v: number; filled: boolean }[] = [];
      for (let j = 0; j <= N; j++) {
        const y = ys[j];
        if (y) vals.push({ fy: y.end.slice(0, 4), v: y.val, filled: false });
        else { const last = ys[ys.length - 1]; vals.push({ fy: String(Number(last.end.slice(0, 4)) - (j - ys.length + 1)), v: last.val, filled: true }); }
      }
      const rows: RndRow[] = vals.map((x, j) => {
        const share = j < N ? (N - j) / N : 0;
        return { fy: x.fy, rnd: x.v, unamortizedShare: share, unamortized: x.v * share, amortization: j >= 1 ? x.v / N : 0, filled: x.filled };
      });
      const assetNow = rows.reduce((s, r) => s + r.unamortized, 0);
      // a year earlier: the same weights applied to the series shifted by one year
      const assetPrior = vals.slice(1).reduce((s, x, j) => s + (j < N ? x.v * ((N - j) / N) : 0), 0);
      const amortization = rows.reduce((s, r) => s + r.amortization, 0);
      const current = vals[0].v;
      const ebitChange = current - amortization;
      const filledYears = vals.filter((x) => x.filled).length;
      ebit += ebitChange;
      if (fin(ic)) ic += assetPrior;
      rnd = { life: N, rows, assetNow, assetPrior, amortization, current, ebitChange, filledYears, shareOfRevenue: fin(a.rndTtm) ? (a.rndTtm / a.revenueTtm) * 100 : (current / a.revenueTtm) * 100 };
      if (filledYears) notes.push(`Only ${ys.length} years of R&D are in the filings; the ${filledYears} older year${filledYears > 1 ? "s" : ""} repeat the oldest known figure.`);
      if (rnd.shareOfRevenue < 1) notes.push("R&D is under 1% of revenue, so capitalising it changes little.");
    } else {
      notes.push(ys.length ? "Only one year of R&D in the filings — not enough to capitalise." : "No R&D reported — nothing to capitalise.");
    }
  }
  let lease: Adjusted["lease"] = null;
  if (opts.lease) {
    const now = fin(a.leaseNow) ? a.leaseNow : null;
    const base = fin(a.leaseBase) ? a.leaseBase : now;
    if (now !== null && now > 0) {
      const ebitChange = now * (a.costOfDebt / 100);
      ebit += ebitChange;
      if (fin(ic) && base !== null) ic += base;
      lease = { debtNow: now, debtBase: base ?? now, costOfDebt: a.costOfDebt, ebitChange };
    } else notes.push("No operating lease liability reported — nothing to add.");
  }
  const adjRoic = roicOf(ebit, ic);
  return { reported, adjusted: { ebit, margin: (ebit / a.revenueTtm) * 100, ic, roic: adjRoic, spread: spreadOf(adjRoic) }, rnd, lease, notes };
}

/** One plain sentence on what the adjustments did to returns. */
export function adjustVerdict(r: Adjusted): string | null {
  const a = r.reported.roic, b = r.adjusted.roic;
  if (!fin(a) || !fin(b)) return null;
  const d = b - a;
  if (Math.abs(d) < 0.5) return "The adjustments barely move the return on capital — the reported numbers tell the story fairly.";
  if (d < 0) return "Return on capital falls once R&D and leases are counted as capital: some of the reported return came from investment that accounting kept off the balance sheet.";
  return "Return on capital rises once R&D is treated as investment: expensing it had been understating what the business earns on the capital it really uses.";
}
