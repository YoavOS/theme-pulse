import { corsHeaders } from "../_shared/cors.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

/** ---------------------------------------------------------------
 * Market Flag / Bias indicator.
 * Scores 9 macro + internal factors from -2 (bearish) to +2 (bullish),
 * applies contrarian logic (extreme complacency = risk), and returns a
 * combined market state, trader stance and a short Groq summary.
 * Everything is cached in memory for 6h (manual `force` bypasses).
 * --------------------------------------------------------------*/

// Build marker (Claude deploy test): returned as the X-TP-Build response header.
const TTL = 6 * 60 * 60 * 1000;
let cache: { ts: number; payload: unknown } | null = null;

interface Bar { close: number; date: number }

async function yahooBars(symbol: string, range = "1y"): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
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
  } catch { return []; }
}

const sma = (bars: Bar[], n: number): number | null => {
  if (bars.length < n) return null;
  const slice = bars.slice(-n);
  return slice.reduce((s, b) => s + b.close, 0) / n;
};
const pctChange = (bars: Bar[], back: number): number | null => {
  if (bars.length <= back) return null;
  const a = bars[bars.length - 1 - back].close;
  const b = bars[bars.length - 1].close;
  if (!a) return null;
  return ((b - a) / a) * 100;
};

// Representative breadth samples (kept small on purpose — cloud efficiency).
const SPY_SAMPLE = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","BRK-B","LLY","AVGO","JPM","XOM","UNH","V","PG","JNJ","HD","MA","COST","MRK","ABBV","WMT","CVX","KO","PEP","BAC"];
const QQQ_SAMPLE = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","AVGO","TSLA","COST","NFLX","AMD","PEP","ADBE","CSCO","QCOM","TMUS","INTU","AMAT","TXN","ISRG"];

async function breadthAbove50(symbols: string[]): Promise<number | null> {
  let above = 0, counted = 0;
  const CONC = 6;
  for (let i = 0; i < symbols.length; i += CONC) {
    const chunk = symbols.slice(i, i + CONC);
    const res = await Promise.all(chunk.map((s) => yahooBars(s, "6mo")));
    for (const bars of res) {
      const ma = sma(bars, 50);
      if (ma === null || bars.length === 0) continue;
      counted++;
      if (bars[bars.length - 1].close > ma) above++;
    }
  }
  if (counted === 0) return null;
  return (above / counted) * 100;
}

interface Factor {
  key: string;
  label: string;
  weight: number;      // 1 = medium, 1.5 = high
  value: string;
  score: number;       // -2 .. +2
  note: string;
  tooltip: { meaning: string; market: string; trader: string };
}

