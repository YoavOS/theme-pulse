// Minervini Fundamentals Checker — single-shot, ultra-cached.
// 1 Yahoo call (combined modules) + 1 Groq call. 24h in-memory cache.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Minervini/2.0";

// ── Yahoo auth (warm-container cache, 30 min) ───────────────────────────────
let cachedAuth: { cookie: string; crumb: string; ts: number } | null = null;
const AUTH_TTL = 30 * 60 * 1000;
async function yahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedAuth && Date.now() - cachedAuth.ts < AUTH_TTL) {
    return { cookie: cachedAuth.cookie, crumb: cachedAuth.crumb };
  }
  try {
    const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    const sc = r.headers.get("set-cookie") ?? "";
    const a3 = sc.match(/A3=([^;]+)/);
    if (!a3) return null;
    const cookie = `A3=${a3[1]}`;
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    if (!cr.ok) return null;
    const crumb = (await cr.text()).trim();
    if (!crumb) return null;
    cachedAuth = { cookie, crumb, ts: Date.now() };
    return { cookie, crumb };
  } catch { return null; }
}

// ── Long warm-container caches (24h) ────────────────────────────────────────
const REPORT_TTL = 24 * 60 * 60 * 1000;
const reportCache = new Map<string, { ts: number; report: unknown }>();
const dataCache = new Map<string, { ts: number; data: unknown }>();

const num = (v: any) => (v && typeof v === "object" && "raw" in v ? v.raw : v) ?? null;

