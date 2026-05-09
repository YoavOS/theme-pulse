// Earnings calendar — TODAY's earnings reporters with EPS estimates,
// market cap filter, report time (BMO/AMC), and current-vs-prevclose gap %.
// Primary source: Finnhub for both calendar AND enrichment (quote + profile2).
// FMP kept only as a fallback when Finnhub is unavailable.

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

// ───────── Finnhub: calendar ─────────
async function fetchFinnhubCalendar(date: string, apiKey: string): Promise<any[]> {
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${date}&to=${date}&token=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.error("Finnhub calendar error", res.status, await res.text().catch(() => ""));
    return [];
  }
  const j = await res.json().catch(() => null);
  return Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
}

// ───────── Finnhub: quote + profile2 enrichment ─────────
interface Enrichment { price: number | null; prevClose: number | null; marketCap: number | null; name: string | null; }

async function fetchFinnhubQuote(sym: string, apiKey: string): Promise<{ price: number | null; prevClose: number | null } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    if (!j) return null;
    const c = Number(j.c), pc = Number(j.pc);
    return {
      price: Number.isFinite(c) && c > 0 ? c : null,
      prevClose: Number.isFinite(pc) && pc > 0 ? pc : null,
    };
  } catch (e) { console.error(`Finnhub quote ${sym}`, e); return null; }
}

async function fetchFinnhubProfile(sym: string, apiKey: string): Promise<{ marketCap: number | null; name: string | null } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) { await sleep(1500 + Math.random() * 1000); continue; }
      if (!res.ok) { console.error(`Finnhub profile ${sym} status=${res.status}`); return null; }
      const j = await res.json().catch(() => null);
      if (!j || !j.name) return null;
      const mcRaw = Number(j.marketCapitalization);
      const marketCap = Number.isFinite(mcRaw) && mcRaw > 0 ? mcRaw * 1_000_000 : null;
      return { marketCap, name: j.name ?? null };
    } catch (e) { console.error(`Finnhub profile ${sym}`, e); return null; }
  }
  return null;
}

// FMP fallback for profile (per-symbol)
async function fetchFmpProfile(sym: string, apiKey: string): Promise<{ marketCap: number | null; name: string | null } | null> {
  try {
    const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const arr = await res.json().catch(() => null);
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) return null;
    return {
      marketCap: Number.isFinite(p.marketCap) ? Number(p.marketCap) : null,
      name: p.companyName ?? p.name ?? null,
    };
  } catch { return null; }
}

async function enrichFinnhub(symbols: string[], finnhubKey: string, fmpKey: string | null): Promise<Map<string, Enrichment>> {
  const out = new Map<string, Enrichment>();
  for (const sym of symbols) {
    const q = await fetchFinnhubQuote(sym, finnhubKey);
    await sleep(150);
    let p = await fetchFinnhubProfile(sym, finnhubKey);
    await sleep(150);
    if ((!p || p.marketCap === null) && fmpKey) {
      const fmp = await fetchFmpProfile(sym, fmpKey);
      if (fmp) p = fmp;
      await sleep(380);
    }
    out.set(sym.toUpperCase(), {
      price: q?.price ?? null,
      prevClose: q?.prevClose ?? null,
      marketCap: p?.marketCap ?? null,
      name: p?.name ?? null,
    });
  }
  return out;
}

// ───────── FMP fallback (only used if Finnhub unavailable) ─────────
async function fetchFmpFallbackCalendar(date: string, apiKey: string): Promise<any[]> {
  const url = `https://financialmodelingprep.com/stable/earnings-calendar?apikey=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const arr = await res.json().catch(() => null);
  if (!Array.isArray(arr)) return [];
  return arr.filter((r: any) => String(r?.date || "").slice(0, 10) === date);
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
      raw = await fetchFinnhubCalendar(date, FINNHUB_API_KEY);
      if (raw.length) source = "finnhub";
    }
    if (raw.length === 0 && FMP_API_KEY) {
      raw = await fetchFmpFallbackCalendar(date, FMP_API_KEY);
      if (raw.length) source = "fmp_fallback";
    }

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

    // Cap symbols enriched to keep within edge function timeout (Finnhub free: 60/min)
    const symbolsToEnrich = rows.map(r => r.symbol).slice(0, 40);
    const enrichment = FINNHUB_API_KEY
      ? await enrichFinnhub(symbolsToEnrich, FINNHUB_API_KEY, FMP_API_KEY ?? null)
      : new Map<string, Enrichment>();

    rows = rows.map(r => {
      const q = enrichment.get(r.symbol);
      const px = q?.price ?? null;
      const pc = q?.prevClose ?? null;
      const gap = (px !== null && pc !== null && pc > 0)
        ? Math.round(((px - pc) / pc) * 10000) / 100
        : null;
      return { ...r, marketCap: q?.marketCap ?? null, currentPrice: px, previousClose: pc, gapPct: gap, company: q?.name ?? null };
    });

    // Apply mcap floor only when we have an mcap; if all enrichments failed, keep rows
    const enrichedAny = rows.some(r => r.marketCap !== null);
    const filtered = enrichedAny
      ? rows.filter(r => r.marketCap !== null && r.marketCap >= minMarketCap)
      : rows;

    const order = (t: EarningsRow["reportTime"]) => t === "BMO" ? 0 : t === "DMH" ? 1 : t === "AMC" ? 2 : 3;
    filtered.sort((a, b) => order(a.reportTime) - order(b.reportTime) || (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return jsonResponse({
      date,
      total: filtered.length,
      universeFiltered: !!universeFilter,
      minMarketCap,
      source,
      enriched: enrichedAny,
      enrichmentSource: "finnhub",
      rows: filtered,
    });
  } catch (e) {
    console.error("earnings-calendar error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error" }, 500);
  }
});
