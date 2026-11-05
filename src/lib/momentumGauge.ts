/**
 * Momentum gauge (Stages tab): is this a market where buying strength works?
 *
 * Five readings, each scored good (+1) / mixed (0) / bad (−1), weighted, plus a "today" layer
 * that can only make the verdict more cautious:
 *   1. Trend            — index above its 200-day, 12-month return, drawdown
 *                         (Cooper, Gutierrez & Hameed 2004: momentum pays after UP markets)
 *   2. Volatility       — VIX, VIX/VIX3M, realised volatility percentile
 *                         (Daniel & Moskowitz 2016; Barroso & Santa-Clara 2015; Wang & Xu 2015)
 *   3. Momentum's results — did your list's leaders beat its laggards over the last 4 weeks?
 *                         (Ehsani & Linnainmaa 2022: factor momentum)
 *   4. Leadership stretch — how far the leaders sit above their 50-day vs the rest (crowding)
 *   5. Breadth          — share of your list above its 50-day and 21-day lines (daily)
 * Panic state (Daniel & Moskowitz): stressed volatility after a fall → don't chase rebounds.
 */
import { supabase } from "@/integrations/supabase/client";
import { ordinal } from "@/lib/utils";
import type { HistoryPoint } from "@/lib/rsHistory";
import type { StockStage } from "@/lib/stageAnalysis";

export type Level = "good" | "mixed" | "bad" | "na";
export type Verdict = "on" | "selective" | "off" | "panic";

export interface IndexStats { price: number; changePct: number | null; vs50: number; vs200: number; ret12m: number; fromHigh: number; realizedVol: number | null; realizedVolPct: number | null }
export interface Pulse {
  ok: boolean; asOf: string; day: string; session: "pre" | "regular" | "post" | "closed"; minutesIntoSession: number | null;
  indexes: { SPY: IndexStats | null; QQQ: IndexStats | null };
  vix: { level: number; prevClose: number | null; changePct: number | null; vix3m: number | null; ratio: number | null } | null;
  futures: { ES: number | null; NQ: number | null };
  events: { kind: string; label: string }[];
}

export interface Reading { key: string; name: string; level: Level; value: string; meaning: string; source: string; weight: number }
export interface Gauge {
  verdict: Verdict;           // the slow verdict (what the market is)
  today: Verdict;             // after the today layer (what to do today)
  todayReasons: string[];
  score: number; maxScore: number;
  readings: Reading[];
  panic: boolean;
}

export async function loadPulse(): Promise<Pulse> {
  const { data, error } = await supabase.functions.invoke("market-pulse", { body: {} });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? "market data unavailable");
  return data as Pulse;
}

const isOtc = (s: string) => /\.(PK|OTC|OB)$/i.test(s) || (/^[A-Z]{5}$/.test(s) && s.endsWith("F"));

/**
 * The momentum factor in your own list: buy the top 10% by 3-month RS, short the bottom 10%,
 * hold 4 weeks. From the weekly RS snapshots: picks at week k−4, outcome = 1-month relative
 * return (rs_1m) at week k. Returns one value per week, oldest first (in %).
 */
export function momentumSeries(points: HistoryPoint[]): { day: string; spread: number; leaders: number }[] {
  const out: { day: string; spread: number; leaders: number }[] = [];
  for (let k = 4; k < points.length; k++) {
    const a = points[k - 4].snap, b = points[k].snap;
    const pick: { s: string; v: number }[] = [];
    a.s.forEach((s, i) => { const v = a.m3[i]; if (v !== null && v !== undefined && !isOtc(s)) pick.push({ s, v }); });
    if (pick.length < 200) continue;
    pick.sort((x, y) => x.v - y.v);
    const n = Math.max(10, Math.floor(pick.length / 10));
    const bottom = new Set(pick.slice(0, n).map((x) => x.s));
    const top = new Set(pick.slice(-n).map((x) => x.s));
    let ts = 0, tn = 0, bs = 0, bn = 0, as = 0, an = 0;
    b.s.forEach((s, i) => {
      const v = b.m1[i];
      if (v === null || v === undefined) return;
      as += v; an++;
      if (top.has(s)) { ts += v; tn++; } else if (bottom.has(s)) { bs += v; bn++; }
    });
    if (tn < 5 || bn < 5) continue;
    out.push({ day: points[k].day, spread: Math.round((ts / tn - bs / bn) * 10) / 10, leaders: Math.round((ts / tn - as / an) * 10) / 10 });
  }
  return out;
}

