import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { latestRegime } from "../_shared/signalLog.ts";
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** ---------------------------------------------------------------
 * Market Flag v2 — market type + risk factors.
 *
 * 1. Classifies the market into one "type" (healthy uptrend, narrow
 *    uptrend, correction, recovery, downtrend, panic …) from the S&P 500
 *    trend, volatility (VIX level + VIX/VIX3M term structure) and drawdown.
 *    The app turns the type into an evidence-based playbook (client side,
 *    src/lib/marketPlaybook.ts) so tips can change without a redeploy.
 * 2. Scores 7 risk factors −2 … +2 into a weighted composite.
 *    Rates are scored in basis points (not % change of a yield), breadth
 *    comes from the app's own stock list (stock_stages flags — same gauge
 *    as the Stages tab), credit from the ICE BofA high-yield spread (FRED)
 *    with an HYG/IEF fallback.
 * Sentiment (CNN Fear & Greed) is read by the browser (CNN allows it) and
 * shown separately — it is a contrarian overlay, not part of the trend score.
 * Cached in memory for 1 hour (manual `force` bypasses).
 * --------------------------------------------------------------*/

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TTL = 60 * 60 * 1000;
let cache: { ts: number; payload: Record<string, unknown> } | null = null;

interface Bar { close: number; date: number }

async function yahooBars(symbol: string, range = "1y"): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) { await res.body?.cancel(); continue; }
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      const ts: number[] = r?.timestamp ?? [];
      const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
      const out: Bar[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c === "number" && Number.isFinite(c)) out.push({ close: c, date: ts[i] * 1000 });
      }
      return out;
    } catch { /* retry */ }
  }
  return [];
}

/** ICE BofA US High Yield option-adjusted spread (%, daily) from FRED — no key needed. */
async function fredSeries(id: string): Promise<Bar[]> {
  try {
    const start = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) { await res.body?.cancel(); return []; }
    const txt = await res.text();
    const out: Bar[] = [];
    for (const line of txt.trim().split("\n").slice(1)) {
      const [d, v] = line.split(",");
      const x = Number(v);
      if (d && Number.isFinite(x)) out.push({ date: Date.parse(d), close: x });
    }
    return out;
  } catch { return []; }
}

const smaAt = (bars: Bar[], n: number, endBack = 0): number | null => {
  const end = bars.length - endBack;
  if (end < n) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += bars[i].close;
  return s / n;
};
const pctChange = (bars: Bar[], back: number): number | null => {
  if (bars.length <= back) return null;
  const a = bars[bars.length - 1 - back].close, b = bars[bars.length - 1].close;
  return a ? ((b - a) / a) * 100 : null;
};
const diffBack = (bars: Bar[], back: number): number | null =>
  bars.length > back ? bars[bars.length - 1].close - bars[bars.length - 1 - back].close : null;
const last = (b: Bar[]) => (b.length ? b[b.length - 1].close : null);
const clamp = (n: number, a = -2, b = 2) => Math.max(a, Math.min(b, n));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Annualised realised volatility of daily log returns over the last n sessions (%). */
function realisedVol(bars: Bar[], n: number, endBack = 0): number | null {
  const end = bars.length - endBack;
  if (end <= n) return null;
  const rets: number[] = [];
  for (let i = end - n; i < end; i++) rets.push(Math.log(bars[i].close / bars[i - 1].close));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252) * 100;
}

interface Factor {
  key: string;
  label: string;
  weight: number;
  value: string;
  score: number;       // -2 .. +2
  note: string;
  tooltip: { meaning: string; market: string; trader: string };
}

type MarketTypeKey = "healthy" | "extended" | "narrow" | "correction" | "recovery" | "downtrend" | "bear" | "panic";
const TYPE_NAMES: Record<MarketTypeKey, string> = {
  healthy: "Healthy uptrend",
  extended: "Extended uptrend",
  narrow: "Narrow uptrend",
  correction: "Pullback in an uptrend",
  recovery: "Recovery attempt",
  downtrend: "Weakening — below the 200-day",
  bear: "Downtrend",
  panic: "Panic / high stress",
};

