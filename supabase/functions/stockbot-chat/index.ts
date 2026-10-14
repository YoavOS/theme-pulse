// StockBot-style chat — Groq Llama 3.3 70B with financial tool calling
// Inspired by https://github.com/bklieger-groq/stockbot-on-groq
// Tools fetch live data from Yahoo Finance (no extra DB writes).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 StockBot/1.0";

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

// ── Tiny in-memory cache (5 min) ────────────────────────────────────────────
const memCache = new Map<string, { ts: number; data: unknown }>();
const CACHE_MS = 5 * 60 * 1000;
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.data as T;
  const data = await fn();
  memCache.set(key, { ts: Date.now(), data });
  return data;
}

// ── Tool implementations ────────────────────────────────────────────────────
async function toolQuote(symbol: string) {
  return cached(`q:${symbol}`, async () => {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) return { error: `quote http ${r.status}` };
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const meta = res?.meta ?? {};
    const closes: number[] = (res?.indicators?.quote?.[0]?.close ?? []).filter((x: any) => x != null);
    const last = closes.at(-1) ?? meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? closes.at(-2) ?? null;
    const ret = (a: number | null, b: number | null) => (a != null && b != null && b !== 0) ? ((a - b) / b) * 100 : null;
    return {
      symbol, price: last, previousClose: prev, currency: meta.currency,
      changePct: ret(last, prev),
      dayHigh: meta.regularMarketDayHigh, dayLow: meta.regularMarketDayLow,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh, fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume, exchange: meta.exchangeName,
      return5d: ret(last, closes.at(-6) ?? null),
      return1m: ret(last, closes[0] ?? null),
    };
  });
}

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

const num = (v: any) => (v && typeof v === "object" && "raw" in v ? v.raw : v) ?? null;

async function toolProfile(symbol: string) {
  return cached(`p:${symbol}`, async () => {
    const r = await quoteSummary(symbol, ["assetProfile", "summaryProfile", "price"]);
    if (!r) return { error: "profile unavailable" };
    const a = r.assetProfile ?? r.summaryProfile ?? {};
    const p = r.price ?? {};
    return {
      symbol, name: p.longName ?? p.shortName ?? null,
      sector: a.sector ?? null, industry: a.industry ?? null,
      country: a.country ?? null, website: a.website ?? null,
      employees: a.fullTimeEmployees ?? null,
      summary: (a.longBusinessSummary ?? "").slice(0, 800),
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
      roe: num(f.returnOnEquity), roa: num(f.returnOnAssets),
      revenueGrowth: num(f.revenueGrowth), earningsGrowth: num(f.earningsGrowth),
      debtToEquity: num(f.debtToEquity), currentRatio: num(f.currentRatio),
      totalCash: num(f.totalCash), totalDebt: num(f.totalDebt),
      freeCashflow: num(f.freeCashflow), recommendation: f.recommendationKey ?? null,
      targetMeanPrice: num(f.targetMeanPrice), numberOfAnalystOpinions: num(f.numberOfAnalystOpinions),
      beta: num(s.beta), dividendYield: num(s.dividendYield),
    };
  });
}

async function toolFinancials(symbol: string) {
  return cached(`f:${symbol}`, async () => {
    const r = await quoteSummary(symbol, ["incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory"]);
    if (!r) return { error: "financials unavailable" };
    const inc = (r.incomeStatementHistory?.incomeStatementHistory ?? []).slice(0, 4).map((x: any) => ({
      date: x.endDate?.fmt, revenue: num(x.totalRevenue), grossProfit: num(x.grossProfit),
      operatingIncome: num(x.operatingIncome), netIncome: num(x.netIncome), eps: num(x.dilutedEPS),
    }));
    const bs = (r.balanceSheetHistory?.balanceSheetStatements ?? []).slice(0, 2).map((x: any) => ({
      date: x.endDate?.fmt, totalAssets: num(x.totalAssets), totalLiab: num(x.totalLiab),
      cash: num(x.cash), totalDebt: num(x.shortLongTermDebt) + num(x.longTermDebt),
    }));
    const cf = (r.cashflowStatementHistory?.cashflowStatements ?? []).slice(0, 2).map((x: any) => ({
      date: x.endDate?.fmt, operatingCashflow: num(x.totalCashFromOperatingActivities),
      capex: num(x.capitalExpenditures), freeCashflow: (num(x.totalCashFromOperatingActivities) ?? 0) + (num(x.capitalExpenditures) ?? 0),
    }));
    return { income: inc, balanceSheet: bs, cashflow: cf };
  });
}

