// Minervini Fundamentals Checker — Groq Llama 3.3 70B with tool-calling
// Fetches live financial data from Yahoo Finance and grades it against
// Mark Minervini's fundamental criteria. Returns structured JSON.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Minervini/1.0";

// ── Yahoo auth (warm-container cache) ───────────────────────────────────────
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

// ── 10-min in-memory cache ──────────────────────────────────────────────────
const memCache = new Map<string, { ts: number; data: unknown }>();
const CACHE_MS = 10 * 60 * 1000;
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.data as T;
  const data = await fn();
  memCache.set(key, { ts: Date.now(), data });
  return data;
}

const num = (v: any) => (v && typeof v === "object" && "raw" in v ? v.raw : v) ?? null;

async function quoteSummary(symbol: string, modules: string[]) {
  const auth = await yahooAuth();
  if (!auth) return null;
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(",")}&crumb=${encodeURIComponent(auth.crumb)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: auth.cookie } });
  if (r.status === 401 || r.status === 403) { cachedAuth = null; return null; }
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.quoteSummary?.result?.[0] ?? null;
}

// ── Tools ───────────────────────────────────────────────────────────────────
async function toolProfile(symbol: string) {
  return cached(`p:${symbol}`, async () => {
    const r = await quoteSummary(symbol, ["assetProfile", "price"]);
    if (!r) return { error: "profile unavailable" };
    const a = r.assetProfile ?? {};
    const p = r.price ?? {};
    return {
      symbol,
      name: p.longName ?? p.shortName ?? null,
      sector: a.sector ?? null,
      industry: a.industry ?? null,
      summary: (a.longBusinessSummary ?? "").slice(0, 500),
    };
  });
}

async function toolKeyStats(symbol: string) {
  return cached(`k:${symbol}`, async () => {
    const r = await quoteSummary(symbol, ["defaultKeyStatistics", "financialData", "summaryDetail"]);
    if (!r) return { error: "stats unavailable" };
    const k = r.defaultKeyStatistics ?? {};
    const f = r.financialData ?? {};
    const s = r.summaryDetail ?? {};
    return {
      marketCap: num(s.marketCap), trailingPE: num(s.trailingPE), forwardPE: num(s.forwardPE),
      pegRatio: num(k.pegRatio), priceToBook: num(k.priceToBook),
      profitMargin: num(f.profitMargins), operatingMargin: num(f.operatingMargins),
      grossMargin: num(f.grossMargins),
      roe: num(f.returnOnEquity), roa: num(f.returnOnAssets),
      revenueGrowth: num(f.revenueGrowth), earningsGrowth: num(f.earningsGrowth),
      earningsQuarterlyGrowth: num(k.earningsQuarterlyGrowth),
      revenueQuarterlyGrowth: num(f.revenueGrowth),
      debtToEquity: num(f.debtToEquity), currentRatio: num(f.currentRatio), quickRatio: num(f.quickRatio),
      totalCash: num(f.totalCash), totalDebt: num(f.totalDebt),
      freeCashflow: num(f.freeCashflow), operatingCashflow: num(f.operatingCashflow),
      recommendation: f.recommendationKey ?? null,
      targetMeanPrice: num(f.targetMeanPrice),
      heldPercentInstitutions: num(k.heldPercentInstitutions),
      heldPercentInsiders: num(k.heldPercentInsiders),
      shortPercentOfFloat: num(k.shortPercentOfFloat),
    };
  });
}

async function toolFinancials(symbol: string) {
  return cached(`f:${symbol}`, async () => {
    const r = await quoteSummary(symbol, [
      "incomeStatementHistory", "incomeStatementHistoryQuarterly",
      "balanceSheetHistory", "cashflowStatementHistory", "earningsHistory", "earningsTrend",
    ]);
    if (!r) return { error: "financials unavailable" };
    const incA = (r.incomeStatementHistory?.incomeStatementHistory ?? []).slice(0, 4).map((x: any) => ({
      date: x.endDate?.fmt, revenue: num(x.totalRevenue), netIncome: num(x.netIncome),
      operatingIncome: num(x.operatingIncome), eps: num(x.dilutedEPS),
    }));
    const incQ = (r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []).slice(0, 6).map((x: any) => ({
      date: x.endDate?.fmt, revenue: num(x.totalRevenue), netIncome: num(x.netIncome),
      operatingIncome: num(x.operatingIncome), eps: num(x.dilutedEPS),
    }));
    const cf = (r.cashflowStatementHistory?.cashflowStatements ?? []).slice(0, 3).map((x: any) => ({
      date: x.endDate?.fmt,
      operatingCashflow: num(x.totalCashFromOperatingActivities),
      capex: num(x.capitalExpenditures),
    }));
    const bs = (r.balanceSheetHistory?.balanceSheetStatements ?? []).slice(0, 2).map((x: any) => ({
      date: x.endDate?.fmt, totalAssets: num(x.totalAssets), totalLiab: num(x.totalLiab),
      cash: num(x.cash),
      totalDebt: (num(x.shortLongTermDebt) ?? 0) + (num(x.longTermDebt) ?? 0),
    }));
    const earnHist = (r.earningsHistory?.history ?? []).slice(-8).map((x: any) => ({
      quarter: x.quarter?.fmt, epsActual: num(x.epsActual), epsEstimate: num(x.epsEstimate),
      surprisePct: num(x.surprisePercent),
    }));
    return { incomeAnnual: incA, incomeQuarterly: incQ, balanceSheet: bs, cashflow: cf, earningsHistory: earnHist };
  });
}

