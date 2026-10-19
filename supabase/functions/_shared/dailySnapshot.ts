/**
 * Daily snapshot for the app's ready-made screens (21-EMA pullback, tight range, ADR checks).
 * Computed in stage-scan from the last ~6 months of daily bars and stored in stock_stages.features.dly.
 */

export interface DailyBarLike { ts: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }

export interface DailySnap {
  date: string;              // last session (YYYY-MM-DD)
  close: number;
  ema21Pct: number;          // close vs 21-day EMA (%)
  sma50Pct: number | null;   // close vs 50-day SMA (%)
  adrPct: number;            // average daily range, 20 sessions (% of the low)
  range10Pct: number;        // 10-session high–low range (% of the close)
  tight: number;             // range10Pct ÷ adrPct — lower = tighter (≈ 2 or less is coiled)
  lodAdr: number;            // today's close above its low, as % of ADR (extension check: > 60 = extended)
  r21Pct: number | null;     // 21-session return (%)
  vol5x50: number | null;    // 5-day ÷ 50-day average volume
  ud: string;                // last ≤120 sessions, oldest → newest: "u" up close, "d" down, "0" unchanged (list breadth / McClellan)
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function dailySnapshot(raw: DailyBarLike[] | null | undefined): DailySnap | null {
  if (!raw?.length) return null;
  const bars = raw.filter((b) => b.close != null && b.high != null && b.low != null && (b.low as number) > 0) as
    { ts: number; high: number; low: number; close: number; volume: number | null }[];
  const n = bars.length;
  if (n < 30) return null;
  const last = bars[n - 1];
  // stale data (no session in the last 10 days) is worse than none
  if (Date.now() / 1000 - last.ts > 10 * 86400) return null;

  const k = 2 / 22;
  let ema = bars[0].close;
  for (let i = 1; i < n; i++) ema = bars[i].close * k + ema * (1 - k);

  const sma50 = n >= 50 ? bars.slice(n - 50).reduce((s, b) => s + b.close, 0) / 50 : null;
  const d20 = bars.slice(n - 20);
  const adr = (d20.reduce((s, b) => s + b.high / b.low, 0) / d20.length - 1) * 100;
  const d10 = bars.slice(n - 10);
  const range10 = ((Math.max(...d10.map((b) => b.high)) - Math.min(...d10.map((b) => b.low))) / last.close) * 100;
  const vols = bars.map((b) => b.volume ?? 0);
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const v50 = avg(vols.slice(Math.max(0, n - 50)));
  const lodPct = ((last.close - last.low) / last.low) * 100;

  return {
    date: new Date(last.ts * 1000).toISOString().slice(0, 10),
    close: r2(last.close),
    ema21Pct: r2((last.close / ema - 1) * 100),
    sma50Pct: sma50 ? r2((last.close / sma50 - 1) * 100) : null,
    adrPct: r2(adr),
    range10Pct: r2(range10),
    tight: adr > 0 ? r2(range10 / adr) : 99,
    lodAdr: adr > 0 ? Math.round((lodPct / adr) * 100) : 0,
    r21Pct: n > 21 ? r2((last.close / bars[n - 22].close - 1) * 100) : null,
    vol5x50: v50 > 0 ? r2(avg(vols.slice(n - 5)) / v50) : null,
    ud: bars.slice(Math.max(1, n - 120)).map((b, k, arr) => {
      const prev = k === 0 ? bars[Math.max(0, n - 121)] : arr[k - 1];
      return b.close > prev.close ? "u" : b.close < prev.close ? "d" : "0";
    }).join(""),
  };
}