// One Yahoo call with ALL modules needed for Minervini
async function fetchYahooBundle(symbol: string) {
  const hit = dataCache.get(symbol);
  if (hit && Date.now() - hit.ts < REPORT_TTL) return hit.data as any;

  const auth = await yahooAuth();
  if (!auth) return { error: "yahoo auth failed" };

  const modules = [
    "assetProfile", "price",
    "defaultKeyStatistics", "financialData", "summaryDetail",
    "incomeStatementHistory", "incomeStatementHistoryQuarterly",
    "balanceSheetHistory", "cashflowStatementHistory",
    "earningsHistory", "earningsTrend",
  ].join(",");
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: auth.cookie } });
  if (r.status === 401 || r.status === 403) { cachedAuth = null; return { error: "yahoo auth expired" }; }
  if (!r.ok) return { error: `yahoo http ${r.status}` };
  const j = await r.json().catch(() => null);
  const root = j?.quoteSummary?.result?.[0];
  if (!root) return { error: "no data" };

  const a = root.assetProfile ?? {};
  const p = root.price ?? {};
  const k = root.defaultKeyStatistics ?? {};
  const f = root.financialData ?? {};
  const s = root.summaryDetail ?? {};

  // Helpers
  const pct = (v: any) => (v == null || isNaN(v)) ? null : +(v * 100).toFixed(2);
  const yoy = (cur: any, prev: any) =>
    (cur == null || prev == null || prev === 0) ? null : +(((cur - prev) / Math.abs(prev)) * 100).toFixed(2);

  const incQ = (root.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []).map((x: any) => ({
    date: x.endDate?.fmt,
    revenue: num(x.totalRevenue),
    netIncome: num(x.netIncome),
    operatingIncome: num(x.operatingIncome),
    eps: num(x.dilutedEPS),
  }));
  const incA = (root.incomeStatementHistory?.incomeStatementHistory ?? []).map((x: any) => ({
    date: x.endDate?.fmt,
    revenue: num(x.totalRevenue),
    netIncome: num(x.netIncome),
    operatingIncome: num(x.operatingIncome),
    eps: num(x.dilutedEPS),
  }));
  const cf = (root.cashflowStatementHistory?.cashflowStatements ?? []).map((x: any) => ({
    date: x.endDate?.fmt,
    operatingCashflow: num(x.totalCashFromOperatingActivities),
    capex: num(x.capitalExpenditures),
  }));
  const bs = (root.balanceSheetHistory?.balanceSheetStatements ?? []).map((x: any) => ({
    date: x.endDate?.fmt,
    totalAssets: num(x.totalAssets),
    totalLiab: num(x.totalLiab),
    cash: num(x.cash),
    shortDebt: num(x.shortLongTermDebt),
    longDebt: num(x.longTermDebt),
    equity: num(x.totalStockholderEquity),
  }));
  const eh = (root.earningsHistory?.history ?? []).map((x: any) => ({
    quarter: x.quarter?.fmt,
    epsActual: num(x.epsActual),
    epsEstimate: num(x.epsEstimate),
    surprisePct: num(x.surprisePercent),
  }));

  // ── Pre-computed derived metrics (authoritative — LLM must use these) ──
  const q0 = incQ[0], q4 = incQ[4];
  const quarterlySalesYoY = (q0 && q4) ? yoy(q0.revenue, q4.revenue) : null;
  const quarterlyEpsYoY = (q0 && q4) ? yoy(q0.eps, q4.eps) :
    (num(k.earningsQuarterlyGrowth) != null ? pct(num(k.earningsQuarterlyGrowth)) : null);

  const annualSalesGrowth: number[] = [];
  const annualEpsGrowth: number[] = [];
  for (let i = 0; i + 1 < incA.length && i < 3; i++) {
    const sg = yoy(incA[i].revenue, incA[i + 1].revenue);
    const eg = yoy(incA[i].eps, incA[i + 1].eps);
    if (sg != null) annualSalesGrowth.push(sg);
    if (eg != null) annualEpsGrowth.push(eg);
  }

  const qNetMargin = (q0 && q0.revenue) ? +((q0.netIncome / q0.revenue) * 100).toFixed(2) : null;
  const qOpMargin = (q0 && q0.revenue && q0.operatingIncome != null)
    ? +((q0.operatingIncome / q0.revenue) * 100).toFixed(2) : null;
  const ttmNetMargin = pct(num(f.profitMargins));
  const ttmOpMargin = pct(num(f.operatingMargins));
  const ttmGrossMargin = pct(num(f.grossMargins));

  // Debt/Equity — Yahoo's financialData.debtToEquity is in PERCENT (90.28 = 0.90x)
  const rawDE = num(f.debtToEquity);
  let debtToEquityRatio = rawDE != null ? +(rawDE / 100).toFixed(2) : null;
  const bs0 = bs[0];
  if ((debtToEquityRatio == null || debtToEquityRatio > 50) && bs0 && bs0.equity) {
    const totalDebtBS = (bs0.shortDebt ?? 0) + (bs0.longDebt ?? 0);
    if (totalDebtBS > 0) debtToEquityRatio = +(totalDebtBS / bs0.equity).toFixed(2);
  }

  const roePct = pct(num(f.returnOnEquity));

  // Institutional ownership — Yahoo returns FRACTION (0.90 = 90%)
  const rawInst = num(k.heldPercentInstitutions);
  const instOwnPct = rawInst != null ? +(rawInst * 100).toFixed(2) : null;
  const insiderRaw = num(k.heldPercentInsiders);
  const insiderOwnPct = insiderRaw != null ? +(insiderRaw * 100).toFixed(2) : null;

  const ocfTrend = cf.slice(0, 3).map((c: any) => c.operatingCashflow);
  const ocfPositive = ocfTrend.length > 0 && ocfTrend.every((v: any) => v != null && v > 0);

  const beats = eh.filter((e: any) => e.epsActual != null && e.epsEstimate != null && e.epsActual >= e.epsEstimate).length;
  const epsBeatRate = eh.length > 0 ? +((beats / eh.length) * 100).toFixed(0) : null;

  const bundle = {
    symbol,
    profile: {
      name: p.longName ?? p.shortName ?? null,
      sector: a.sector ?? null,
      industry: a.industry ?? null,
      summary: (a.longBusinessSummary ?? "").slice(0, 300),
    },
    derived: {
      mostRecentQuarter: q0?.date ?? null,
      yearAgoQuarter: q4?.date ?? null,
      quarterlySalesGrowthYoY_pct: quarterlySalesYoY,
      quarterlyEpsGrowthYoY_pct: quarterlyEpsYoY,
      annualSalesGrowthYoY_pct_recent3yrs: annualSalesGrowth,
      annualEpsGrowthYoY_pct_recent3yrs: annualEpsGrowth,
      quarterlyNetMargin_pct: qNetMargin,
      quarterlyOperatingMargin_pct: qOpMargin,
      ttmNetMargin_pct: ttmNetMargin,
      ttmOperatingMargin_pct: ttmOpMargin,
      ttmGrossMargin_pct: ttmGrossMargin,
      roe_pct: roePct,
      debtToEquity_ratio: debtToEquityRatio,
      operatingCashflowLast3yrs: ocfTrend,
      operatingCashflowAllPositive: ocfPositive,
      institutionalOwnership_pct: instOwnPct,
      insiderOwnership_pct: insiderOwnPct,
      epsBeatRate_pct: epsBeatRate,
      epsSurprisesRecent: eh.slice(-6).map((e: any) => e.surprisePct),
    },
    rawStats: {
      marketCap: num(s.marketCap), trailingPE: num(s.trailingPE), forwardPE: num(s.forwardPE),
      currentRatio: num(f.currentRatio), totalCash: num(f.totalCash), totalDebt: num(f.totalDebt),
      freeCashflow: num(f.freeCashflow),
    },
    incomeQuarterly: incQ.slice(0, 8),
    incomeAnnual: incA.slice(0, 4),
    cashflow: cf.slice(0, 3),
    balanceSheet: bs.slice(0, 2),
    earningsHistory: eh.slice(-8),
  };
  dataCache.set(symbol, { ts: Date.now(), data: bundle });
  return bundle;
}

