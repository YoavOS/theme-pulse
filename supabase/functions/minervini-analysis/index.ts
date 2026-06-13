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

  const bundle = {
    symbol,
    profile: {
      name: p.longName ?? p.shortName ?? null,
      sector: a.sector ?? null,
      industry: a.industry ?? null,
      summary: (a.longBusinessSummary ?? "").slice(0, 400),
    },
    stats: {
      marketCap: num(s.marketCap), trailingPE: num(s.trailingPE), forwardPE: num(s.forwardPE),
      pegRatio: num(k.pegRatio), priceToBook: num(k.priceToBook),
      profitMargin: num(f.profitMargins), operatingMargin: num(f.operatingMargins),
      grossMargin: num(f.grossMargins),
      roe: num(f.returnOnEquity), roa: num(f.returnOnAssets),
      revenueGrowth: num(f.revenueGrowth), earningsGrowth: num(f.earningsGrowth),
      earningsQuarterlyGrowth: num(k.earningsQuarterlyGrowth),
      debtToEquity: num(f.debtToEquity), currentRatio: num(f.currentRatio),
      totalCash: num(f.totalCash), totalDebt: num(f.totalDebt),
      freeCashflow: num(f.freeCashflow), operatingCashflow: num(f.operatingCashflow),
      heldPercentInstitutions: num(k.heldPercentInstitutions),
      heldPercentInsiders: num(k.heldPercentInsiders),
      shortPercentOfFloat: num(k.shortPercentOfFloat),
      targetMeanPrice: num(f.targetMeanPrice),
      recommendation: f.recommendationKey ?? null,
    },
    incomeAnnual: (root.incomeStatementHistory?.incomeStatementHistory ?? []).slice(0, 4).map((x: any) => ({
      date: x.endDate?.fmt, revenue: num(x.totalRevenue), netIncome: num(x.netIncome),
      operatingIncome: num(x.operatingIncome), eps: num(x.dilutedEPS),
    })),
    incomeQuarterly: (root.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []).slice(0, 6).map((x: any) => ({
      date: x.endDate?.fmt, revenue: num(x.totalRevenue), netIncome: num(x.netIncome),
      operatingIncome: num(x.operatingIncome), eps: num(x.dilutedEPS),
    })),
    cashflow: (root.cashflowStatementHistory?.cashflowStatements ?? []).slice(0, 3).map((x: any) => ({
      date: x.endDate?.fmt, operatingCashflow: num(x.totalCashFromOperatingActivities),
      capex: num(x.capitalExpenditures),
    })),
    balanceSheet: (root.balanceSheetHistory?.balanceSheetStatements ?? []).slice(0, 2).map((x: any) => ({
      date: x.endDate?.fmt, totalAssets: num(x.totalAssets), totalLiab: num(x.totalLiab),
      cash: num(x.cash), totalDebt: (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0),
    })),
    earningsHistory: (root.earningsHistory?.history ?? []).slice(-8).map((x: any) => ({
      quarter: x.quarter?.fmt, epsActual: num(x.epsActual), epsEstimate: num(x.epsEstimate),
      surprisePct: num(x.surprisePercent),
    })),
  };
  dataCache.set(symbol, { ts: Date.now(), data: bundle });
  return bundle;
}

const SYSTEM = `You are an institutional equity analyst applying Mark Minervini's SEPA fundamental criteria. You will receive a JSON bundle of pre-fetched financial data. Return ONLY a JSON object (no prose, no code fences) matching this exact schema:

{
  "symbol": string,
  "companyName": string,
  "sector": string | null,
  "overallScore": number,
  "verdict": "PASS" | "FAIL" | "BORDERLINE",
  "headline": string,
  "criteria": [{ "name": string, "value": string, "target": string, "status": "pass"|"fail"|"neutral", "comment": string }],
  "bullCase": [string],
  "bearCase": [string],
  "finalVerdict": string
}

Required criteria entries IN THIS ORDER:
1. "Quarterly EPS Growth" — target ≥25% YoY
2. "Annual EPS Growth" — target strong and accelerating
3. "Quarterly Sales Growth" — target ≥20–25% YoY
4. "Annual Sales Growth" — target consistent multi-year growth
5. "Return on Equity (ROE)" — target ≥17%
6. "Profit Margins" — target net margin expanding
7. "Operating Margin Trend" — target expanding
8. "Debt / Equity" — target low or declining
9. "Operating Cash Flow" — target positive and growing
10. "Institutional Sponsorship" — target healthy institutional ownership
11. "Earnings Surprises / Stability" — target consistent beats
12. "Overall Fundamental Quality" — synthesis

Rules:
- Be HONEST and BALANCED. Cite actual numbers from the bundle. If data missing, use "N/A" and status "neutral".
- overallScore: weight quarterly EPS + sales growth heavily, then ROE/margins, then debt/cashflow.
- 80–100 = PASS, 60–79 = BORDERLINE, <60 = FAIL.
- Output ONLY the JSON object.`;

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
