// Look-alikes from the 10-K history (company_year_metrics). Pure functions — no database — so they can be tested.
//
// Each company-year becomes a fingerprint of 10 traits (returns vs cost of capital, how it earns them,
// growth, reinvestment, R&D, debt). Traits are put on one scale (median / spread across all company-years),
// and look-alikes are the nearest fingerprints.
//   now     — proven or elite companies that look like this one today
//   before  — proven or elite companies as they looked 4+ years before their latest year ("before they were famous")
//   base    — of the 30 most similar company-years with a known 5-year outcome (any company), how many kept
//             earning above their cost of capital: the honest odds, next to the rate for everyone.

export interface YearRow {
  symbol: string; fy_end: string; spread: number | null; margin: number | null; turnover: number | null; rev_growth: number | null;
  reinvest: number | null; gross_margin: number | null; rnd_rev: number | null; nd_ebitda: number | null;
}
export const TRAITS = ["spread", "spread3", "consistency", "margin", "turnover", "growth3", "reinvest", "grossMargin", "rnd", "debt"] as const;
export type Trait = typeof TRAITS[number];
export const TRAIT_TEXT: Record<Trait, string> = {
  spread: "return above its cost of capital (latest year)", spread3: "return above its cost of capital (3-year median)",
  consistency: "years above its cost of capital (of the last 5)", margin: "after-tax operating margin", turnover: "revenue per $ of capital",
  growth3: "revenue growth (3-year average)", reinvest: "share of profit reinvested", grossMargin: "gross margin", rnd: "R&D as % of revenue", debt: "net debt / EBITDA",
};
const WEIGHT: Record<Trait, number> = { spread: 1, spread3: 1.4, consistency: 1.2, margin: 1, turnover: 0.8, growth3: 1, reinvest: 0.6, grossMargin: 0.8, rnd: 0.6, debt: 0.5 };

export interface Point { symbol: string; end: string; raw: (number | null)[]; z: number[]; present: number; kept?: boolean; strong?: boolean; latest: boolean; yearsBeforeLatest: number }

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Fingerprints for every company-year with enough history, plus outcomes where 5 later years exist. */
export function fingerprints(rows: YearRow[]): Point[] {
  const by = new Map<string, YearRow[]>();
  for (const r of rows) by.set(r.symbol, [...(by.get(r.symbol) ?? []), r]);
  const pts: Point[] = [];
  for (const [symbol, ys] of by) {
    ys.sort((a, b) => a.fy_end.localeCompare(b.fy_end));
    for (let i = 2; i < ys.length; i++) {
      const last3 = ys.slice(i - 2, i + 1), last5 = ys.slice(Math.max(0, i - 4), i + 1);
      const sp5 = last5.map((y) => y.spread).filter(fin);
      const g3 = last3.map((y) => y.rev_growth).filter(fin);
      const y = ys[i];
      const raw: (number | null)[] = [
        fin(y.spread) ? clip(y.spread, -40, 60) : null,
        last3.map((x) => x.spread).filter(fin).length >= 2 ? clip(median(last3.map((x) => x.spread).filter(fin)), -40, 60) : null,
        sp5.length >= 3 ? sp5.filter((s) => s > 0).length / sp5.length : null,
        fin(y.margin) ? clip(y.margin, -50, 60) : null,
        fin(y.turnover) && y.turnover > 0 ? Math.log(clip(y.turnover, 0.05, 20)) : null,
        g3.length >= 2 ? clip(g3.reduce((s, x) => s + x, 0) / g3.length, -30, 80) : null,
        fin(y.reinvest) ? clip(y.reinvest, -100, 200) : null,
        fin(y.gross_margin) ? clip(y.gross_margin, 0, 100) : null,
        fin(y.rnd_rev) ? clip(y.rnd_rev, 0, 50) : null,
        fin(y.nd_ebitda) ? clip(y.nd_ebitda, -5, 10) : null,
      ];
      const present = raw.filter((v) => v != null).length;
      if (present < 6 || raw[1] == null) continue;
      const next = ys.slice(i + 1, i + 6).map((x) => x.spread);
      const known = next.length === 5 && next.every(fin);
      pts.push({
        symbol, end: y.fy_end, raw, z: [], present, latest: i === ys.length - 1, yearsBeforeLatest: ys.length - 1 - i,
        ...(known ? { kept: (next as number[]).filter((s) => s > 0).length >= 4, strong: median(next as number[]) >= 10 } : {}),
      });
    }
  }
  // robust scaling per trait
  for (let k = 0; k < TRAITS.length; k++) {
    const vals = pts.map((p) => p.raw[k]).filter(fin);
    const s = [...vals].sort((a, b) => a - b);
    const q = (f: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))];
    const med = q(0.5), iqr = (q(0.75) - q(0.25)) || 1;
    for (const p of pts) p.z[k] = fin(p.raw[k]) ? clip((p.raw[k]! - med) / iqr, -3, 3) : NaN;
  }
  return pts;
}

