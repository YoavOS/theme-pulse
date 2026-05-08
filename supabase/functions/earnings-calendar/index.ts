// Earnings calendar — TODAY's earnings reporters with EPS estimates,
// market cap filter, report time (BMO/AMC), and current-vs-prevclose gap %.
// Primary source: Finnhub (has BMO/AMC hour). Fallback: FMP stable endpoint.
// Enrichment: Yahoo quote (mcap, price, prevClose, name).

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
  reportTime: "BMO" | "AMC" | "DMH" | null;
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
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

function mapHour(h: any): EarningsRow["reportTime"] {
  const s = String(h || "").toLowerCase();
  if (s === "bmo" || s.includes("before")) return "BMO";
  if (s === "amc" || s.includes("after")) return "AMC";
  if (s === "dmh" || s.includes("during")) return "DMH";
  return null;
}

// Finnhub primary
async function fetchFinnhub(date: string, apiKey: string): Promise<any[]> {
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${date}&to=${date}&token=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error("Finnhub error", res.status, await res.text().catch(() => ""));
    return [];
  }
  const j = await res.json().catch(() => null);
  return Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
}

// FMP stable fallback (no date param — returns recent rolling window)
async function fetchFmpFallback(date: string, apiKey: string): Promise<any[]> {
  const url = `https://financialmodelingprep.com/stable/earnings-calendar?apikey=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error("FMP fallback error", res.status);
    return [];
  }
  const arr = await res.json().catch(() => null);
  if (!Array.isArray(arr)) return [];
  return arr.filter((r: any) => String(r?.date || "").slice(0, 10) === date);
}

// FMP single-symbol quote — sequential with throttle to avoid 402 burst limits.
async function fetchFmpQuotes(symbols: string[], apiKey: string): Promise<Map<string, { price: number | null; prevClose: number | null; marketCap: number | null; name: string | null }>> {
  const out = new Map();
  const concurrency = 2;
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      const sym = symbols[i];
      let attempt = 0;
      while (attempt < 2) {
        try {
          const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`;
          const res = await fetch(url, { headers: { "User-Agent": UA } });
          if (res.status === 402 || res.status === 429) {
            // burst-limit: backoff and retry once
            attempt++;
            await sleep(700 + Math.random() * 400);
            continue;
          }
          if (!res.ok) { console.error(`FMP quote ${sym} ${res.status}`); break; }
          const arr = await res.json().catch(() => null);
          const q = Array.isArray(arr) ? arr[0] : null;
          if (q) {
            out.set(sym.toUpperCase(), {
              price: Number.isFinite(q.price) ? q.price : null,
              prevClose: Number.isFinite(q.previousClose) ? q.previousClose : null,
              marketCap: Number.isFinite(q.marketCap) ? q.marketCap : null,
              name: q.name ?? null,
            });
          }
          break;
        } catch (e) { console.error(`FMP quote ${sym} threw`, e); break; }
      }
      await sleep(220);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY");
    const FMP_API_KEY = Deno.env.get("FMP_API_KEY");

    let body: any = {};
    try { body = await req.json(); } catch {}

    const minMarketCap = Number(body?.minMarketCap ?? 1_000_000_000);
    const universeFilter: string[] | null = Array.isArray(body?.universe) && body.universe.length > 0
      ? body.universe.map((s: any) => String(s).toUpperCase())
      : null;
    const date = String(body?.date || todayET());

    let raw: any[] = [];
    let source = "none";

    if (FINNHUB_API_KEY) {
      raw = await fetchFinnhub(date, FINNHUB_API_KEY);
      if (raw.length) source = "finnhub";
    }
    if (raw.length === 0 && FMP_API_KEY) {
      raw = await fetchFmpFallback(date, FMP_API_KEY);
      if (raw.length) source = "fmp_fallback";
    }

    // Normalize — Finnhub uses {symbol, hour, epsEstimate, epsActual, revenueEstimate, revenueActual}
    // FMP uses {symbol, time, epsEstimated, eps, revenueEstimated, revenue}
    let rows: EarningsRow[] = raw
      .filter((r: any) => r?.symbol && !String(r.symbol).includes("."))
      .map((r: any) => {
        const epsEst = r.epsEstimate ?? r.epsEstimated;
        const epsAct = r.epsActual ?? r.eps;
        const revEst = r.revenueEstimate ?? r.revenueEstimated;
        const revAct = r.revenueActual ?? r.revenue;
        const time = r.hour !== undefined ? mapHour(r.hour) : mapHour(r.time);
        return {
          symbol: String(r.symbol).toUpperCase(),
          company: null,
          marketCap: null,
          reportTime: time,
          epsEstimate: Number.isFinite(epsEst) ? Number(epsEst) : null,
          epsActual: Number.isFinite(epsAct) ? Number(epsAct) : null,
          revenueEstimate: Number.isFinite(revEst) ? Number(revEst) : null,
          revenueActual: Number.isFinite(revAct) ? Number(revAct) : null,
          currentPrice: null,
          previousClose: null,
          gapPct: null,
          date,
        };
      });

    // Dedupe by symbol
    const seen = new Set<string>();
    rows = rows.filter(r => {
      if (seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    });

    if (universeFilter) {
      const set = new Set(universeFilter);
      rows = rows.filter(r => set.has(r.symbol));
    }

    // Cap symbol count for Yahoo enrichment
    const symbolsToEnrich = rows.map(r => r.symbol).slice(0, 300);
    const quotes = FMP_API_KEY ? await fetchFmpQuotes(symbolsToEnrich, FMP_API_KEY) : new Map();

    rows = rows.map(r => {
      const q = quotes.get(r.symbol);
      const px = q?.price ?? null;
      const pc = q?.prevClose ?? null;
      const gap = (px !== null && pc !== null && pc > 0)
        ? Math.round(((px - pc) / pc) * 10000) / 100
        : null;
      return { ...r, marketCap: q?.marketCap ?? null, currentPrice: px, previousClose: pc, gapPct: gap, company: q?.name ?? null };
    });

    // Apply mcap floor only when we have an mcap; if all enrichments failed, keep rows and let user see them
    const enrichedAny = rows.some(r => r.marketCap !== null);
    const filtered = enrichedAny
      ? rows.filter(r => r.marketCap !== null && r.marketCap >= minMarketCap)
      : rows; // graceful fallback if Yahoo is blocked

    const order = (t: EarningsRow["reportTime"]) => t === "BMO" ? 0 : t === "DMH" ? 1 : t === "AMC" ? 2 : 3;
    filtered.sort((a, b) => order(a.reportTime) - order(b.reportTime) || (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return jsonResponse({
      date,
      total: filtered.length,
      universeFiltered: !!universeFilter,
      minMarketCap,
      source,
      enriched: enrichedAny,
      rows: filtered,
    });
  } catch (e) {
    console.error("earnings-calendar error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error" }, 500);
  }
});
