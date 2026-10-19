/**
 * Earnings growth snapshot for the "Accelerating earnings" screen (stock_stages.features.ern).
 * Source: Yahoo fundamentals-timeseries — the last 5 quarters of diluted EPS and revenue plus
 * annual EPS. One call per stock, refreshed at most weekly (stage-scan reuses a fresh snapshot).
 *
 *   epsYoY  — latest quarter EPS vs the same quarter a year earlier (%)
 *   fyEps   — last fiscal year EPS growth (%)
 *   revYoY  — latest quarter revenue vs a year earlier (%)
 *   revQoQ / revQoQPrev — sequential revenue growth, latest and the quarter before (%)
 *   accel   — EPS growing ≥ 25% and faster than over the last fiscal year, revenue ≥ 15%
 */

export interface EarnGrowth {
  at: string;                 // fetched (ISO)
  qEnd: string | null;        // latest quarter end
  eps: (number | null)[];     // last ≤5 quarters, oldest → newest
  rev: (number | null)[];     // $ millions
  epsYoY: number | null;
  fyEps: number | null;
  revYoY: number | null;
  revQoQ: number | null;
  revQoQPrev: number | null;
  accel: boolean;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const r1 = (x: number) => Math.round(x * 10) / 10;
const growth = (now: number | null | undefined, prior: number | null | undefined) =>
  now == null || prior == null || !(prior > 0) ? null : r1(((now - prior) / prior) * 100);

type Pt = { asOfDate: string; reportedValue?: { raw?: number } } | null;

export async function fetchEarnGrowth(symbol: string): Promise<EarnGrowth | null> {
  const types = "quarterlyDilutedEPS,quarterlyTotalRevenue,annualDilutedEPS";
  const p2 = Math.floor(Date.now() / 1000) + 86400 * 40;
  const url = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types}&period1=1500000000&period2=${p2}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const j = await res.json();
    const series = new Map<string, { d: string; v: number }[]>();
    for (const r of (j?.timeseries?.result ?? []) as Record<string, unknown>[]) {
      const type = (r.meta as { type?: string[] } | undefined)?.type?.[0];
      if (!type) continue;
      const pts = ((r[type] as Pt[] | undefined) ?? [])
        .filter((p): p is NonNullable<Pt> => !!p && typeof p.reportedValue?.raw === "number")
        .map((p) => ({ d: p.asOfDate, v: p.reportedValue!.raw as number }))
        .sort((a, b) => a.d.localeCompare(b.d));
      series.set(type, pts);
    }
    return computeEarnGrowth(series.get("quarterlyDilutedEPS") ?? [], series.get("quarterlyTotalRevenue") ?? [], series.get("annualDilutedEPS") ?? []);
  } catch {
    return null;
  }
}

export function computeEarnGrowth(qe: { d: string; v: number }[], qr: { d: string; v: number }[], ae: { d: string; v: number }[]): EarnGrowth | null {
  if (qe.length < 2 && qr.length < 2) return null;
  const dates = [...new Set([...qe, ...qr].map((p) => p.d))].sort().slice(-5);
  const at = (arr: { d: string; v: number }[], d: string) => arr.find((p) => p.d === d)?.v ?? null;
  const eps = dates.map((d) => at(qe, d));
  const rev = dates.map((d) => at(qr, d));
  const n = dates.length;
  // same quarter a year earlier = 4 quarters back (needs 5 quarters, ~1 year apart)
  const yearBack = n === 5 && Date.parse(dates[4]) - Date.parse(dates[0]) > 330 * 86400_000 && Date.parse(dates[4]) - Date.parse(dates[0]) < 400 * 86400_000;
  const epsYoY = yearBack ? growth(eps[4], eps[0]) : null;
  const revYoY = yearBack ? growth(rev[4], rev[0]) : null;
  const revQoQ = n >= 2 ? growth(rev[n - 1], rev[n - 2]) : null;
  const revQoQPrev = n >= 3 ? growth(rev[n - 2], rev[n - 3]) : null;
  const fyEps = ae.length >= 2 ? growth(ae[ae.length - 1].v, ae[ae.length - 2].v) : null;
  const accel = epsYoY !== null && epsYoY >= 25 && (fyEps === null || epsYoY > fyEps) && revYoY !== null && revYoY >= 15;
  return {
    at: new Date().toISOString(), qEnd: dates[n - 1] ?? null,
    eps: eps.map((x) => (x === null ? null : Math.round(x * 1000) / 1000)),
    rev: rev.map((x) => (x === null ? null : Math.round(x / 1e5) / 10)),
    epsYoY, fyEps, revYoY, revQoQ, revQoQPrev, accel,
  };
}