/** Weighted distance over traits both have; a missing trait costs a fixed penalty. */
export function distance(a: Point, b: Point): number {
  let d = 0, w = 0;
  for (let k = 0; k < TRAITS.length; k++) {
    const wk = WEIGHT[TRAITS[k]];
    w += wk;
    if (Number.isNaN(a.z[k]) || Number.isNaN(b.z[k])) { d += wk * 1.0; continue; }
    const x = a.z[k] - b.z[k];
    d += wk * x * x;
  }
  return Math.sqrt(d / w);
}

/** The traits on which two fingerprints are closest (among the informative ones). */
export function shared(a: Point, b: Point, n = 3) {
  return TRAITS.map((t, k) => ({ t, k, gap: Number.isNaN(a.z[k]) || Number.isNaN(b.z[k]) ? 9 : Math.abs(a.z[k] - b.z[k]) }))
    .filter((x) => x.gap < 9).sort((x, y) => x.gap - y.gap).slice(0, n)
    .map((x) => ({ trait: x.t, text: TRAIT_TEXT[x.t], self: round(a.raw[x.k], x.t), peer: round(b.raw[x.k], x.t) }));
}
const round = (v: number | null, t: Trait) => (v == null ? null : t === "turnover" ? Math.round(Math.exp(v) * 100) / 100 : t === "consistency" ? Math.round(v * 5) : Math.round(v * 10) / 10);

export interface Result {
  symbol: string; asOf: string;
  now: { peer: string; end: string; distance: number; shared: ReturnType<typeof shared> }[];
  before: { peer: string; end: string; distance: number; shared: ReturnType<typeof shared> }[];
  base: { k: number; keptPct: number; strongPct: number } | null;
}

export function lookalikes(pts: Point[], goodLabels: Map<string, string>, k = 30): { results: Result[]; allKeptPct: number } {
  const current = pts.filter((p) => p.latest);
  const nowPool = current.filter((p) => goodLabels.has(p.symbol));
  const beforePool = pts.filter((p) => goodLabels.has(p.symbol) && p.yearsBeforeLatest >= 4);
  const hist = pts.filter((p) => p.kept !== undefined);
  const allKeptPct = hist.length ? (100 * hist.filter((p) => p.kept).length) / hist.length : NaN;
  const results: Result[] = [];
  for (const s of current) {
    // nearest n without sorting the whole pool (bounded insertion); "distinct" keeps one year per company
    const top = (pool: Point[], n: number, distinct: boolean) => {
      const best: { p: Point; d: number }[] = [];
      const bestOf = distinct ? new Map<string, { p: Point; d: number }>() : null;
      for (const p of pool) {
        if (p.symbol === s.symbol) continue;
        const d = distance(s, p);
        if (bestOf) { const cur = bestOf.get(p.symbol); if (!cur || d < cur.d) bestOf.set(p.symbol, { p, d }); continue; }
        if (best.length < n || d < best[best.length - 1].d) {
          let i = best.length - 1;
          if (best.length < n) best.push({ p, d }); else best[i] = { p, d };
          i = best.length - 1;
          while (i > 0 && best[i - 1].d > best[i].d) { [best[i - 1], best[i]] = [best[i], best[i - 1]]; i--; }
        }
      }
      if (!bestOf) return best;
      for (const x of bestOf.values()) {
        if (best.length < n || x.d < best[best.length - 1].d) {
          if (best.length < n) best.push(x); else best[best.length - 1] = x;
          let i = best.length - 1;
          while (i > 0 && best[i - 1].d > best[i].d) { [best[i - 1], best[i]] = [best[i], best[i - 1]]; i--; }
        }
      }
      return best;
    };
    const near = top(hist, k, false);
    results.push({
      symbol: s.symbol, asOf: s.end,
      now: top(nowPool, 5, true).map((x) => ({ peer: x.p.symbol, end: x.p.end, distance: Math.round(x.d * 100) / 100, shared: shared(s, x.p) })),
      before: top(beforePool, 5, true).map((x) => ({ peer: x.p.symbol, end: x.p.end, distance: Math.round(x.d * 100) / 100, shared: shared(s, x.p) })),
      base: near.length >= 10 ? { k: near.length, keptPct: Math.round((1000 * near.filter((x) => x.p.kept).length) / near.length) / 10, strongPct: Math.round((1000 * near.filter((x) => x.p.strong).length) / near.length) / 10 } : null,
    });
  }
  return { results, allKeptPct: Math.round(allKeptPct * 10) / 10 };
}
