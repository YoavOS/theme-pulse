// Earnings calendar — TODAY's earnings reporters with EPS estimates,
// market cap filter, report time (BMO/AMC), and pre/after-hours gap %.
// Data flow: FMP earnings calendar (primary) → enriched with FMP profile (mcap)
// → Yahoo quote for current/previous close gap %.
// Optional `universe` filter: array of allowed symbols (e.g. qualified RS universe).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA = "Mozilla/5.0 (compatible; LovableEarnings/1.0)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EarningsRow {
  symbol: string;
  company: string | null;
  marketCap: number | null;
  reportTime: "BMO" | "AMC" | "DMH" | null; // before-market / after-market / during
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  currentPrice: number | null;
  previousClose: number | null;
  gapPct: number | null;
  date: string;
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayET(): string {
  // Format YYYY-MM-DD in US/Eastern
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(d);
}

async function fetchFmpCalendar(date: string, apiKey: string): Promise<any[]> {
  const url = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${date}&to=${date}&apikey=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error("FMP calendar error", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, { price: number | null; prevClose: number | null; marketCap: number | null; name: string | null }>> {
  const out = new Map();
  if (symbols.length === 0) return out;
  // Yahoo allows ~50 symbols per call
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 50) chunks.push(symbols.slice(i, i + 50));
  for (const chunk of chunks) {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
      if (!res.ok) { await sleep(300); continue; }
      const j = await res.json();
      const arr = j?.quoteResponse?.result ?? [];
      for (const q of arr) {
        out.set(String(q.symbol).toUpperCase(), {
          price: Number.isFinite(q.regularMarketPrice) ? q.regularMarketPrice : (Number.isFinite(q.postMarketPrice) ? q.postMarketPrice : null),
          prevClose: Number.isFinite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null,
          marketCap: Number.isFinite(q.marketCap) ? q.marketCap : null,
          name: q.shortName || q.longName || null,
        });
      }
    } catch (e) {
      console.error("Yahoo quote chunk failed:", e);
    }
    await sleep(200);
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FMP_API_KEY = Deno.env.get("FMP_API_KEY");
    if (!FMP_API_KEY) return jsonResponse({ error: "FMP_API_KEY not configured" }, 500);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const minMarketCap = Number(body?.minMarketCap ?? 1_000_000_000);
    const universeFilter: string[] | null = Array.isArray(body?.universe) && body.universe.length > 0
      ? body.universe.map((s: any) => String(s).toUpperCase())
      : null;
    const date = String(body?.date || todayET());

    const cal = await fetchFmpCalendar(date, FMP_API_KEY);

    // Map FMP "time" field: "bmo" | "amc" | "--" | "dmh"
    const mapTime = (t: any): EarningsRow["reportTime"] => {
      const s = String(t || "").toLowerCase();
      if (s.includes("bmo") || s.includes("before")) return "BMO";
      if (s.includes("amc") || s.includes("after")) return "AMC";
      if (s.includes("dmh") || s.includes("during")) return "DMH";
      return null;
    };

    let rows: EarningsRow[] = cal
      .filter((r: any) => r?.symbol && !String(r.symbol).includes("."))
      .map((r: any) => ({
        symbol: String(r.symbol).toUpperCase(),
        company: null,
        marketCap: null,
        reportTime: mapTime(r.time),
        epsEstimate: Number.isFinite(r.epsEstimated) ? Number(r.epsEstimated) : null,
        epsActual: Number.isFinite(r.eps) ? Number(r.eps) : null,
        revenueEstimate: Number.isFinite(r.revenueEstimated) ? Number(r.revenueEstimated) : null,
        revenueActual: Number.isFinite(r.revenue) ? Number(r.revenue) : null,
        currentPrice: null,
        previousClose: null,
        gapPct: null,
        date,
      }));

    if (universeFilter) {
      const set = new Set(universeFilter);
      rows = rows.filter(r => set.has(r.symbol));
    }

    // Cap to a sane number for Yahoo enrichment
    const symbols = rows.map(r => r.symbol).slice(0, 250);
    const quotes = await fetchYahooQuotes(symbols);

    rows = rows.map(r => {
      const q = quotes.get(r.symbol);
      const mcap = q?.marketCap ?? null;
      const px = q?.price ?? null;
      const pc = q?.prevClose ?? null;
      const gap = (px !== null && pc !== null && pc > 0)
        ? Math.round(((px - pc) / pc) * 10000) / 100
        : null;
      return { ...r, marketCap: mcap, currentPrice: px, previousClose: pc, gapPct: gap, company: q?.name ?? null };
    });

    // Apply market-cap floor (only if we have data; keep null mcap rows out of safety)
    const filtered = rows.filter(r => r.marketCap !== null && r.marketCap >= minMarketCap);

    // Sort: BMO first, then AMC, then by market cap desc
    const order = (t: EarningsRow["reportTime"]) => t === "BMO" ? 0 : t === "DMH" ? 1 : t === "AMC" ? 2 : 3;
    filtered.sort((a, b) => order(a.reportTime) - order(b.reportTime) || (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return jsonResponse({
      date,
      total: filtered.length,
      universeFiltered: !!universeFilter,
      minMarketCap,
      rows: filtered,
    });
  } catch (e) {
    console.error("earnings-calendar error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error" }, 500);
  }
});