/** Daily breadth and leadership stretch from the stage rows' daily snapshot (features.dly). */
export function dailyBreadth(rows: StockStage[]) {
  const withD = rows.filter((r) => r.symbol !== "SPY" && r.features?.dly);
  if (withD.length < 100) return null;
  const p50 = withD.filter((r) => (r.features!.dly!.sma50Pct ?? -1) > 0).length / withD.filter((r) => r.features!.dly!.sma50Pct !== null).length * 100;
  const p21 = withD.filter((r) => r.features!.dly!.ema21Pct > 0).length / withD.length * 100;
  const date = withD.reduce((m, r) => (r.features!.dly!.date > m ? r.features!.dly!.date : m), "");
  // Leaders = top 10% by 52-week relative strength (mrs52); stretch = their median distance
  // above the 50-day minus the list's median distance.
  const ranked = withD.filter((r) => r.features?.mrs52 !== null && r.features?.mrs52 !== undefined && r.features.dly!.sma50Pct !== null)
    .sort((a, b) => (b.features!.mrs52 as number) - (a.features!.mrs52 as number));
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const top = ranked.slice(0, Math.max(10, Math.floor(ranked.length / 10)));
  const stretch = med(top.map((r) => r.features!.dly!.sma50Pct as number)) - med(ranked.map((r) => r.features!.dly!.sma50Pct as number));
  return { p50, p21, date, stretch, n: withD.length };
}

const fmt = (x: number | null | undefined, d = 1, sign = true) => (x === null || x === undefined ? "—" : `${sign && x > 0 ? "+" : ""}${x.toFixed(d)}`);

