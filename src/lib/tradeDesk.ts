// ─────────────────────────────────────────────────────────────
// Trade Desk — position sizing, exit checks and portfolio risk.
//
// Built from the exits / sizing research and tested on your list
// (3,890 breakouts above a 40-day high in Stage-2-like trends,
// Oct 2024–Oct 2026, 8% initial stop, results in R):
//   exit rule                        avg R   win%   median hold
//   5× ATR trailing stop             +0.50    30%   25 sessions
//   2 closes below the 50-day        +0.40    34%   23
//   1 close below the 50-day         +0.32    33%   22
//   sell half at +20%, rest 50-day   +0.28    37%   22
//   fixed +20% target                +0.23    37%   15
//   3× ATR trailing stop             +0.22    35%   19
//   close below the 21-day EMA       +0.18    36%   13
// The top 10% of trades made more than all of the profit under every rule —
// exits that leave room for the rare big winner did best. Today's stocks only
// (survivorship) and a 2-year window, so long trends are cut short.
// ─────────────────────────────────────────────────────────────

export interface Position {
  id: string;
  symbol: string;
  entry_date: string;
  entry_price: number;
  shares: number;
  initial_stop: number;
  stop: number | null;
  status: "open" | "closed";
  exit_date: string | null;
  exit_price: number | null;
  notes: string | null;
}

export interface Daily { t: number[]; o: (number | null)[]; h: (number | null)[]; l: (number | null)[]; c: (number | null)[]; v: (number | null)[]; earnings: string | null }

export interface Check { tone: "go" | "caution" | "stop" | "info"; title: string; text: string; strength?: "strong" | "moderate" | "weak" | "own data" }

