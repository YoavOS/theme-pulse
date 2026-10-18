// ─────────────────────────────────────────────────────────────
// Market playbook — evidence-based tips for the current market type.
// The market-flag edge function classifies the market; everything here is
// plain data so tips can be edited without redeploying anything.
//
// Evidence labels:
//   strong   — replicated academic finding (many markets / decades)
//   moderate — published and plausible, but weaker or debated out of sample
//   weak     — practitioner rule or thin evidence; treat as a habit, not an edge
//   own data — measured on this app's data (see HISTORY below)
// ─────────────────────────────────────────────────────────────

export type MarketTypeKey = "healthy" | "extended" | "narrow" | "correction" | "recovery" | "downtrend" | "bear" | "panic";
export type Strength = "strong" | "moderate" | "weak" | "own data";

export interface Tip {
  title: string;
  text: string;
  strength: Strength;
  cite?: string;            // key into REFERENCES
  tone?: "go" | "caution" | "stop";
}

export interface FlagMetrics {
  spy: { last: number; ma50: number; ma200: number; ma200Slope: number; dd52: number; below200In60: number; daysBelow50: number; ret24m: number | null; rv20: number | null; rvPct: number | null };
  vix: { last: number | null; vix3m: number | null; term: number | null; pct1y: number | null };
  breadth: { regime: string; p50: number; p200: number; hl: number; asOf: string; n: number; stage2Pct: number; stage4Pct: number } | null;
  credit: { oas: number | null; oasChgBp: number | null; hygIef1m: number | null };
  rates: { tnx: number | null; tnxBp: number | null; irx: number | null; irxBp: number | null };
  dxy: { last: number | null; chg1m: number | null };
  lead: { rsp3m: number | null; iwm1m: number | null; qqq1m: number | null };
}

export const REFERENCES: Record<string, string> = {
  cooper: "Cooper, Gutierrez & Hameed (2004), “Market States and Momentum”, Journal of Finance — momentum profits appear after up markets and vanish after down markets.",
  crash: "Daniel & Moskowitz (2016), “Momentum Crashes”, Journal of Financial Economics — momentum's worst losses come when the market rebounds after a fall with high volatility; beaten-down stocks lead.",
  volman: "Moreira & Muir (2017), “Volatility-Managed Portfolios”, Journal of Finance; Barroso & Santa-Clara (2015), “Momentum Has Its Moments”, JFE — cutting exposure when recent volatility is high improved risk-adjusted returns (out-of-sample gains are debated: Cederburg et al. 2020).",
  trend: "Faber (2007), “A Quantitative Approach to Tactical Asset Allocation”; Moskowitz, Ooi & Pedersen (2012), “Time Series Momentum”, JFE — trend filters mainly cut drawdowns.",
  high52: "George & Hwang (2004), “The 52-Week High and Momentum Investing”, Journal of Finance — stocks near their 52-week high keep outperforming.",
  industry: "Moskowitz & Grinblatt (1999), “Do Industries Explain Momentum?”, Journal of Finance — much of momentum is industry momentum.",
  sentiment: "Baker & Wurgler (2006), “Investor Sentiment and the Cross-Section of Stock Returns”, Journal of Finance — after high sentiment, young, volatile, speculative stocks do worse; after low sentiment, better.",
  credit: "Gilchrist & Zakrajšek (2012), “Credit Spreads and Business Cycle Fluctuations”, American Economic Review — widening credit spreads lead economic and market weakness.",
  vrp: "Bollerslev, Tauchen & Zhou (2009), “Expected Stock Returns and Variance Risk Premia”, Review of Financial Studies — high implied volatility relative to realised predicts higher index returns over the next quarter.",
  fomc: "Lucca & Moench (2015), “The Pre-FOMC Announcement Drift”, Journal of Finance; Kurov, Wolfe & Gilbert (2021), Finance Research Letters — the drift largely disappeared after 2015.",
  own: "This app's own tests: S&P 500 (SPY) daily 2003–Oct 2026 classified with the same rules (narrow = equal-weight lagging, since list breadth has no long history); momentum = MTUM ETF vs SPY since 2013; small caps = IWM vs SPY. Earlier Stages/Bases backtests on your list: market regime mattered more than any setup detail.",
};