export function buildGauge(pulse: Pulse | null, mom: { day: string; spread: number; leaders: number }[], breadth: ReturnType<typeof dailyBreadth>): Gauge {
  const readings: Reading[] = [];

  // 1. Trend
  const spy = pulse?.indexes.SPY ?? null, qqq = pulse?.indexes.QQQ ?? null;
  let trend: Level = "na";
  let drawdown = 0;
  if (spy && qqq) {
    const up = (x: IndexStats) => x.vs200 > 0 && x.ret12m > 0;
    drawdown = Math.min(spy.fromHigh, qqq.fromHigh);
    trend = up(spy) && up(qqq) && drawdown > -10 ? "good" : (spy.vs200 < 0 && qqq.vs200 < 0) || drawdown <= -10 ? "bad" : "mixed";
  }
  readings.push({
    key: "trend", name: "Market trend", level: trend, weight: 1,
    value: spy && qqq ? `S&P ${fmt(spy.vs200)}% vs 200-day · Nasdaq-100 ${fmt(qqq.vs200)}% · from high ${fmt(drawdown, 1)}%` : "—",
    meaning: "Momentum has paid mainly after up markets. Both indexes above their 200-day with a positive 12-month return = good; both below, or 10%+ off the high = bad.",
    source: "Cooper, Gutierrez & Hameed (2004)",
  });

  // 2. Volatility
  const v = pulse?.vix ?? null;
  const rvPct = Math.max(spy?.realizedVolPct ?? 0, qqq?.realizedVolPct ?? 0);
  let vol: Level = "na";
  if (v) vol = v.level >= 28 || (v.ratio ?? 0) > 1 ? "bad" : v.level < 20 && (v.ratio ?? 1) < 0.95 && rvPct < 70 ? "good" : "mixed";
  readings.push({
    key: "vol", name: "Volatility", level: vol, weight: 1.5,
    value: v ? `VIX ${v.level.toFixed(1)}${v.ratio ? ` · VIX/VIX3M ${v.ratio.toFixed(2)}` : ""} · realised volatility ${ordinal(rvPct)} percentile (2y)` : "—",
    meaning: "Momentum crashes happen in high-volatility markets, especially when they rebound. Calm (VIX < 20, normal term structure) = good; VIX ≥ 28 or short-term fear above long-term (ratio > 1) = bad.",
    source: "Daniel & Moskowitz (2016); Barroso & Santa-Clara (2015); Wang & Xu (2015)",
  });

  // 3. Momentum's own recent results
  const last = mom[mom.length - 1] ?? null;
  const prev = mom.length >= 5 ? mom[mom.length - 5] : null;
  let res: Level = "na";
  if (last) res = last.spread > 1 && (prev?.spread ?? 0) >= 0 ? "good" : last.spread < -1 || (last.spread < 0 && (prev?.spread ?? 0) < 0) ? "bad" : "mixed";
  readings.push({
    key: "momentum", name: "Is momentum working?", level: res, weight: 1.5,
    value: last ? `Leaders minus laggards, last 4 weeks: ${fmt(last.spread)} pts${prev ? ` (4 weeks before: ${fmt(prev.spread)})` : ""}` : "Needs the RS history (open Share over time once)",
    meaning: "Your list's top 10% by 3-month RS vs its bottom 10%. Styles that worked recently tend to keep working; when the leaders lag, breakouts fail more often.",
    source: "Ehsani & Linnainmaa (2022), factor momentum; this app's backtest",
  });

  // 4. Leadership stretch (crowding)
  let stretch: Level = "na";
  if (breadth) stretch = breadth.stretch >= 30 ? "bad" : breadth.stretch >= 20 ? "mixed" : "good";
  readings.push({
    key: "stretch", name: "Leaders' stretch", level: stretch, weight: 0.5,
    value: breadth ? `Leaders sit ${fmt(breadth.stretch, 0)} pts further above their 50-day than the typical stock` : "—",
    meaning: "When the leaders are far more extended than everything else, the trade is crowded and pullbacks hit them hardest. In this app's data the June 2026 momentum crash came after the gap passed ~35 pts.",
    source: "Crowding research (MSCI); this app's data",
  });

  // 5. Breadth (daily)
  let br: Level = "na";
  if (breadth) br = breadth.p50 >= 55 && breadth.p21 >= 50 ? "good" : breadth.p50 < 40 ? "bad" : "mixed";
  readings.push({
    key: "breadth", name: "Breadth (daily)", level: br, weight: 0.5,
    value: breadth ? `${breadth.p50.toFixed(0)}% above 50-day · ${breadth.p21.toFixed(0)}% above 21-day EMA` : "—",
    meaning: "How many of your stocks are in short-term uptrends. Helpful context, but weak on its own — after washouts, low breadth has come before strong rebounds.",
    source: "Practitioner breadth measures",
  });

  const val = { good: 1, mixed: 0, bad: -1, na: 0 } as const;
  const score = Math.round(readings.reduce((s, r) => s + val[r.level] * r.weight, 0) * 10) / 10;
  const maxScore = readings.reduce((s, r) => s + r.weight, 0);
  const panic = vol === "bad" && (trend === "bad" || drawdown <= -8);
  const coreBad = [trend, vol, res].includes("bad");
  const verdict: Verdict = panic ? "panic" : score >= 2.5 && !coreBad ? "on" : score <= -1.5 || (trend === "bad" && res === "bad") ? "off" : "selective";

  // Today layer: can only make it more cautious.
  const reasons: string[] = [];
  if (pulse) {
    const fut = Math.min(pulse.futures.NQ ?? 0, pulse.futures.ES ?? 0);
    const idx = Math.min(pulse.indexes.QQQ?.changePct ?? 0, pulse.indexes.SPY?.changePct ?? 0);
    const sessionMove = pulse.session === "regular" || pulse.session === "post" ? idx : fut;
    if (sessionMove <= -1.5) reasons.push(`${pulse.session === "pre" || pulse.session === "closed" ? "Index futures" : "The indexes"} ${fmt(sessionMove)}% today`);
    if ((pulse.vix?.changePct ?? 0) >= 15) reasons.push(`VIX ${fmt(pulse.vix!.changePct, 0)}% since yesterday`);
    for (const e of pulse.events) reasons.push(e.label);
    if (pulse.session === "regular" && (pulse.minutesIntoSession ?? 0) < 30) reasons.push("First 30 minutes — opening moves often reverse");
  }
  // A gap/sell-off or a volatility jump today → at least "off" for today; a known event or the
  // first 30 minutes → one notch more careful than "on".
  const severe = reasons.some((r) => /futures|indexes|VIX/.test(r));
  let today: Verdict = verdict;
  if (verdict !== "panic") {
    if (severe) today = "off";
    else if (reasons.length && verdict === "on") today = "selective";
  }

  return { verdict, today, todayReasons: reasons, score, maxScore, readings, panic };
}

export const VERDICT_TEXT: Record<Verdict, { label: string; tone: "good" | "warn" | "bad"; text: string }> = {
  on: { label: "Momentum on", tone: "good", text: "Trend, volatility and the leaders all cooperate — qualified breakouts at normal size." },
  selective: { label: "Selective", tone: "warn", text: "Mixed signals — only the best setups, smaller size, tight stops." },
  off: { label: "Momentum off", tone: "bad", text: "Buying strength isn't working now — protect capital, build a list for later." },
  panic: { label: "Panic — don't chase rebounds", tone: "bad", text: "Stressed volatility after a fall. Momentum has crashed most in these states, often on the rebound: beaten-down stocks jump, leaders lag." },
};