const clampScore = (n: number) => Math.max(-2, Math.min(2, n));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "X-TP-Build": "claude-test-1" } });

  try {
    const body = await req.json().catch(() => ({})) as { force?: boolean };
    if (!body.force && cache && Date.now() - cache.ts < TTL) {
      return json({ ...(cache.payload as Record<string, unknown>), cached: true });
    }

    const [vix, dxy, spy, qqq, tnx, irx, hyg, lqd] = await Promise.all([
      yahooBars("^VIX", "6mo"),
      yahooBars("DX-Y.NYB", "6mo"),
      yahooBars("SPY", "1y"),
      yahooBars("QQQ", "1y"),
      yahooBars("^TNX", "6mo"),
      yahooBars("^IRX", "6mo"),
      yahooBars("HYG", "6mo"),
      yahooBars("LQD", "6mo"),
    ]);
    const [spyBreadth, qqqBreadth] = await Promise.all([
      breadthAbove50(SPY_SAMPLE),
      breadthAbove50(QQQ_SAMPLE),
    ]);

    const factors: Factor[] = [];
    const last = (b: Bar[]) => (b.length ? b[b.length - 1].close : null);

    // 1. VIX (high weight, contrarian at extremes)
    const vixLast = last(vix);
    if (vixLast !== null) {
      let score = 0, note = "";
      if (vixLast < 13) { score = -1; note = "Extreme complacency — greed phase, reversal risk"; }
      else if (vixLast < 16) { score = 1; note = "Calm tape, trend-friendly"; }
      else if (vixLast < 20) { score = 0.5; note = "Normal volatility"; }
      else if (vixLast < 28) { score = -1; note = "Elevated fear — reduce size"; }
      else { score = 1; note = "Panic levels — contrarian bullish for swing lows"; }
      factors.push({
        key: "vix", label: "VIX", weight: 1.5, value: vixLast.toFixed(2), score, note,
        tooltip: {
          meaning: "30-day implied volatility of S&P 500 options — the market's 'fear gauge'.",
          market: "Low VIX = complacency and steady trend; high VIX = stress, wide ranges, liquidity gaps.",
          trader: "Sub-13 means crowded greed — tighten stops. Above 28 is panic and often marks swing lows.",
        },
      });
    }

    // 2. DXY (high weight, inverse to risk assets)
    const dxyLast = last(dxy);
    const dxy1m = pctChange(dxy, 21);
    if (dxyLast !== null) {
      const score = dxy1m === null ? 0 : clampScore(-dxy1m / 1.5);
      factors.push({
        key: "dxy", label: "US Dollar (DXY)", weight: 1.5, value: `${dxyLast.toFixed(2)} (${dxy1m?.toFixed(1) ?? "—"}% 1M)`,
        score,
        note: (dxy1m ?? 0) > 1 ? "Dollar strength drains risk appetite" : (dxy1m ?? 0) < -1 ? "Dollar weakness supports risk assets" : "Dollar stable",
        tooltip: {
          meaning: "Value of USD vs a basket of major currencies.",
          market: "A rising dollar tightens global liquidity and pressures equities and commodities.",
          trader: "Falling DXY is a tailwind for high-beta and small caps; sharp spikes precede risk-off.",
        },
      });
    }

    // 3. Rate expectations (3M bill yield trend as FOMC proxy)
    const irxLast = last(irx);
    const irx1m = pctChange(irx, 21);
    if (irxLast !== null) {
      const score = irx1m === null ? 0 : clampScore(-irx1m / 4);
      factors.push({
        key: "rates", label: "Rate Expectations (3M)", weight: 1.5,
        value: `${(irxLast).toFixed(2)}% (${irx1m?.toFixed(1) ?? "—"}% 1M)`,
        score,
        note: (irx1m ?? 0) < -2 ? "Front-end easing — cuts being priced in" : (irx1m ?? 0) > 2 ? "Front-end repricing higher — hawkish drift" : "Policy expectations stable",
        tooltip: {
          meaning: "3-month T-bill yield tracks what the market expects the Fed to do next.",
          market: "Falling front-end yields = cuts priced in (liquidity positive); rising = hawkish repricing.",
          trader: "Hawkish repricing hits long-duration growth names first; easing fuels speculative leadership.",
        },
      });
    }

    // 4. SPY trend (high weight)
    const spyLast = last(spy);
    const spy50 = sma(spy, 50);
    const spy200 = sma(spy, 200);
    if (spyLast !== null && spy50 !== null) {
      let score = 0;
      if (spyLast > spy50 && (spy200 === null || spyLast > spy200)) score = 2;
      else if (spyLast > spy50) score = 1;
      else if (spy200 !== null && spyLast > spy200) score = -0.5;
      else score = -2;
      factors.push({
        key: "spy", label: "SPY Trend", weight: 1.5,
        value: `${spyLast.toFixed(2)} · ${spyLast > spy50 ? "above" : "below"} 50D${spy200 !== null ? `, ${spyLast > spy200 ? "above" : "below"} 200D` : ""}`,
        score,
        note: score >= 1 ? "Primary uptrend intact" : score <= -1 ? "Broken trend — defensive" : "Mixed / chop",
        tooltip: {
          meaning: "Position of the S&P 500 ETF versus its 50- and 200-day moving averages.",
          market: "Above both MAs is a confirmed uptrend; below both is a distribution regime.",
          trader: "Only press breakouts above the 50D. Below the 200D, cut exposure and trade smaller.",
        },
      });
    }

    // 5. QQQ vs SPY (medium)
    const qqq1m = pctChange(qqq, 21);
    const spy1m = pctChange(spy, 21);
    if (qqq1m !== null && spy1m !== null) {
      const rel = qqq1m - spy1m;
      factors.push({
        key: "qqq_spy", label: "QQQ vs SPY", weight: 1,
        value: `${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% (1M)`,
        score: clampScore(rel / 1.5),
        note: rel > 0 ? "Tech leadership — risk-on internals" : "Defensive rotation out of tech",
        tooltip: {
          meaning: "Relative 1-month performance of the Nasdaq-100 versus the S&P 500.",
          market: "Tech leading signals risk appetite; lagging signals rotation into defensives.",
          trader: "Growth setups work best when QQQ leads. When it lags, favour value/energy or stand aside.",
        },
      });
    }

    // 6. Breadth (medium)
    const breadth = spyBreadth !== null && qqqBreadth !== null ? (spyBreadth + qqqBreadth) / 2 : (spyBreadth ?? qqqBreadth);
    if (breadth !== null) {
      let score = 0;
      if (breadth >= 80) score = 1;        // strong but slightly extended
      else if (breadth >= 60) score = 2;
      else if (breadth >= 45) score = 0;
      else if (breadth >= 30) score = -1;
      else score = -1.5;                    // washed out, contrarian floor
      factors.push({
        key: "breadth", label: "Breadth (% > 50D MA)", weight: 1,
        value: `SPY ${spyBreadth?.toFixed(0) ?? "—"}% · QQQ ${qqqBreadth?.toFixed(0) ?? "—"}%`,
        score,
        note: breadth >= 80 ? "Very broad — strong but extended" : breadth >= 60 ? "Healthy participation" : breadth >= 45 ? "Narrowing leadership" : "Weak internals",
        tooltip: {
          meaning: "Share of index members trading above their 50-day moving average.",
          market: "Broad participation confirms rallies; narrow breadth warns of a hollow index move.",
          trader: "Above 60% you can hold winners longer. Below 40%, expect failed breakouts.",
        },
      });
    }

    // 7. Fear & Greed proxy (medium, contrarian)
    let fgScore: number | null = null;
    if (vixLast !== null && breadth !== null && spy1m !== null) {
      // 0 = extreme fear, 100 = extreme greed
      const vixComp = Math.max(0, Math.min(100, 100 - (vixLast - 10) * 4));
      const momComp = Math.max(0, Math.min(100, 50 + spy1m * 8));
      fgScore = Math.round(vixComp * 0.4 + breadth * 0.3 + momComp * 0.3);
      let score = 0;
      if (fgScore >= 85) score = -1.5;
      else if (fgScore >= 65) score = 1;
      else if (fgScore >= 45) score = 0.5;
      else if (fgScore >= 25) score = -0.5;
      else score = 1.5;
      factors.push({
        key: "fear_greed", label: "Fear & Greed (proxy)", weight: 1,
        value: `${fgScore}/100`,
        score,
        note: fgScore >= 85 ? "Extreme greed — contrarian caution" : fgScore <= 25 ? "Extreme fear — contrarian opportunity" : "Balanced sentiment",
        tooltip: {
          meaning: "Composite of volatility, breadth and momentum on a 0–100 sentiment scale.",
          market: "Extremes mark exhaustion points rather than trend confirmations.",
          trader: "Buy fear, fade greed — above 85 take profits, below 25 start scaling into leaders.",
        },
      });
    }

    // 8. 10-year yield (medium)
    const tnxLast = last(tnx);
    const tnx1m = pctChange(tnx, 21);
    if (tnxLast !== null) {
      const score = tnx1m === null ? 0 : clampScore(-tnx1m / 5);
      factors.push({
        key: "tnx", label: "10Y Treasury Yield", weight: 1,
        value: `${tnxLast.toFixed(2)}% (${tnx1m?.toFixed(1) ?? "—"}% 1M)`,
        score,
        note: (tnx1m ?? 0) > 5 ? "Yields spiking — multiple compression risk" : (tnx1m ?? 0) < -5 ? "Yields falling — supportive for growth" : "Yields stable",
        tooltip: {
          meaning: "Benchmark long-term US borrowing cost and discount rate for equities.",
          market: "Fast-rising yields compress valuations, especially for long-duration growth.",
          trader: "Watch the rate of change, not the level — spikes break momentum names first.",
        },
      });
    }

    // 9. High-yield credit spreads (HYG vs LQD relative performance proxy)
    const hyg1m = pctChange(hyg, 21);
    const lqd1m = pctChange(lqd, 21);
    if (hyg1m !== null && lqd1m !== null) {
      const rel = hyg1m - lqd1m;
      factors.push({
        key: "credit", label: "High-Yield Credit Spreads", weight: 1,
        value: `HY vs IG ${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% (1M)`,
        score: clampScore(rel / 1.2),
        note: rel >= 0 ? "Credit confirming risk-on" : "Credit stress — spreads widening",
        tooltip: {
          meaning: "Junk bonds (HYG) versus investment grade (LQD) — a live read on credit risk appetite.",
          market: "Widening spreads (HY underperforming) usually lead equity drawdowns.",
          trader: "If credit diverges from a rising index, treat equity strength as suspect.",
        },
      });
    }

    // ---- combine ----
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
    const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight; // -2..+2
    const composite = Math.round(((weighted + 2) / 4) * 100); // 0..100

    let state: string, color: string, stance: string;
    if (weighted >= 1) { state = "Bullish"; color = "green"; stance = "Press winners, full position sizing on clean breakouts."; }
    else if (weighted >= 0.35) { state = "Cautious Bull"; color = "light-green"; stance = "Stay long leaders but tighten stops and avoid chasing extended names."; }
    else if (weighted >= -0.35) { state = "Neutral"; color = "yellow"; stance = "Reduce size, trade only A+ setups, keep cash meaningful."; }
    else if (weighted >= -1) { state = "Cautious Bear"; color = "orange"; stance = "Defensive — take profits fast, no new full-size swing entries."; }
    else { state = "Bearish"; color = "red"; stance = "Capital preservation. Cash is a position; wait for a breadth thrust."; }

    // Contrarian overlays on the stance line
    const vixFactor = factors.find((f) => f.key === "vix");
    if (vixLast !== null && vixLast < 13 && weighted > 0) stance = `${stance} Low VIX suggests a greed phase — watch for reversal.`;
    if (fgScore !== null && fgScore <= 25 && weighted < 0) stance = `${stance} Extreme fear can mark a durable low — build a shopping list.`;
    void vixFactor;

    let summary = "";
    if (GROQ_API_KEY) {
      try {
        const prompt = `You are a professional swing trader's market strategist. Given these factor readings, write 3-4 short sentences: overall picture, the strongest supporting factor, the biggest risk, and one actionable stance. No preamble, no markdown headers.

Market state: ${state} (composite ${composite}/100)
Factors:
${factors.map((f) => `- ${f.label}: ${f.value} → score ${f.score} (${f.note})`).join("\n")}`;
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 320,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          summary = j?.choices?.[0]?.message?.content?.trim() ?? "";
        }
      } catch (e) {
        console.warn("market-flag: groq summary failed", e);
      }
    }

    const payload = {
      state, color, stance, composite, weighted: Number(weighted.toFixed(2)),
      summary, factors, generatedAt: new Date().toISOString(), cached: false,
    };
    cache = { ts: Date.now(), payload };
    return json(payload);
  } catch (e) {
    console.error("market-flag error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