/** SPY history by market type (daily, 2003–Oct 2026, overlapping windows — read as tendencies). */
export const HISTORY: Record<MarketTypeKey, { days: number; episodes: number; m1: number; m3: number; up3: number; worstDd3: number; vol: number; momVsSpy: number; momUp: number; smallVsSpy: number }> = {
  healthy:    { days: 1829, episodes: 65, m1: 1.3,  m3: 3.1, up3: 70, worstDd3: -5.3, vol: 11.7, momVsSpy: 0.5,  momUp: 57, smallVsSpy: -0.7 },
  extended:   { days: 1109, episodes: 36, m1: 1.1,  m3: 3.2, up3: 72, worstDd3: -4.3, vol: 8.8,  momVsSpy: 1.9,  momUp: 68, smallVsSpy: -1.4 },
  narrow:     { days: 352,  episodes: 13, m1: 0.9,  m3: 3.6, up3: 72, worstDd3: -5.1, vol: 12.9, momVsSpy: -0.6, momUp: 42, smallVsSpy: -0.3 },
  correction: { days: 631,  episodes: 56, m1: 2.9,  m3: 5.9, up3: 84, worstDd3: -4.9, vol: 13.4, momVsSpy: 0.6,  momUp: 54, smallVsSpy: -0.2 },
  recovery:   { days: 762,  episodes: 26, m1: 2.0,  m3: 5.3, up3: 86, worstDd3: -4.3, vol: 11.6, momVsSpy: 0.1,  momUp: 51, smallVsSpy: 1.4 },
  downtrend:  { days: 243,  episodes: 28, m1: 2.1,  m3: 7.1, up3: 77, worstDd3: -4.9, vol: 17.3, momVsSpy: -0.4, momUp: 42, smallVsSpy: 0.9 },
  bear:       { days: 406,  episodes: 16, m1: 1.3,  m3: 1.9, up3: 55, worstDd3: -9.1, vol: 19.5, momVsSpy: -0.1, momUp: 49, smallVsSpy: 0.9 },
  panic:      { days: 583,  episodes: 35, m1: 3.0,  m3: 7.9, up3: 75, worstDd3: -8.3, vol: 27.7, momVsSpy: 0.7,  momUp: 57, smallVsSpy: 1.3 },
};
export const HISTORY_ALL = { m3: 4.0, up3: 74 };

export const TYPE_INFO: Record<MarketTypeKey, { name: string; blurb: string; tone: "go" | "caution" | "stop" }> = {
  healthy:    { name: "Healthy uptrend", tone: "go", blurb: "S&P above a rising 200-day and its 50-day, volatility normal, participation broad. The best soil for breakouts." },
  extended:   { name: "Extended uptrend", tone: "go", blurb: "A strong trend that has run far (very low VIX or the S&P 15%+ above its 200-day). Momentum still tends to work — but expectations get fragile." },
  narrow:     { name: "Narrow uptrend", tone: "caution", blurb: "The index holds up, but most stocks don't: your list's breadth is weak or the equal-weight index lags. The headline hides the real conditions." },
  correction: { name: "Pullback in an uptrend", tone: "caution", blurb: "The S&P has broken its 50-day (or fallen 7%+) but stays above the 200-day. Usually a pause, sometimes the start of something worse." },
  recovery:   { name: "Recovery attempt", tone: "caution", blurb: "The S&P is back above its 200-day after spending time below it. Early rebounds are led by beaten-down stocks, not the old leaders." },
  downtrend:  { name: "Weakening — below the 200-day", tone: "stop", blurb: "The S&P has lost its 200-day, which is still rising. A warning stage: long-term trend in doubt." },
  bear:       { name: "Downtrend", tone: "stop", blurb: "The S&P is below a falling 200-day. Rallies fail often and drawdowns are deep." },
  panic:      { name: "Panic / high stress", tone: "stop", blurb: "VIX at 30+ or an inverted volatility curve during a selloff. Huge swings both ways." },
};