const SYSTEM = `You are an institutional equity analyst applying Mark Minervini's SEPA fundamental criteria. You receive a JSON bundle with a "derived" block of PRE-COMPUTED, PRE-NORMALIZED metrics. **Always use bundle.derived values directly — they are authoritative.** Do NOT recompute from raw fields, do NOT reinterpret units.

Unit guide for bundle.derived (CRITICAL — follow exactly):
- All *_pct fields are ALREADY in percent (e.g. 9.2 means 9.2%, 18.5 means 18.5%). Do NOT multiply by 100 again.
- debtToEquity_ratio is a RATIO (e.g. 0.91 means 0.91x). Healthy <1.5x, low <0.5x.
- institutionalOwnership_pct is in percent (e.g. 92.5 means 92.5%). >70% = strong sponsorship.
- If a derived value is null, write "N/A" and use status "neutral" — do NOT fabricate or guess.

Return ONLY a JSON object (no prose, no code fences):
{
  "symbol": string, "companyName": string, "sector": string | null,
  "overallScore": number, "verdict": "PASS" | "FAIL" | "BORDERLINE",
  "headline": string,
  "criteria": [{ "name": string, "value": string, "target": string, "status": "pass"|"fail"|"neutral", "comment": string }],
  "bullCase": [string], "bearCase": [string], "finalVerdict": string
}

Required criteria IN THIS ORDER (cite the derived field used):
1. "Quarterly EPS Growth" — derived.quarterlyEpsGrowthYoY_pct — target ≥25% YoY
2. "Annual EPS Growth" — derived.annualEpsGrowthYoY_pct_recent3yrs — target accelerating
3. "Quarterly Sales Growth" — derived.quarterlySalesGrowthYoY_pct — target ≥20% YoY
4. "Annual Sales Growth" — derived.annualSalesGrowthYoY_pct_recent3yrs — target consistent
5. "Return on Equity (ROE)" — derived.roe_pct — target ≥17%
6. "Profit Margins" — derived.quarterlyNetMargin_pct or ttmNetMargin_pct — target positive & expanding
7. "Operating Margin Trend" — derived.quarterlyOperatingMargin_pct vs ttmOperatingMargin_pct — target expanding
8. "Debt / Equity" — derived.debtToEquity_ratio — target <1.5x
9. "Operating Cash Flow" — derived.operatingCashflowLast3yrs / operatingCashflowAllPositive — target positive & growing
10. "Institutional Sponsorship" — derived.institutionalOwnership_pct — target >40% (ideal >70%)
11. "Earnings Surprises / Stability" — derived.epsBeatRate_pct and epsSurprisesRecent — target consistent beats
12. "Overall Fundamental Quality" — synthesis

Format value with units, e.g. "9.2% YoY", "0.91x", "92.5%".

If quarterlyNetMargin_pct is negative but quarterlyOperatingMargin_pct is strongly positive (>10%), note in comment: "GAAP net margin distorted by non-operating/one-time items; operating margin (non-GAAP proxy) is healthy at X%" and rate status "neutral" not "fail".

Scoring: 80–100=PASS, 60–79=BORDERLINE, <60=FAIL. Weight quarterly EPS+sales heaviest. Output ONLY the JSON object.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
    const body = await req.json() as { symbol: string; force?: boolean };
    const symbol = (body.symbol || "").toUpperCase().trim();
    const force = !!body.force;
    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Warm-container report cache (24h) — zero work on hit.
    if (!force) {
      const hit = reportCache.get(symbol);
      if (hit && Date.now() - hit.ts < REPORT_TTL) {
        return new Response(JSON.stringify({ report: hit.report, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Fetch (or reuse) Yahoo bundle — single API call, 24h cached.
    const bundle = await fetchYahooBundle(symbol);
    if ((bundle as any).error) {
      return new Response(JSON.stringify({ error: `data fetch: ${(bundle as any).error}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Single Groq call with full bundle pre-loaded — no tool-calling rounds.
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Symbol: ${symbol}\n\nFinancial bundle:\n${JSON.stringify(bundle).slice(0, 14000)}\n\nReturn the Minervini JSON report.` },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `groq ${res.status}: ${t.slice(0, 300)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content ?? "";
    let report: any;
    try { report = JSON.parse(content); } catch {
      return new Response(JSON.stringify({ error: "invalid JSON from model", raw: content }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    reportCache.set(symbol, { ts: Date.now(), report });

    return new Response(JSON.stringify({ report, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
