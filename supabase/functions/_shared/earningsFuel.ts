// ─────────────────────────────────────────────────────────────
// Earnings fuel — how the latest earnings report landed.
// Research (Chan, Jegadeesh & Lakonishok 1996; Jegadeesh & Livnat 2006;
// PEAD reviews 2020–21): the strongest free signal is the market's
// reaction to the report (abnormal return over days −1…+1), then the
// size of the EPS surprise scaled by price, then whether revenue agrees.
// Classic drift has weakened in large liquid stocks, so this is shown as
// context (and logged for the app's own track record), not added to scores.
// Analyst revisions are not available on free data — not used.
// ─────────────────────────────────────────────────────────────

export interface EarnEvent { symbol: string; date: string; hour: string | null; epsActual: number | null; epsEstimate: number | null; revenueActual: number | null; revenueEstimate: number | null }
export interface DBar { ts: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }

export interface EarnInfo {
  date: string;              // report date (Finnhub)
  day0: string;              // first session that could react
  sessionsAgo: number;       // sessions since day 0
  epsActual: number | null; epsEstimate: number | null;
  surprisePx: number | null; // (actual − estimate) / pre-report price, %
  revSurprisePct: number | null;
  ear: number;               // stock − SPY return, close(day −2) → close(day +1), %
  gap: number | null;        // day-0 open vs prior close, %
  volX: number | null;       // day-0 volume vs prior 50-day median
  drift: number | null;      // stock − SPY since close(day +1), %
  label: "beat_bought" | "beat_sold" | "beat_flat" | "miss_bought" | "miss_sold" | "reaction_up" | "reaction_down" | "inline";
  fuel?: number;             // 0–100 after the cross-sectional step
  earPct?: number; surprisePct?: number;
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

function clean(bars: DBar[]) {
  return bars.filter((b) => b && b.close != null && b.open != null && Number.isFinite(b.ts))
    .map((b) => ({ ts: b.ts, d: iso(b.ts), open: b.open as number, close: b.close as number, volume: b.volume ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
}

/** Per-stock measurements for one report. Returns null when the bars don't cover the event window. */
export function measureEarnings(ev: EarnEvent, stockBars: DBar[], spyBars: DBar[]): EarnInfo | null {
  const s = clean(stockBars), m = clean(spyBars);
  if (s.length < 30 || m.length < 30) return null;
  const amc = (ev.hour ?? "").toLowerCase() === "amc";
  const k0 = s.findIndex((b) => (amc ? b.d > ev.date : b.d >= ev.date));
  if (k0 < 2 || k0 + 1 >= s.length) return null;              // need day −2 … day +1
  const spyClose = new Map(m.map((b) => [b.d, b.close]));
  const sc = (k: number) => spyClose.get(s[k].d);
  const a = sc(k0 - 2), b = sc(k0 + 1);
  if (!a || !b) return null;
  const ear = ((s[k0 + 1].close / s[k0 - 2].close) - (b / a)) * 100;
  const gap = (s[k0].open / s[k0 - 1].close - 1) * 100;
  const vols = s.slice(Math.max(0, k0 - 50), k0).map((x) => x.volume).filter((x) => x > 0).sort((x, y) => x - y);
  const volX = vols.length >= 10 && s[k0].volume > 0 ? s[k0].volume / vols[vols.length >> 1] : null;
  const last = s.length - 1, spyLast = sc(last);
  const drift = last > k0 + 1 && spyLast ? ((s[last].close / s[k0 + 1].close) - (spyLast / b)) * 100 : null;
  const prePx = s[Math.max(0, k0 - 5)].close;
  const surprisePx = ev.epsActual !== null && ev.epsEstimate !== null && prePx > 0 ? ((ev.epsActual - ev.epsEstimate) / prePx) * 100 : null;
  const revSurprisePct = ev.revenueActual !== null && ev.revenueEstimate !== null && Math.abs(ev.revenueEstimate) > 0
    ? ((ev.revenueActual - ev.revenueEstimate) / Math.abs(ev.revenueEstimate)) * 100 : null;
  const beat = surprisePx === null ? null : surprisePx > 0.02 ? true : surprisePx < -0.02 ? false : null;
  const up = ear >= 2, down = ear <= -2;
  let label: EarnInfo["label"];
  if (beat === true) label = up ? "beat_bought" : down ? "beat_sold" : "beat_flat";
  else if (beat === false) label = up ? "miss_bought" : down ? "miss_sold" : "inline";
  else label = up ? "reaction_up" : down ? "reaction_down" : "inline";
  return {
    date: ev.date, day0: s[k0].d, sessionsAgo: last - k0,
    epsActual: ev.epsActual, epsEstimate: ev.epsEstimate,
    surprisePx: surprisePx === null ? null : Math.round(surprisePx * 1000) / 1000,
    revSurprisePct: revSurprisePct === null ? null : r1(revSurprisePct),
    ear: r1(ear), gap: r1(gap), volX: volX === null ? null : r2(volX), drift: drift === null ? null : r1(drift), label,
  };
}

/** Cross-sectional step: percentiles of reaction and surprise, then a 0–100 fuel score that fades with age. */
export function scoreFuel(list: EarnInfo[]) {
  const pct = (vals: number[], x: number) => vals.length ? Math.round((vals.filter((v) => v < x).length / vals.length) * 100) : 50;
  const ears = list.map((e) => e.ear);
  const surps = list.map((e) => e.surprisePx).filter((x): x is number => x !== null);
  for (const e of list) {
    e.earPct = pct(ears, e.ear);
    e.surprisePct = e.surprisePx === null ? undefined : pct(surps, e.surprisePx);
    const rev = e.revSurprisePct === null ? 50 : e.revSurprisePct > 0 ? 100 : 0;
    const raw = e.surprisePct === undefined ? 0.75 * e.earPct + 0.25 * rev : 0.45 * e.earPct + 0.35 * e.surprisePct + 0.20 * rev;
    e.fuel = Math.round(raw * Math.exp(-e.sessionsAgo / 60));
  }
}

/** Finnhub earnings calendar for a date range, split in 1-week windows (large ranges get truncated). */
export async function fetchEarningsCalendar(key: string, fromDays: number, toDays: number): Promise<EarnEvent[]> {
  const out: EarnEvent[] = [];
  const DAY = 86_400_000;
  // 7-day windows: in earnings season a 3-week window holds thousands of reports and Finnhub truncates it.
  for (let a = fromDays; a < toDays; a += 7) {
    const from = new Date(Date.now() + a * DAY).toISOString().slice(0, 10);
    const to = new Date(Date.now() + Math.min(toDays, a + 6) * DAY).toISOString().slice(0, 10);
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`);
      if (!res.ok) { await res.body?.cancel(); continue; }
      const j = await res.json();
      for (const e of (j?.earningsCalendar ?? []) as Record<string, unknown>[]) {
        if (!e.symbol || !e.date) continue;
        const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
        out.push({
          symbol: String(e.symbol).toUpperCase(), date: String(e.date), hour: e.hour ? String(e.hour) : null,
          epsActual: num(e.epsActual), epsEstimate: num(e.epsEstimate), revenueActual: num(e.revenueActual), revenueEstimate: num(e.revenueEstimate),
        });
      }
    } catch (err) { console.warn("earnings calendar window failed", err); }
  }
  return out;
}