export const PLAYBOOK: Record<MarketTypeKey, { tips: Tip[]; watch: string[] }> = {
  healthy: {
    tips: [
      { tone: "go", title: "Take qualified breakouts at normal size", strength: "strong", cite: "cooper", text: "Momentum has historically paid after up markets. This is the market to act on Ready / Triggered bases rather than wait." },
      { tone: "go", title: "Fish where the leaders are", strength: "strong", cite: "industry", text: "Much of stock momentum is industry momentum: favour setups in themes and groups that are already leading." },
      { tone: "go", title: "Let winners run on a trend stop", strength: "moderate", cite: "trend", text: "Trail with the 10-week line or a close under the 50-day rather than taking quick profits — trends persist more than they reverse." },
      { tone: "caution", title: "Keep the stop anyway", strength: "own data", cite: "own", text: "Even here the S&P's typical worst dip over the next 3 months was about 5%; individual breakouts swing much more." },
    ],
    watch: ["3 closes below the 50-day → pullback", "Your breadth turns red → narrow", "VIX above VIX3M → stress"],
  },
  extended: {
    tips: [
      { tone: "go", title: "Momentum has done best here", strength: "own data", cite: "own", text: "Since 2013 the momentum ETF beat the S&P in 68% of 3-month windows that started in this type (median +1.9 pts) — the best of any type. Don't fight it." },
      { tone: "caution", title: "Trim what is stretched, not what is working", strength: "moderate", cite: "sentiment", text: "After periods of high sentiment, speculative and very volatile stocks tend to lag. Sell into strength on names far above their 10-week line rather than adding." },
      { tone: "caution", title: "Prefer early bases", strength: "weak", text: "Late-stage (3rd–4th) bases fail more often; favour 1st–2nd stage bases and tight entries close to the pivot." },
      { tone: "caution", title: "Don't short 'too high'", strength: "weak", text: "Calling tops on valuation or low VIX has a poor record; wait for the trend to actually break." },
    ],
    watch: ["VIX jumps back over 20", "3 closes below the 50-day", "Breadth or equal-weight starts to lag → narrow"],
  },
  narrow: {
    tips: [
      { tone: "caution", title: "Trade smaller and fewer", strength: "own data", cite: "own", text: "In narrow tapes the momentum ETF lagged the S&P in 58% of 3-month windows. On your list, the market regime mattered more for breakouts than any setup detail." },
      { tone: "go", title: "Only stocks near 52-week highs", strength: "strong", cite: "high52", text: "Stocks close to their 52-week high keep outperforming. In a narrow market that is where the remaining strength lives — skip laggard 'catch-up' setups." },
      { tone: "go", title: "Concentrate in the leading groups", strength: "strong", cite: "industry", text: "A handful of groups carry narrow markets. Use the Themes / Stages group view and ignore setups outside them." },
      { tone: "caution", title: "Expect more failed breakouts", strength: "weak", text: "When most stocks sit below their trend, breakouts get less follow-through. Take partial profits sooner and respect the 3% failure line." },
    ],
    watch: ["Equal-weight and small caps start beating the S&P", "More than half your list above the 40-week line", "S&P loses its 50-day → pullback"],
  },
  correction: {
    tips: [
      { tone: "go", title: "Build the shopping list now", strength: "strong", cite: "high52", text: "The stocks that stay near their highs while the index pulls back are the likeliest next leaders. Note them; buy when the market turns." },
      { tone: "caution", title: "Wait for the index to repair before new full-size buys", strength: "weak", text: "Practitioners hold off until the S&P reclaims its 50-day with breadth improving. Pilot positions are fine." },
      { tone: "go", title: "Don't panic out of the index", strength: "own data", cite: "own", text: "Historically the S&P rose over the next 3 months in 84% of these windows (median +5.9%) — pullbacks inside an uptrend were usually pauses." },
      { tone: "caution", title: "Cut losers fast", strength: "weak", text: "Positions that break their pivot by 3%+ during a pullback rarely recover first — free the capital for the new leaders." },
    ],
    watch: ["Reclaim the 50-day with breadth improving → uptrend", "Close below the 200-day → weakening", "VIX/VIX3M above 1 → stress"],
  },
  recovery: {
    tips: [
      { tone: "caution", title: "Beware the momentum crash", strength: "strong", cite: "crash", text: "Rebounds after a decline are led by beaten-down, high-beta stocks; last cycle's momentum leaders often lag badly." },
      { tone: "go", title: "Look for new leaders", strength: "own data", cite: "own", text: "Small caps beat the S&P by a median 1.4 pts over 3 months in this type. Favour fresh Stage 2A breakouts and new themes over old leaders." },
      { tone: "go", title: "Scale in as breadth confirms", strength: "weak", text: "Start with pilot positions and add as your list's breadth turns yellow → green." },
      { tone: "go", title: "The odds favour the index", strength: "own data", cite: "own", text: "The S&P rose over the next 3 months in 86% of these windows (median +5.3%)." },
    ],
    watch: ["Breadth green and S&P above a rising 200-day → healthy", "Back under the 200-day → weakening"],
  },
  downtrend: {
    tips: [
      { tone: "stop", title: "Cut exposure", strength: "moderate", cite: "trend", text: "Below the 200-day, trend-following rules step aside; historically that avoided most of the deep drawdowns." },
      { tone: "caution", title: "Momentum loses its edge", strength: "own data", cite: "own", text: "The momentum ETF lagged the S&P in 58% of 3-month windows from this type." },
      { tone: "caution", title: "Index bounces are common — breakouts less so", strength: "own data", cite: "own", text: "The S&P often bounced (median +7% over 3 months), but with higher volatility; individual breakouts need a confirmed trend." },
    ],
    watch: ["Reclaim the 200-day → recovery", "200-day turns down → downtrend"],
  },
  bear: {
    tips: [
      { tone: "stop", title: "Cash is a position", strength: "strong", cite: "cooper", text: "After down markets, momentum profits have historically disappeared. Long breakouts are low-odds." },
      { tone: "stop", title: "Expect deep swings", strength: "own data", cite: "own", text: "Weakest type: the S&P rose over 3 months only 55% of the time and the typical worst dip was about 9%." },
      { tone: "caution", title: "Don't short the leaders into a rebound", strength: "strong", cite: "crash", text: "Sharp bear-market rallies are when shorting momentum is most dangerous." },
      { tone: "go", title: "Watch for leadership, not for the bottom", strength: "weak", text: "Note which stocks hold near their highs while the index makes new lows; they lead the next advance." },
    ],
    watch: ["S&P back above the 200-day → recovery", "Breadth (your list) improving for several weeks"],
  },
  panic: {
    tips: [
      { tone: "stop", title: "Size by volatility", strength: "moderate", cite: "volman", text: "With volatility 2–3× normal, the same position carries 2–3× the risk. Use the sizing card below." },
      { tone: "caution", title: "Momentum-crash territory", strength: "strong", cite: "crash", text: "The violent rebounds out of panics are led by the most beaten-down stocks; momentum strategies have suffered their worst losses here." },
      { tone: "go", title: "Fear has tended to pay later", strength: "moderate", cite: "vrp", text: "High implied volatility has predicted above-average index returns over the following months — the S&P rose in 75% of 3-month windows here (median +7.9%) — but with ~8% dips along the way." },
      { tone: "caution", title: "Wait for the curve to normalise", strength: "weak", text: "Before new breakouts, let VIX/VIX3M drop back below 1 and VIX ease." },
    ],
    watch: ["VIX/VIX3M back under 1 and VIX falling", "S&P reclaims its 50-day"],
  },
};