export interface PositionView {
  pos: Position;
  ok: boolean;
  last: number;
  lastDate: string;
  R: number;                 // $ per share of initial risk
  rNow: number;              // open R multiple
  mfeR: number;              // best close since entry, in R
  sessions: number;
  ema21: number | null;
  sma50: number | null;
  atr: number | null;
  closesBelow50: number;
  stopNow: number;           // effective stop (user stop or initial)
  suggest: { level: number; label: string }[];
  checks: Check[];
  earningsInDays: number | null;
  openRisk: number;          // $ lost from here if the stop is hit (≥ 0)
  capitalRisk: number;       // $ below the entry price if the stop is hit (≥ 0) — portfolio heat
  value: number;
  returns: number[];         // last 60 daily returns (correlation)
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function analyzePosition(pos: Position, d: Daily | null | undefined, equity: number, riskPct: number, stressMovePct: number): PositionView {
  const R = Math.max(1e-9, pos.entry_price - pos.initial_stop);
  const stopNow = pos.stop ?? pos.initial_stop;
  const empty: PositionView = {
    pos, ok: false, last: pos.entry_price, lastDate: pos.entry_date, R, rNow: 0, mfeR: 0, sessions: 0, ema21: null, sma50: null, atr: null,
    closesBelow50: 0, stopNow, suggest: [], checks: [], earningsInDays: null, openRisk: Math.max(0, pos.entry_price - stopNow) * pos.shares,
    capitalRisk: Math.max(0, pos.entry_price - stopNow) * pos.shares,
    value: pos.entry_price * pos.shares, returns: [],
  };
  if (!d || !d.c?.length) return empty;
  const n = d.c.length;
  const c: number[] = [], h: number[] = [], l: number[] = [], t: number[] = [];
  for (let i = 0; i < n; i++) { if (d.c[i] == null) continue; c.push(d.c[i]!); h.push(d.h[i] ?? d.c[i]!); l.push(d.l[i] ?? d.c[i]!); t.push(d.t[i]); }
  const N = c.length;
  if (N < 30) return empty;
  const last = c[N - 1];
  let k0 = t.findIndex((x) => iso(x) >= pos.entry_date);
  if (k0 < 0) k0 = N - 1;
  const sessions = N - 1 - k0;
  // indicators
  let ema = c[0];
  const emaArr = c.map((x, i) => (i === 0 ? x : (ema = ema + (x - ema) * (2 / 22))));
  const ema21 = emaArr[N - 1];
  const sma = (end: number, len: number) => (end + 1 >= len ? c.slice(end - len + 1, end + 1).reduce((a, b) => a + b, 0) / len : null);
  const sma50 = sma(N - 1, 50);
  const tr = (i: number) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const atr = N > 15 ? Array.from({ length: 14 }, (_, k) => tr(N - 14 + k)).reduce((a, b) => a + b, 0) / 14 : null;
  let closesBelow50 = 0;
  for (let i = N - 1; i >= Math.max(49, k0 + 1); i--) { const m = sma(i, 50); if (m !== null && c[i] < m) closesBelow50++; else break; }
  const since = c.slice(k0 + 1);
  const maxClose = since.length ? Math.max(...since) : pos.entry_price;
  const rNow = (last - pos.entry_price) / R;
  const mfeR = (maxClose - pos.entry_price) / R;

  const suggest: PositionView["suggest"] = [];
  const checks: Check[] = [];
  if (pos.status === "open") {
    // stop levels
    if (mfeR < 1) {
      suggest.push({ level: pos.initial_stop, label: "Initial stop — keep it until the trade proves itself (+1R)" });
    } else {
      const swing = Math.min(...l.slice(Math.max(k0 + 1, N - 10)));
      if (swing < last) suggest.push({ level: Math.max(pos.initial_stop, swing), label: "Under the last 10-day swing low (raise only to new support)" });
    }
    if (atr !== null && sessions >= 3) suggest.push({ level: Math.max(pos.initial_stop, maxClose - 5 * atr), label: "5× ATR trail from the highest close — best rule in your test" });
    if (sma50 !== null) suggest.push({ level: sma50, label: "50-day line — exit after 2 closes below (2nd best)" });

    // checks
    if (last <= stopNow) checks.push({ tone: "stop", title: "Stop hit", text: `Closed at ${last.toFixed(2)}, at or under the ${stopNow.toFixed(2)} stop. Cutting failed trades early is what keeps the left tail small.`, strength: "strong" });
    if (closesBelow50 >= 2 && sessions >= 5) checks.push({ tone: "stop", title: "2 closes below the 50-day", text: "The core exit signal in your test (+0.40R average vs +0.32R for a single close).", strength: "own data" });
    else if (closesBelow50 === 1 && sessions >= 5) checks.push({ tone: "caution", title: "Closed below the 50-day", text: "One close is noisy — a second close below is the exit; a quick reclaim keeps the trade.", strength: "own data" });
    if (sessions >= 10 && mfeR < 0.5 && last < pos.entry_price) checks.push({ tone: "caution", title: "Stalled", text: `${sessions} sessions in, never got to +0.5R and back under the entry. A time stop here didn't hurt returns in your test and frees the capital — consider cutting half or all.`, strength: "own data" });
    const early = c.slice(k0 + 1, Math.min(N, k0 + 16));
    if (early.length && Math.max(...early) >= pos.entry_price * 1.2) checks.push({ tone: "go", title: "Power move", text: "Up 20%+ within 3 weeks of entry. IBD's rule: hold the core at least 8 weeks — such stocks are often the big winners. (Practitioner rule; no edge either way in your test.)", strength: "weak" });
    if (atr !== null && last > ema21 + 4 * atr) checks.push({ tone: "caution", title: "Extended", text: `${((last - ema21) / atr).toFixed(1)} ATRs above the 21-day EMA. Selling 20–33% into a stretch like this is defensible; keep the core on the trend exit — capping winners lowered results in your test.`, strength: "moderate" });
    if (mfeR >= 1 && rNow < 0) checks.push({ tone: "caution", title: "Gave back a +1R gain", text: "Was up 1R+ and is now losing — the swing-low stop above protects against this.", strength: "weak" });
    // earnings
    let earningsInDays: number | null = null;
    if (d.earnings) {
      earningsInDays = Math.round((Date.parse(d.earnings) - Date.parse(iso(t[N - 1]))) / 86_400_000);
      if (earningsInDays >= 0 && earningsInDays <= 14) {
        const allowed = equity * (riskPct / 100);
        const stress = last * (stressMovePct / 100);
        const maxShares = stress > 0 ? Math.floor(allowed / stress) : 0;
        const cushion = (last / pos.entry_price - 1) * 100;
        const tone = pos.shares > maxShares && cushion < stressMovePct ? "stop" : "caution";
        checks.push({
          tone, title: `Earnings in ${earningsInDays} day${earningsInDays === 1 ? "" : "s"}`, strength: "moderate",
          text: `Stops don't cap overnight gaps. With a ${stressMovePct}% stressed gap, holding ${pos.shares.toLocaleString("en-US")} shares risks about $${Math.round(pos.shares * stress).toLocaleString("en-US")} vs your 1R budget of $${Math.round(allowed).toLocaleString("en-US")} — max ≈ ${maxShares.toLocaleString("en-US")} shares through the report. Cushion ${cushion.toFixed(1)}%. No need to sell automatically; size it down instead.`,
        });
      }
    }
    const returns = c.slice(-61).map((x, i, a) => (i ? x / a[i - 1] - 1 : 0)).slice(1);
    return {
      pos, ok: true, last, lastDate: iso(t[N - 1]), R, rNow, mfeR, sessions, ema21, sma50, atr, closesBelow50, stopNow, suggest, checks,
      earningsInDays, openRisk: Math.max(0, last - stopNow) * pos.shares, capitalRisk: Math.max(0, pos.entry_price - stopNow) * pos.shares,
      value: last * pos.shares, returns,
    };
  }
  return { ...empty, ok: true, last, lastDate: iso(t[N - 1]), rNow, mfeR, sessions };
}

/** Effective number of independent positions from the average pairwise correlation (equal-risk approximation). */
export function effectiveN(series: number[][]): { n: number; rho: number | null; eff: number } {
  const s = series.filter((x) => x.length >= 30);
  const n = s.length;
  if (n < 2) return { n, rho: null, eff: n };
  const len = Math.min(...s.map((x) => x.length));
  const z = s.map((x) => x.slice(-len));
  const corr = (a: number[], b: number[]) => {
    const ma = a.reduce((x, y) => x + y, 0) / len, mb = b.reduce((x, y) => x + y, 0) / len;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < len; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sum += corr(z[i], z[j]); cnt++; }
  const rho = sum / cnt;
  return { n, rho, eff: n / (1 + (n - 1) * Math.max(0, rho)) };
}

/** P(at least one run of ≥ L consecutive losses in N independent trades) for a given win rate. */
export function streakProb(N: number, L: number, winRate: number): number {
  const q = 1 - winRate;
  // dp[k] = probability of being in a current losing run of length k without having hit L
  let dp = new Array(L).fill(0);
  dp[0] = 1;
  let hit = 0;
  for (let t = 0; t < N; t++) {
    const next = new Array(L).fill(0);
    for (let k = 0; k < L; k++) {
      if (!dp[k]) continue;
      next[0] += dp[k] * winRate;
      if (k + 1 >= L) hit += dp[k] * q; else next[k + 1] += dp[k] * q;
    }
    dp = next;
  }
  return hit;
}

export interface ClosedStats { n: number; win: number; avgR: number; maxStreak: number; curStreak: number; ddR: number; sumR: number }
export function closedStats(closed: Position[]): ClosedStats | null {
  const rs = closed.filter((p) => p.exit_price !== null)
    .sort((a, b) => (a.exit_date ?? "").localeCompare(b.exit_date ?? ""))
    .map((p) => (p.exit_price! - p.entry_price) / Math.max(1e-9, p.entry_price - p.initial_stop));
  if (!rs.length) return null;
  let streak = 0, maxStreak = 0, cum = 0, peak = 0, dd = 0;
  for (const r of rs) {
    streak = r <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak);
    cum += r; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak);
  }
  return { n: rs.length, win: rs.filter((r) => r > 0).length / rs.length, avgR: cum / rs.length, maxStreak, curStreak: streak, ddR: cum - peak, sumR: cum };
}

/** Suggested risk multiplier from the market type (Market Flag) — a pre-committed throttle, not a forecast. */
export const TYPE_THROTTLE: Record<string, { mult: number; why: string }> = {
  healthy: { mult: 1, why: "Healthy uptrend" },
  extended: { mult: 1, why: "Extended uptrend" },
  narrow: { mult: 0.75, why: "Narrow uptrend — most stocks weak" },
  correction: { mult: 0.75, why: "Pullback in an uptrend" },
  recovery: { mult: 0.75, why: "Recovery attempt" },
  downtrend: { mult: 0.5, why: "S&P below its 200-day" },
  bear: { mult: 0.5, why: "Downtrend" },
  panic: { mult: 0.5, why: "Panic / high stress" },
};