async function loadBreadth() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const rows: { symbol: string; stage: number; substage: string; confidence: number; event_kind: string | null; as_of: string; features: { flags?: string } | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("stock_stages").select("symbol, stage, substage, confidence, event_kind, as_of, features").range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...(data as typeof rows));
      if (data.length < 1000) break;
    }
    if (rows.length < 50) return null;
    const reg = latestRegime(rows);
    const asOf = rows.reduce((m, r) => (r.as_of > m ? r.as_of : m), "");
    const s2 = rows.filter((r) => r.symbol !== "SPY" && r.stage === 2).length;
    const s4 = rows.filter((r) => r.symbol !== "SPY" && r.stage === 4).length;
    const n = rows.filter((r) => r.symbol !== "SPY").length;
    return { ...reg, asOf, n, stage2Pct: r1((s2 / n) * 100), stage4Pct: r1((s4 / n) * 100) };
  } catch (e) {
    console.warn("market-flag: breadth failed", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({})) as { force?: boolean };
    if (!body.force && cache && Date.now() - cache.ts < TTL) return json({ ...cache.payload, cached: true });

    const [spy, rsp, iwm, qqq, vix, vix3m, dxy, tnx, irx, hyg, ief, oas, breadth] = await Promise.all([
      yahooBars("SPY", "2y"), yahooBars("RSP", "1y"), yahooBars("IWM", "1y"), yahooBars("QQQ", "1y"),
      yahooBars("^VIX", "1y"), yahooBars("^VIX3M", "6mo"), yahooBars("DX-Y.NYB", "6mo"),
      yahooBars("^TNX", "6mo"), yahooBars("^IRX", "6mo"), yahooBars("HYG", "6mo"), yahooBars("IEF", "6mo"),
      fredSeries("BAMLH0A0HYM2"), loadBreadth(),
    ]);
    if (spy.length < 210) return json({ error: "Could not load S&P 500 (SPY) prices from Yahoo — try again in a minute." }, 502);

    // ── S&P 500 trend ──
    const spyLast = last(spy)!;
    const ma50 = smaAt(spy, 50)!, ma200 = smaAt(spy, 200)!, ma200ago = smaAt(spy, 200, 20)!;
    const ma200Slope = (ma200 / ma200ago - 1) * 100;             // % over ~1 month
    const hi52 = Math.max(...spy.slice(-252).map((b) => b.close));
    const dd52 = (spyLast / hi52 - 1) * 100;
    let below200In60 = 0;
    for (let k = 1; k <= 60; k++) {
      const m = smaAt(spy, 200, k);
      if (m !== null && spy[spy.length - 1 - k].close < m) below200In60++;
    }
    const ret24m = spy.length > 480 ? pctChange(spy, 480) : null;    // ~2 years (Daniel–Moskowitz bear-market flag)
    const rv20 = realisedVol(spy, 20);
    // percentile of today's 20-day realised vol over the last 2 years
    const rvHist: number[] = [];
    for (let k = 0; k < Math.min(480, spy.length - 22); k += 5) { const v = realisedVol(spy, 20, k); if (v !== null) rvHist.push(v); }
    const rvPct = rv20 !== null && rvHist.length ? Math.round((rvHist.filter((x) => x < rv20).length / rvHist.length) * 100) : null;
    // consecutive closes on the current side of the 50-day (to avoid flipping on one close)
    let daysBelow50 = 0;
    for (let k = 0; k < 30; k++) { const m = smaAt(spy, 50, k); if (m !== null && spy[spy.length - 1 - k].close < m) daysBelow50++; else break; }

    // ── volatility ──
    const vixLast = last(vix), vix3mLast = last(vix3m);
    const term = vixLast !== null && vix3mLast ? vixLast / vix3mLast : null;   // > 1 = backwardation (stress)
    const vixPct = vixLast !== null && vix.length > 100 ? Math.round((vix.filter((b) => b.close < vixLast).length / vix.length) * 100) : null;

    // ── participation ──
    const rel = (a: Bar[], b: Bar[], back: number) => { const x = pctChange(a, back), y = pctChange(b, back); return x !== null && y !== null ? x - y : null; };
    const rsp3m = rel(rsp, spy, 63), iwm1m = rel(iwm, spy, 21), qqq1m = rel(qqq, spy, 21);

    // ── credit ──
    const oasLast = last(oas);
    const oasChgBp = oas.length > 22 ? (oasLast! - oas[oas.length - 23].close) * 100 : null;
    const hygIef1m = rel(hyg, ief, 21);

    // ── rates, dollar ──
    const tnxLast = last(tnx), tnxBp = diffBack(tnx, 21) === null ? null : diffBack(tnx, 21)! * 100;
    const irxLast = last(irx), irxBp = diffBack(irx, 21) === null ? null : diffBack(irx, 21)! * 100;
    const dxyLast = last(dxy), dxy1m = pctChange(dxy, 21);

    // ── market type ──
    const above200 = spyLast > ma200, above50 = spyLast > ma50;
    let type: MarketTypeKey;
    if ((vixLast !== null && vixLast >= 30) || (term !== null && term >= 1.0 && dd52 <= -8)) type = "panic";
    else if (!above200 && ma200Slope < 0) type = "bear";
    else if (!above200) type = "downtrend";
    else if (below200In60 >= 10) type = "recovery";
    // a real break of the 50-day: 1.5% under it, or 3 closes in a row below it
    else if ((!above50 && (spyLast < ma50 * 0.985 || daysBelow50 >= 3)) || dd52 <= -7) type = "correction";
    else if ((breadth && breadth.p200 < 45) || (rsp3m !== null && rsp3m < -3)) type = "narrow";
    else if ((vixLast !== null && vixLast < 13) || (spyLast / ma200 - 1) * 100 > 15) type = "extended";
    else type = "healthy";

    // ── factors ──
    const factors: Factor[] = [];
    {
      let s: number;
      if (above200 && above50 && ma200Slope > 0) s = 2;
      else if (above200 && above50) s = 1;
      else if (above200) s = -0.5;
      else if (ma200Slope > 0) s = -1;
      else s = -2;
      factors.push({
        key: "trend", label: "S&P 500 trend", weight: 2, score: s,
        value: `${(spyLast / ma50 - 1) * 100 >= 0 ? "+" : ""}${r1((spyLast / ma50 - 1) * 100)}% vs 50D · ${(spyLast / ma200 - 1) * 100 >= 0 ? "+" : ""}${r1((spyLast / ma200 - 1) * 100)}% vs 200D · ${r1(dd52)}% from high`,
        note: s >= 1 ? "Primary uptrend intact" : above200 ? (spyLast >= ma50 * 0.985 && daysBelow50 < 3 ? "Testing the 50-day — uptrend intact so far" : "Below the 50-day — pullback inside an uptrend") : ma200Slope < 0 ? "Below a falling 200-day — downtrend" : "Lost the 200-day",
        tooltip: {
          meaning: "SPY against its 50- and 200-day moving averages, and the 200-day's direction.",
          market: "Trend rules (e.g. the 10-month / 200-day filter) have historically cut drawdowns more than they added returns.",
          trader: "Breakouts work best above a rising 200-day. Below it, most long setups fail — trade smaller or not at all.",
        },
      });
    }
    if (breadth) {
      const s = breadth.regime === "green" ? 1.5 : breadth.regime === "red" ? -1.5 : 0;
      factors.push({
        key: "breadth", label: "Breadth (your list)", weight: 1.5, score: s,
        value: `${Math.round(breadth.p50)}% > 10w MA · ${Math.round(breadth.p200)}% > 40w MA · H/L ${Math.round(breadth.hl)}`,
        note: breadth.regime === "green" ? "Broad participation" : breadth.regime === "red" ? "Most of your stocks are below trend" : "Mixed participation",
        tooltip: {
          meaning: `From the last stage scan of your ${breadth.n} stocks (week of ${breadth.asOf}): share above the 10- and 40-week averages, and the High–Low index (new highs vs new lows).`,
          market: "Breadth tells you whether the typical stock — not just the index — is in an uptrend.",
          trader: "It is the same gauge as the Stages tab. Red breadth = expect failed breakouts even if the index looks fine.",
        },
      });
    }
    if (vixLast !== null) {
      let s: number;
      if (term !== null && term >= 1) s = -2;
      else if (vixLast >= 25) s = -1.5;
      else if (vixLast < 16 && (term === null || term < 0.9)) s = 1.5;
      else if (vixLast < 20 && (term === null || term < 0.95)) s = 0.5;
      else s = -0.5;
      factors.push({
        key: "vol", label: "Volatility (VIX)", weight: 1.5, score: s,
        value: `VIX ${r1(vixLast)}${term !== null ? ` · VIX/VIX3M ${r2(term)}` : ""}${vixPct !== null ? ` · ${ord(vixPct)} percentile (1y)` : ""}`,
        note: term !== null && term >= 1 ? "Inverted term structure — acute stress" : vixLast >= 25 ? "High volatility" : vixLast < 16 ? "Calm" : vixLast < 20 ? "Normal" : "Elevated",
        tooltip: {
          meaning: "VIX = expected 30-day S&P volatility. VIX/VIX3M compares it with the 3-month expectation: below 1 is normal, above 1 means traders pay up for near-term protection.",
          market: "An inverted curve marks acute stress; it usually normalises as a selloff ends. High VIX has historically been followed by above-average index returns, but with big swings first.",
          trader: "High volatility means wider ranges: smaller positions for the same dollar risk.",
        },
      });
    }
    if (oasLast !== null || hygIef1m !== null) {
      let s: number, value: string, note: string;
      if (oasLast !== null && oasChgBp !== null) {
        s = oasChgBp <= -25 ? 1.5 : oasChgBp <= 0 ? 0.5 : oasChgBp <= 40 ? -0.5 : -1.5;
        if (oasLast >= 5) s = clamp(s - 1);
        value = `HY spread ${r2(oasLast)}% (${oasChgBp >= 0 ? "+" : ""}${Math.round(oasChgBp)} bp 1M)`;
        note = oasChgBp > 40 ? "Spreads widening fast — credit stress" : oasChgBp > 0 ? "Spreads drifting wider" : "Spreads stable / tightening";
      } else {
        s = clamp(hygIef1m! / 1.5);
        value = `HYG vs IEF ${hygIef1m! >= 0 ? "+" : ""}${r1(hygIef1m!)}% (1M)`;
        note = hygIef1m! >= 0 ? "Junk bonds keeping up — credit calm" : "Junk bonds lagging Treasuries — credit stress";
      }
      factors.push({
        key: "credit", label: "Credit (high-yield)", weight: 1, score: s, value, note,
        tooltip: {
          meaning: "Extra yield investors demand on junk bonds over Treasuries (ICE BofA US High Yield spread).",
          market: "Credit spreads widen ahead of many equity drawdowns and recessions (Gilchrist & Zakrajšek 2012).",
          trader: "If the index rises while spreads widen, treat the rally with suspicion.",
        },
      });
    }
    if (tnxLast !== null) {
      const s = tnxBp === null ? 0 : clamp(-tnxBp / 20);
      factors.push({
        key: "rates", label: "Rates", weight: 0.75, score: s,
        value: `10Y ${r2(tnxLast)}% (${tnxBp !== null ? `${tnxBp >= 0 ? "+" : ""}${Math.round(tnxBp)} bp` : "—"} 1M)${irxLast !== null ? ` · 3M ${r2(irxLast)}% (${irxBp !== null ? `${irxBp >= 0 ? "+" : ""}${Math.round(irxBp)} bp` : "—"})` : ""}`,
        note: (tnxBp ?? 0) > 25 ? "Yields jumping — pressure on growth stocks" : (tnxBp ?? 0) < -25 ? "Yields falling — supportive for growth" : "Yields fairly stable",
        tooltip: {
          meaning: "10-year Treasury yield (discount rate for stocks) and 3-month bill (expected Fed path). Changes are in basis points (0.01%).",
          market: "Fast rises in yields hurt long-duration growth stocks most; the speed matters more than the level.",
          trader: "A 25+ bp jump in a month is a headwind for high-multiple momentum names.",
        },
      });
    }
    if (dxyLast !== null) {
      const s = dxy1m === null ? 0 : clamp(-dxy1m / 1.5);
      factors.push({
        key: "dxy", label: "US dollar (DXY)", weight: 0.5, score: s,
        value: `${r2(dxyLast)} (${dxy1m !== null ? `${dxy1m >= 0 ? "+" : ""}${r1(dxy1m)}%` : "—"} 1M)`,
        note: (dxy1m ?? 0) > 1.5 ? "Dollar rising fast — tighter global liquidity" : (dxy1m ?? 0) < -1.5 ? "Dollar falling — tailwind for risk assets" : "Dollar stable",
        tooltip: {
          meaning: "US dollar against major currencies.",
          market: "Sharp dollar rallies tighten global financial conditions; the link to US stocks is real but loose.",
          trader: "Low weight here: a background condition, not a timing signal.",
        },
      });
    }
    if (rsp3m !== null || iwm1m !== null) {
      const s = clamp(((rsp3m ?? 0) + (iwm1m ?? 0) / 2) / 3);
      factors.push({
        key: "participation", label: "Participation", weight: 0.75, score: s,
        value: `Equal-wt vs S&P ${rsp3m !== null ? `${rsp3m >= 0 ? "+" : ""}${r1(rsp3m)}%` : "—"} (3M) · Small caps ${iwm1m !== null ? `${iwm1m >= 0 ? "+" : ""}${r1(iwm1m)}%` : "—"} · Nasdaq ${qqq1m !== null ? `${qqq1m >= 0 ? "+" : ""}${r1(qqq1m)}%` : "—"} (1M)`,
        note: s > 0.5 ? "Broad: the average stock is keeping up" : s < -0.5 ? "Narrow: a few large caps carry the index" : "Mixed",
        tooltip: {
          meaning: "Equal-weight S&P (RSP), small caps (IWM) and the Nasdaq-100 (QQQ) against the S&P 500.",
          market: "When the equal-weight index lags badly, gains rest on a handful of mega caps — fragile for momentum traders in smaller names.",
          trader: "Small and equal-weight leading = good soil for breakouts in mid/small caps.",
        },
      });
    }

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
    const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;
    const composite = Math.round(((weighted + 2) / 4) * 100);
    let state: string, color: string;
    if (weighted >= 1) { state = "Bullish"; color = "green"; }
    else if (weighted >= 0.35) { state = "Cautious Bull"; color = "light-green"; }
    else if (weighted >= -0.35) { state = "Neutral"; color = "yellow"; }
    else if (weighted >= -1) { state = "Cautious Bear"; color = "orange"; }
    else { state = "Bearish"; color = "red"; }

    const metrics = {
      spy: { last: r2(spyLast), ma50: r2(ma50), ma200: r2(ma200), ma200Slope: r2(ma200Slope), dd52: r1(dd52), below200In60, daysBelow50,
        ret24m: ret24m === null ? null : r1(ret24m), rv20: rv20 === null ? null : r1(rv20), rvPct },
      vix: { last: vixLast === null ? null : r2(vixLast), vix3m: vix3mLast === null ? null : r2(vix3mLast), term: term === null ? null : r2(term), pct1y: vixPct },
      breadth,
      credit: { oas: oasLast === null ? null : r2(oasLast), oasChgBp: oasChgBp === null ? null : Math.round(oasChgBp), hygIef1m: hygIef1m === null ? null : r1(hygIef1m) },
      rates: { tnx: tnxLast === null ? null : r2(tnxLast), tnxBp: tnxBp === null ? null : Math.round(tnxBp), irx: irxLast === null ? null : r2(irxLast), irxBp: irxBp === null ? null : Math.round(irxBp) },
      dxy: { last: dxyLast === null ? null : r2(dxyLast), chg1m: dxy1m === null ? null : r1(dxy1m) },
      lead: { rsp3m: rsp3m === null ? null : r1(rsp3m), iwm1m: iwm1m === null ? null : r1(iwm1m), qqq1m: qqq1m === null ? null : r1(qqq1m) },
    };

    // Optional plain-language read (Groq). The playbook does not depend on it.
    let summary = "", summaryError: string | null = null;
    if (GROQ_API_KEY) {
      try {
        const prompt = `You are a cautious, evidence-minded strategist for a swing/momentum trader. In 3 short sentences: what kind of market this is, the strongest and weakest readings, and what that means for taking new breakouts. Plain words, no hype, no predictions, no markdown.

Market type: ${TYPE_NAMES[type]} · composite ${composite}/100 (${state})
${factors.map((f) => `- ${f.label}: ${f.value} (${f.note})`).join("\n")}`;
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "openai/gpt-oss-120b", reasoning_effort: "low", messages: [{ role: "user", content: prompt }], temperature: 0.2, max_tokens: 960 }),
        });
        if (res.ok) summary = ((await res.json())?.choices?.[0]?.message?.content ?? "").trim();
        else summaryError = `AI read unavailable (Groq ${res.status}: ${(await res.text()).slice(0, 120)})`;
      } catch (e) {
        summaryError = `AI read unavailable (${e instanceof Error ? e.message : String(e)})`;
      }
    } else summaryError = "AI read unavailable (GROQ_API_KEY not set)";

    const payload = {
      version: 2,
      type: { key: type, name: TYPE_NAMES[type] },
      state, color, composite, weighted: r2(weighted),
      factors, metrics, summary, summaryError,
      sources: { oas: oas.length > 0, vix3m: vix3m.length > 0, breadth: !!breadth },
      generatedAt: new Date().toISOString(), cached: false,
    };
    cache = { ts: Date.now(), payload };
    return json(payload);
  } catch (e) {
    console.error("market-flag error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
