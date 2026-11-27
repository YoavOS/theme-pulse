/**
 * Portfolio engine — pure functions (no React, no network), tested in engine.test.ts.
 * Positions are typed in by hand; prices come from the PC's daily bars plus a live quote;
 * earnings and news from the portfolio-live backend function.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PositionRow {
  id: string; symbol: string; entry_date: string; entry_price: number; shares: number;
  initial_stop: number | null; stop: number | null; target: number | null; setup: string | null;
  status: "open" | "closed"; exit_date: string | null; exit_price: number | null; notes: string | null; exit_note?: string | null;
}
export interface Bars { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }
export interface Quote { price: number | null; prevClose: number | null; dayHigh: number | null; dayLow: number | null; volume: number | null; time: number | null; name?: string | null }
export interface EarnRow { date: string; hour: string | null; quarter: number | null; year: number | null; epsActual: number | null; epsEstimate: number | null; revenueActual: number | null; revenueEstimate: number | null }
export interface NewsItem { headline: string; summary: string | null; source: string | null; url: string; time: number | null }
export interface Context {
  symbol: string; company: string | null; sector: string | null; industry: string | null; market_cap: number | null; adr_percent: number | null;
  rs_rating: number | null; return_1w: number | null; return_1m: number | null; return_3m: number | null;
  rs_nh_20d: boolean | null; rs_nh_6m: boolean | null; stage: number | null; substage: string | null; weeks_in_stage: number | null; themes: string[] | null;
}

// ── New York calendar ─────────────────────────────────────────────────────────

/** NYSE full-day closures (2026–2027). Beyond that only weekends are known. */
export const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const addDays = (iso: string, n: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const isTradingDay = (iso: string) => { const w = new Date(`${iso}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6 && !NYSE_HOLIDAYS.has(iso); };
export function prevTradingDay(iso: string) { let d = addDays(iso, -1); while (!isTradingDay(d)) d = addDays(d, -1); return d; }
export function nextTradingDay(iso: string) { let d = addDays(iso, 1); while (!isTradingDay(d)) d = addDays(d, 1); return d; }

/** New York date and minutes after midnight. */
export function nyNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: +p.hour * 60 + +p.minute };
}
export function marketOpen(now = new Date()) { const n = nyNow(now); return isTradingDay(n.date) && n.mins >= 570 && n.mins < 960; }

/** Trading sessions from now up to and including `last` (today counts until the 16:00 close). */
export function sessionsUntil(last: string, now = new Date()) {
  const n = nyNow(now);
  let d = n.date, count = 0;
  if (!(isTradingDay(d) && n.mins < 960)) d = nextTradingDay(d);
  while (d <= last && count < 400) { count++; d = nextTradingDay(d); }
  return count;
}

// ── Earnings ──────────────────────────────────────────────────────────────────

export type Bell = "before" | "after" | "during" | "unknown";
export const bellOf = (hour: string | null): Bell => hour === "bmo" ? "before" : hour === "amc" ? "after" : hour === "dmh" ? "during" : "unknown";

export interface EarningsPlan {
  date: string; bell: Bell;
  /** last regular session that ends before the report hits the price */
  lastSession: string;
  /** trading sessions left up to and including lastSession (0 = the report is already in the price or today is past it) */
  sessionsLeft: number;
  calendarDays: number;
  epsEstimate: number | null; revenueEstimate: number | null;
}

export function nextEarnings(rows: EarnRow[] | null | undefined, now = new Date()): EarningsPlan | null {
  const today = nyNow(now).date;
  const r = (rows ?? []).filter((x) => x.date >= today && x.epsActual == null).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!r) return null;
  const bell = bellOf(r.hour);
  const lastSession = bell === "after" ? (isTradingDay(r.date) ? r.date : prevTradingDay(r.date)) : prevTradingDay(r.date);
  return {
    date: r.date, bell, lastSession, sessionsLeft: sessionsUntil(lastSession, now),
    calendarDays: Math.round((Date.parse(`${r.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400_000),
    epsEstimate: r.epsEstimate, revenueEstimate: r.revenueEstimate,
  };
}

export interface PastReport extends EarnRow {
  epsSurprisePct: number | null; revSurprisePct: number | null;
  /** price reaction: the first session that traded on the news vs the close before it */
  gapPct: number | null; dayPct: number | null; reactionDate: string | null;
}
export function pastReports(rows: EarnRow[] | null | undefined, bars: Bars | null, now = new Date(), n = 4): PastReport[] {
  const today = nyNow(now).date;
  const surprise = (a: number | null, e: number | null) => a == null || e == null || e === 0 ? null : ((a - e) / Math.abs(e)) * 100;
  return (rows ?? []).filter((x) => x.date <= today && x.epsActual != null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, n).map((r) => {
    let gapPct: number | null = null, dayPct: number | null = null, reactionDate: string | null = null;
    if (bars && bars.d.length) {
      const bell = bellOf(r.hour);
      const react = bell === "after" ? nextTradingDay(r.date) : (isTradingDay(r.date) ? r.date : nextTradingDay(r.date));
      const i = bars.d.indexOf(react);
      if (i > 0) {
        reactionDate = react;
        const prev = bars.c[i - 1];
        gapPct = prev > 0 ? (bars.o[i] / prev - 1) * 100 : null;
        dayPct = prev > 0 ? (bars.c[i] / prev - 1) * 100 : null;
      }
    }
    return { ...r, epsSurprisePct: surprise(r.epsActual, r.epsEstimate), revSurprisePct: surprise(r.revenueActual, r.revenueEstimate), gapPct, dayPct, reactionDate };
  });
}

// ── Technicals ────────────────────────────────────────────────────────────────

export const sma = (xs: number[], n: number) => xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n;
export function ema(xs: number[], n: number) {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < xs.length; i++) e = xs[i] * k + e * (1 - k);
  return e;
}
export function emaSeries(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(xs.length).fill(null);
  if (xs.length < n) return out;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  for (let i = n; i < xs.length; i++) { e = xs[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
export function smaSeries(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(xs.length).fill(null);
  let s = 0;
  for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= n) s -= xs[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
export function atr(b: Bars, n = 14) {
  if (b.c.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < b.c.length; i++) tr.push(Math.max(b.h[i] - b.l[i], Math.abs(b.h[i] - b.c[i - 1]), Math.abs(b.l[i] - b.c[i - 1])));
  return sma(tr, n);
}

export interface Technicals {
  close: number; asOf: string;
  ema21: number | null; sma50: number | null; sma200: number | null; atr: number | null; atrPct: number | null;
  vsEma21: number | null; vsSma50: number | null; vsSma200: number | null;
  /** how many ATRs the price sits above the 50-day */
  atrAbove50: number | null;
  high52: number | null; low52: number | null; fromHigh: number | null;
  avgVol50: number | null;
  /** RS line = close / SPY close. New high = at its 52-week high within the last 5 sessions. */
  rs: { newHigh: boolean; daysSinceHigh: number | null; fromHigh: number | null } | null;
}

/** `price` overrides the last close (live quote) for the distance measures. */
export function technicals(b: Bars | null, spy: Bars | null, price?: number | null): Technicals | null {
  if (!b || b.c.length < 2) return null;
  const n = b.c.length, close = price ?? b.c[n - 1];
  const pct = (m: number | null) => (m && m > 0 ? (close / m - 1) * 100 : null);
  const e21 = ema(b.c, 21), s50 = sma(b.c, 50), s200 = sma(b.c, 200), a = atr(b);
  const y = b.c.slice(-252), yh = b.h.slice(-252), yl = b.l.slice(-252);
  const high52 = y.length >= 20 ? Math.max(...yh, close) : null, low52 = y.length >= 20 ? Math.min(...yl, close) : null;
  let rs: Technicals["rs"] = null;
  if (spy && spy.c.length) {
    const sp = new Map(spy.d.map((d, i) => [d, spy.c[i]]));
    const line: number[] = [];
    for (let i = Math.max(0, n - 252); i < n; i++) { const s = sp.get(b.d[i]); if (s && s > 0) line.push(b.c[i] / s); }
    if (line.length >= 50) {
      const max = Math.max(...line);
      let last = -1;
      for (let i = 0; i < line.length; i++) if (line[i] >= max * 0.9995) last = i;
      const days = line.length - 1 - last;
      rs = { newHigh: days <= 4, daysSinceHigh: days, fromHigh: (line[line.length - 1] / max - 1) * 100 };
    }
  }
  return {
    close, asOf: b.d[n - 1], ema21: e21, sma50: s50, sma200: s200, atr: a, atrPct: a ? (a / close) * 100 : null,
    vsEma21: pct(e21), vsSma50: pct(s50), vsSma200: pct(s200),
    atrAbove50: a && s50 ? (close - s50) / a : null,
    high52, low52, fromHigh: high52 ? (close / high52 - 1) * 100 : null,
    avgVol50: sma(b.v.slice(-50).map(Number), Math.min(50, b.v.length)),
    rs,
  };
}

// ── Positions ─────────────────────────────────────────────────────────────────

export interface Holding {
  /** open lots of one symbol combined (average cost); `lots` keeps the rows for edits */
  symbol: string; lots: PositionRow[]; shares: number; avgCost: number; firstEntry: string;
  stop: number | null; initialRisk: number | null; target: number | null;
  price: number | null; priceIsLive: boolean; prevClose: number | null;
  marketValue: number | null; cost: number; openPnl: number | null; openPct: number | null;
  dayPnl: number | null; dayPct: number | null;
  rMultiple: number | null; riskToStop: number | null; stopDistPct: number | null; weight: number | null;
  daysHeld: number;
}

export function buildHoldings(rows: PositionRow[], quotes: Record<string, Quote | null>, bars: Record<string, Bars | null>, now = new Date()): Holding[] {
  const today = nyNow(now).date;
  const by = new Map<string, PositionRow[]>();
  for (const r of rows.filter((x) => x.status === "open")) { const k = r.symbol.toUpperCase(); by.set(k, [...(by.get(k) ?? []), r]); }
  const hs: Holding[] = [];
  for (const [symbol, lots] of by) {
    const shares = lots.reduce((a, l) => a + Number(l.shares), 0);
    const cost = lots.reduce((a, l) => a + Number(l.shares) * Number(l.entry_price), 0);
    const avgCost = shares ? cost / shares : 0;
    const q = quotes[symbol], b = bars[symbol];
    const lastBar = b && b.c.length ? b.c[b.c.length - 1] : null;
    const price = q?.price ?? lastBar;
    const prevClose = q?.prevClose ?? (b && b.c.length > 1 ? b.c[b.c.length - 2] : null);
    const stops = lots.map((l) => l.stop ?? l.initial_stop).filter((x): x is number => x != null);
    const stop = stops.length ? Math.min(...stops.map(Number)) : null;
    const init = lots.every((l) => l.initial_stop != null) ? lots.reduce((a, l) => a + Number(l.shares) * (Number(l.entry_price) - Number(l.initial_stop)), 0) : null;
    const firstEntry = lots.map((l) => l.entry_date).sort()[0];
    const mv = price != null ? shares * price : null;
    // day P&L: lots bought today count from their entry price
    const dayPnl = price != null && prevClose != null ? lots.reduce((a, l) => a + Number(l.shares) * (price - (l.entry_date === today ? Number(l.entry_price) : prevClose)), 0) : null;
    const dayBase = prevClose != null ? lots.reduce((a, l) => a + Number(l.shares) * (l.entry_date === today ? Number(l.entry_price) : prevClose), 0) : null;
    const targets = lots.map((l) => l.target).filter((x): x is number => x != null);
    hs.push({
      symbol, lots, shares, avgCost, firstEntry, stop, initialRisk: init && init > 0 ? init : null, target: targets.length ? Math.max(...targets.map(Number)) : null,
      price, priceIsLive: q?.price != null, prevClose, marketValue: mv, cost,
      openPnl: mv != null ? mv - cost : null, openPct: mv != null && cost ? (mv / cost - 1) * 100 : null,
      dayPnl, dayPct: dayPnl != null && dayBase ? (dayPnl / dayBase) * 100 : null,
      rMultiple: mv != null && init && init > 0 ? (mv - cost) / init : null,
      riskToStop: stop != null && price != null ? Math.max(0, shares * (price - stop)) : null,
      stopDistPct: stop != null && price ? (stop / price - 1) * 100 : null,
      weight: null,
      daysHeld: Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${firstEntry}T12:00:00Z`)) / 86400_000)),
    });
  }
  const total = hs.reduce((a, h) => a + (h.marketValue ?? 0), 0);
  for (const h of hs) h.weight = total > 0 && h.marketValue != null ? (h.marketValue / total) * 100 : null;
  return hs.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export interface ClosedTrade { row: PositionRow; pnl: number; pct: number; r: number | null; days: number }
export function closedTrades(rows: PositionRow[]): ClosedTrade[] {
  return rows.filter((r) => r.status === "closed" && r.exit_price != null).map((r) => {
    const sh = Number(r.shares), e = Number(r.entry_price), x = Number(r.exit_price);
    const risk = r.initial_stop != null && e > Number(r.initial_stop) ? (e - Number(r.initial_stop)) * sh : null;
    return {
      row: r, pnl: (x - e) * sh, pct: (x / e - 1) * 100, r: risk ? ((x - e) * sh) / risk : null,
      days: r.exit_date ? Math.max(0, Math.round((Date.parse(`${r.exit_date}T12:00:00Z`) - Date.parse(`${r.entry_date}T12:00:00Z`)) / 86400_000)) : 0,
    };
  }).sort((a, b) => (b.row.exit_date ?? "").localeCompare(a.row.exit_date ?? ""));
}
export function closedStats(t: ClosedTrade[]) {
  const wins = t.filter((x) => x.pnl > 0), losses = t.filter((x) => x.pnl <= 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    count: t.length, realized: t.reduce((a, x) => a + x.pnl, 0), winRate: t.length ? (wins.length / t.length) * 100 : null,
    avgWinPct: avg(wins.map((x) => x.pct)), avgLossPct: avg(losses.map((x) => x.pct)),
    avgR: avg(t.map((x) => x.r).filter((x): x is number => x != null)),
    avgDaysWin: avg(wins.map((x) => x.days)), avgDaysLoss: avg(losses.map((x) => x.days)),
  };
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export type AlertKind = "earnings" | "stop" | "below50" | "below21" | "extended" | "noStop" | "target" | "rsHigh" | "news" | "noData";
export interface Alert { symbol: string; kind: AlertKind; level: "high" | "medium" | "low" | "good"; text: string }

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const bellText = (b: Bell) => b === "before" ? "before the open" : b === "after" ? "after the close" : b === "during" ? "during the session" : "time not announced";

export function alertsFor(h: Holding, t: Technicals | null, e: EarningsPlan | null, news: NewsItem[] | null, warnSessions = 5, now = new Date()): Alert[] {
  const out: Alert[] = [];
  const s = h.symbol;
  if (e && e.sessionsLeft <= warnSessions) {
    const when = e.sessionsLeft <= 0 ? "the report is already in the price or out today" : e.sessionsLeft === 1 ? `today is the last full session before it (${fmtDay(e.lastSession)})` : `${e.sessionsLeft} sessions left, the last full one is ${fmtDay(e.lastSession)}`;
    out.push({ symbol: s, kind: "earnings", level: e.sessionsLeft <= 2 ? "high" : "medium", text: `Reports ${fmtDay(e.date)}, ${bellText(e.bell)} — ${when}` });
  }
  if (h.stop != null && h.price != null && h.price <= h.stop) out.push({ symbol: s, kind: "stop", level: "high", text: `At or below your stop (${h.stop.toFixed(2)})` });
  if (t?.vsSma50 != null && t.vsSma50 < 0) out.push({ symbol: s, kind: "below50", level: "medium", text: `${Math.abs(t.vsSma50).toFixed(1)}% below the 50-day average` });
  else if (t?.vsEma21 != null && t.vsEma21 < 0) out.push({ symbol: s, kind: "below21", level: "low", text: `${Math.abs(t.vsEma21).toFixed(1)}% below the 21-day EMA` });
  if (t?.atrAbove50 != null && t.vsSma50 != null && (t.atrAbove50 >= 7 || t.vsSma50 >= 25)) out.push({ symbol: s, kind: "extended", level: "low", text: `Extended: ${t.vsSma50.toFixed(0)}% above the 50-day (${t.atrAbove50.toFixed(1)} ATR)` });
  if (h.target != null && h.price != null && h.price >= h.target) out.push({ symbol: s, kind: "target", level: "good", text: `Reached your target (${h.target.toFixed(2)})` });
  if (h.stop == null) out.push({ symbol: s, kind: "noStop", level: "low", text: "No stop set — open risk unknown" });
  if (t?.rs?.newHigh) out.push({ symbol: s, kind: "rsHigh", level: "good", text: "RS line at a new 52-week high" });
  const dayAgo = now.getTime() / 1000 - 86400;
  const fresh = (news ?? []).filter((n) => (n.time ?? 0) >= dayAgo).length;
  if (fresh) out.push({ symbol: s, kind: "news", level: "low", text: `${fresh} news item${fresh > 1 ? "s" : ""} in the last 24 hours` });
  if (!t) out.push({ symbol: s, kind: "noData", level: "low", text: "No daily prices on the PC yet — they download overnight (or press Refresh)" });
  return out;
}
const LEVEL = { high: 0, medium: 1, low: 2, good: 3 } as const;
export const sortAlerts = (a: Alert[]) => [...a].sort((x, y) => LEVEL[x.level] - LEVEL[y.level]);

// ── Summary ───────────────────────────────────────────────────────────────────

export interface Summary {
  positions: number; marketValue: number; cost: number; openPnl: number; openPct: number | null; dayPnl: number; dayPct: number | null;
  openRisk: number | null; openRiskPct: number | null; invested: number | null; cash: number | null;
  largest: { symbol: string; weight: number } | null;
  reportsSoon: { symbol: string; plan: EarningsPlan }[];
  exposure: { name: string; weight: number; symbols: string[] }[];
}

export function summarize(hs: Holding[], ctx: Record<string, Context | null>, plans: Record<string, EarningsPlan | null>, accountSize: number | null, warnSessions = 5, groupBy: "theme" | "industry" = "industry"): Summary {
  const mv = hs.reduce((a, h) => a + (h.marketValue ?? 0), 0), cost = hs.reduce((a, h) => a + h.cost, 0);
  const day = hs.reduce((a, h) => a + (h.dayPnl ?? 0), 0);
  const allStops = hs.length > 0 && hs.every((h) => h.riskToStop != null);
  const risk = hs.reduce((a, h) => a + (h.riskToStop ?? 0), 0);
  const groups = new Map<string, { weight: number; symbols: string[] }>();
  for (const h of hs) {
    const c = ctx[h.symbol];
    const name = groupBy === "theme" ? (c?.themes?.[0] ?? "No theme") : (c?.industry ?? c?.sector ?? "Unclassified");
    const g = groups.get(name) ?? { weight: 0, symbols: [] };
    g.weight += h.weight ?? 0; g.symbols.push(h.symbol); groups.set(name, g);
  }
  const largest = [...hs].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];
  return {
    positions: hs.length, marketValue: mv, cost, openPnl: mv - cost, openPct: cost ? (mv / cost - 1) * 100 : null,
    dayPnl: day, dayPct: mv - day > 0 ? (day / (mv - day)) * 100 : null,
    openRisk: allStops ? risk : hs.some((h) => h.riskToStop != null) ? risk : null,
    openRiskPct: accountSize && hs.some((h) => h.riskToStop != null) ? (risk / accountSize) * 100 : null,
    invested: accountSize ? (mv / accountSize) * 100 : null, cash: accountSize ? accountSize - mv : null,
    largest: largest?.weight != null ? { symbol: largest.symbol, weight: largest.weight } : null,
    reportsSoon: hs.map((h) => ({ symbol: h.symbol, plan: plans[h.symbol] })).filter((x): x is { symbol: string; plan: EarningsPlan } => !!x.plan && x.plan.sessionsLeft <= Math.max(warnSessions, 10))
      .sort((a, b) => a.plan.date.localeCompare(b.plan.date)),
    exposure: [...groups.entries()].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.weight - a.weight),
  };
}

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(2)}M` : Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** The hero sentence, written from the numbers. */
export function headline(s: Summary, warnSessions = 5): string {
  if (!s.positions) return "No open positions yet — add your first one to start tracking it";
  const pnl = `${s.openPnl >= 0 ? "+" : ""}${money(s.openPnl)} open${s.openPct != null ? ` (${s.openPct >= 0 ? "+" : ""}${s.openPct.toFixed(1)}%)` : ""}`;
  const soon = s.reportsSoon.filter((r) => r.plan.sessionsLeft <= warnSessions);
  const tail = soon.length === 1 ? `; ${soon[0].symbol} reports in ${soon[0].plan.calendarDays} day${soon[0].plan.calendarDays === 1 ? "" : "s"}`
    : soon.length > 1 ? `; ${soon.length} report within ${warnSessions} sessions` : "";
  return `${s.positions} position${s.positions === 1 ? "" : "s"}, ${pnl}${tail}`;
}