const TOOLS = [
  { type: "function", function: { name: "get_company_profile", description: "Company name, sector, industry, summary.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_key_stats", description: "Valuation, margins, ROE/ROA, growth, debt, ownership.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_financials", description: "Annual + quarterly income statements, balance sheet, cashflow, earnings surprise history.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
];

async function dispatch(name: string, args: any) {
  const sym = String(args?.symbol ?? "").toUpperCase();
  if (!sym) return { error: "symbol required" };
  switch (name) {
    case "get_company_profile": return await toolProfile(sym);
    case "get_key_stats": return await toolKeyStats(sym);
    case "get_financials": return await toolFinancials(sym);
    default: return { error: `unknown tool ${name}` };
  }
}

const SYSTEM = (symbol: string) => `You are an institutional equity analyst applying Mark Minervini's SEPA fundamental criteria to ${symbol}.

You MUST call ALL three tools in parallel on the first turn: get_company_profile, get_key_stats, get_financials. Do not skip any.

After receiving tool data, return ONLY a JSON object (no prose, no code fences) matching this exact schema:

{
  "symbol": string,
  "companyName": string,
  "sector": string | null,
  "overallScore": number,           // 0–100
  "verdict": "PASS" | "FAIL" | "BORDERLINE",
  "headline": string,                // one-line summary, ≤120 chars
  "criteria": [
    {
      "name": string,                // e.g. "Quarterly EPS Growth"
      "value": string,               // actual measured value, e.g. "+34% YoY"
      "target": string,              // Minervini's threshold, e.g. "≥25%"
      "status": "pass" | "fail" | "neutral",
      "comment": string              // 1 short sentence
    }
  ],
  "bullCase": [string],              // 3–5 bullets, specific numbers
  "bearCase": [string],              // 3–5 bullets, specific risks
  "finalVerdict": string             // 2–3 sentences, honest, balanced
}

Required criteria entries (in this exact order):
1. "Quarterly EPS Growth" — target ≥25% YoY
2. "Annual EPS Growth" — target strong and accelerating
3. "Quarterly Sales Growth" — target ≥20–25% YoY, accelerating preferred
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
- Be HONEST and BALANCED. Do not hype. Flag weaknesses clearly.
- Cite actual numbers from tool data. If data missing, say "N/A" and mark status "neutral".
- overallScore: weight quarterly EPS+sales growth heavily, then ROE/margins, then debt/cashflow.
- 80–100 = strong PASS, 60–79 = BORDERLINE, <60 = FAIL.
- Output ONLY the JSON object. No markdown, no commentary outside it.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
    const body = await req.json() as { symbol: string };
    const symbol = (body.symbol || "").toUpperCase().trim();
    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages: any[] = [
      { role: "system", content: SYSTEM(symbol) },
      { role: "user", content: `Run a full Minervini fundamentals analysis on ${symbol}. Call all three tools first, then return the JSON report.` },
    ];

    for (let round = 0; round < 3; round++) {
      const isFinal = round > 0;
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          messages,
          tools: isFinal ? undefined : TOOLS,
          tool_choice: isFinal ? undefined : "auto",
          response_format: isFinal ? { type: "json_object" } : undefined,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `groq ${res.status}: ${t.slice(0, 400)}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const j = await res.json();
      const msg = j?.choices?.[0]?.message;
      if (!msg) throw new Error("no message from groq");
      messages.push(msg);

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        let report: any = null;
        try { report = JSON.parse(msg.content || "{}"); } catch {
          return new Response(JSON.stringify({ error: "model returned invalid JSON", raw: msg.content }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ report }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = await Promise.all(calls.map(async (c: any) => {
        let args: any = {};
        try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
        if (!args.symbol) args.symbol = symbol;
        const data = await dispatch(c.function.name, args);
        return { tool_call_id: c.id, name: c.function.name, content: JSON.stringify(data).slice(0, 12000) };
      }));
      for (const r of results) {
        messages.push({ role: "tool", tool_call_id: r.tool_call_id, name: r.name, content: r.content });
      }
    }

    return new Response(JSON.stringify({ error: "analysis timed out" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