/** Exposure that keeps risk roughly constant: target 15% annualised volatility, 25–100%. */
export function volTargetExposure(rv20: number | null) {
  if (rv20 === null || !Number.isFinite(rv20) || rv20 <= 0) return null;
  return Math.round(Math.max(0.25, Math.min(1, 15 / rv20)) * 100);
}

// FOMC decision days (second day of each meeting), federalreserve.gov schedule.
export const FOMC_DAYS = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];
export function nextFomc(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const d = FOMC_DAYS.find((x) => x >= today);
  if (!d) return null;
  const days = Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  return { date: d, days };
}

export interface FearGreed {
  score: number; rating: string; prevClose: number | null; prevWeek: number | null; prevMonth: number | null; prevYear: number | null;
  timestamp: string; history: { x: number; y: number }[];
  components: { key: string; label: string; score: number; rating: string }[];
}

/** Situational tips layered on top of the type's playbook. */
export function overlays(type: MarketTypeKey, m: FlagMetrics, fng: FearGreed | null): Tip[] {
  const out: Tip[] = [];
  const b = m.breadth;
  if (b && b.regime === "red" && m.spy.dd52 > -5 && type !== "narrow")
    out.push({ tone: "caution", title: "The index hides the damage", strength: "own data", cite: "own", text: `The S&P is only ${Math.abs(m.spy.dd52).toFixed(1)}% off its high, but just ${Math.round(b.p50)}% of your stocks are above their 10-week line. Trade the breadth, not the headline.` });
  if (m.spy.ret24m !== null && m.spy.ret24m < 0 && (m.spy.rvPct ?? 0) >= 70)
    out.push({ tone: "stop", title: "Momentum-crash conditions", strength: "strong", cite: "crash", text: "The S&P is down over two years and volatility is high — the state in which momentum has crashed when markets rebound." });
  if (m.credit.oasChgBp !== null && m.credit.oasChgBp > 40)
    out.push({ tone: "stop", title: "Credit is flashing stress", strength: "moderate", cite: "credit", text: `High-yield spreads widened ${m.credit.oasChgBp} bp in a month. Credit often turns before stocks — be sceptical of equity strength.` });
  if (fng) {
    if (fng.score <= 25)
      out.push({ tone: "go", title: `Extreme fear (${Math.round(fng.score)})`, strength: "weak", cite: "sentiment", text: "Sentiment is washed out. Low sentiment has historically preceded better returns for speculative stocks, but CNN's index has no long tested record and fear can stay extreme for weeks. Use it to prepare a list, not as a buy signal on its own." });
    else if (fng.score >= 75)
      out.push({ tone: "caution", title: `Extreme greed (${Math.round(fng.score)})`, strength: "moderate", cite: "sentiment", text: "After high sentiment, speculative, volatile stocks have tended to underperform. Tighten stops on extended names and avoid chasing." });
  }
  const f = nextFomc();
  if (f && f.days <= 3)
    out.push({ tone: "caution", title: f.days === 0 ? "Fed decision today" : `Fed decision in ${f.days} day${f.days === 1 ? "" : "s"}`, strength: "moderate", cite: "fomc", text: "Announcement days move fast in both directions. The old 'buy before the Fed' drift has largely faded since 2015 — don't count on it; consider waiting for the reaction before new entries." });
  return out;
}

export const STRENGTH_STYLE: Record<Strength, string> = {
  strong: "bg-emerald-500/15 text-emerald-400",
  moderate: "bg-sky-500/15 text-sky-300",
  weak: "bg-muted text-muted-foreground",
  "own data": "bg-amber-500/15 text-amber-300",
};