async function toolNews(symbol: string) {
  return cached(`n:${symbol}`, async () => {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=8&quotesCount=0`, {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) return { error: `news http ${r.status}` };
    const j = await r.json();
    const items = (j?.news ?? []).slice(0, 8).map((n: any) => ({
      title: n.title, publisher: n.publisher, link: n.link,
      published: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    }));
    return { items };
  });
}

async function toolPeers(symbol: string) {
  return cached(`pr:${symbol}`, async () => {
    const r = await quoteSummary(symbol, ["recommendationTrend"]);
    // Use Yahoo "recommendations" endpoint for similar tickers
    const auth = await yahooAuth();
    if (!auth) return { error: "peers unavailable" };
    const r2 = await fetch(`https://query1.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`, {
      headers: { "User-Agent": UA, Cookie: auth.cookie },
    });
    if (!r2.ok) return { error: `peers http ${r2.status}` };
    const j = await r2.json().catch(() => null);
    const peers = (j?.finance?.result?.[0]?.recommendedSymbols ?? []).map((x: any) => x.symbol).slice(0, 6);
    // Pull tiny quote for each peer
    const out = await Promise.all(peers.map(async (sym: string) => {
      try {
        const q = await toolQuote(sym);
        return { symbol: sym, price: (q as any).price, changePct: (q as any).changePct, return1m: (q as any).return1m };
      } catch { return { symbol: sym }; }
    }));
    return { peers: out };
  });
}

const TOOLS = [
  { type: "function", function: { name: "get_quote", description: "Current price, day range, 52w range, recent return for a stock symbol.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_company_profile", description: "Company name, sector, industry, business summary, employees.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_key_stats", description: "Valuation and key ratios: PE, forward PE, PEG, P/B, margins, ROE/ROA, growth, debt, analyst target.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_financials", description: "Annual income statement, balance sheet, and cashflow snapshots.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_news", description: "Recent news headlines for a stock symbol.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "get_peers", description: "Peer/competitor tickers with quote snapshot.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
];

async function dispatch(name: string, args: any) {
  const sym = String(args?.symbol ?? "").toUpperCase();
  if (!sym) return { error: "symbol required" };
  switch (name) {
    case "get_quote": return await toolQuote(sym);
    case "get_company_profile": return await toolProfile(sym);
    case "get_key_stats": return await toolKeyStats(sym);
    case "get_financials": return await toolFinancials(sym);
    case "get_news": return await toolNews(sym);
    case "get_peers": return await toolPeers(sym);
    default: return { error: `unknown tool ${name}` };
  }
}

interface ChatMsg { role: "user" | "assistant"; content: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
    const body = await req.json() as { symbol: string; messages: ChatMsg[]; companyName?: string | null; sector?: string | null };
    const symbol = (body.symbol || "").toUpperCase();
    if (!symbol || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "symbol and messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are StockBot, a sharp institutional equity analyst inspired by Groq's StockBot. You analyze ONE stock at a time: ${symbol}${body.companyName ? ` (${body.companyName})` : ""}${body.sector ? `, ${body.sector}` : ""}.

You have tools to fetch live financial data: get_quote, get_company_profile, get_key_stats, get_financials, get_news, get_peers.

Rules:
- ALWAYS call the relevant tools before answering substantive questions. Don't guess numbers.
- For a general "analyze this stock" prompt, call get_quote, get_key_stats, get_news (and get_peers if comparison helps) in parallel.
- After tool calls, write a concise, well-structured markdown answer (headings, bullets, bold numbers). Cite specific figures.
- Balance bull and bear cases. Mention catalysts, risks, valuation, and momentum.
- Keep responses tight (~250 words unless asked for depth). No disclaimers, no code fences.
- The user can see the chart; focus on insight, not raw data dumps.

Default symbol for all tool calls: ${symbol}.`;

    const messages: any[] = [
      { role: "system", content: system },
      ...body.messages.slice(-10).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 4000) })),
    ];

    // Tool-calling loop, max 3 rounds
    for (let round = 0; round < 3; round++) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          messages,
          tools: TOOLS,
          tool_choice: round === 0 ? "auto" : "auto",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `groq ${res.status}: ${t.slice(0, 300)}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const j = await res.json();
      const msg = j?.choices?.[0]?.message;
      if (!msg) throw new Error("no message from groq");
      messages.push(msg);

      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        return new Response(JSON.stringify({ reply: msg.content ?? "", toolsUsed: messages.filter((m) => m.role === "tool").map((m) => m.name) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = await Promise.all(calls.map(async (c: any) => {
        let args: any = {};
        try { args = JSON.parse(c.function.arguments || "{}"); } catch {}
        if (!args.symbol) args.symbol = symbol;
        const data = await dispatch(c.function.name, args);
        return { tool_call_id: c.id, name: c.function.name, content: JSON.stringify(data).slice(0, 8000) };
      }));
      for (const r of results) {
        messages.push({ role: "tool", tool_call_id: r.tool_call_id, name: r.name, content: r.content });
      }
    }

    return new Response(JSON.stringify({ reply: "Sorry, I couldn't finish the analysis in time. Try a more specific question." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
