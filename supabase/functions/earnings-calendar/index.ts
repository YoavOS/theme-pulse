// Earnings calendar — TODAY's earnings reporters with EPS estimates,
// market cap filter, report time (BMO/AMC), and current-vs-prevclose gap %.
// Merge configured calendar sources; optional enrichment must never remove reporters.

import { normalizeCalendar, filterCalendar } from "../_shared/earningsCalendar.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
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
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Finnhub calendar unavailable (HTTP ${res.status})`);
  }
  const j = await res.json().catch(() => null);
  if (!Array.isArray(j?.earningsCalendar)) throw new Error("Finnhub returned an invalid calendar response");
  return j.earningsCalendar;
}

// ───────── Finnhub: quote + profile2 enrichment ─────────
interface Enrichment { price: number | null; prevClose: number | null; marketCap: number | null; name: string | null; }

async function fetchFinnhubQuote(sym: string, apiKey: string): Promise<{ price: number | null; prevClose: number | null } | null> {
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
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
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
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
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
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
  const deadline=Date.now()+12000;
  for (const sym of symbols) {
    if(Date.now()>deadline)break;
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
  const url = `https://financialmodelingprep.com/stable/earnings-calendar?from=${date}&to=${date}&apikey=${apiKey}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`FMP calendar unavailable (HTTP ${res.status})`); }
  const arr = await res.json().catch(() => null);
  if (!Array.isArray(arr)) throw new Error("FMP returned an invalid calendar response");
  return arr.filter((r: any) => String(r?.date || "").slice(0, 10) === date);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY");
    const FMP_API_KEY = Deno.env.get("FMP_API_KEY");

    let body: any = {};
    try { body = await req.json(); } catch {}

    const floor = Number(body?.minMarketCap ?? 0);
    if (!Number.isFinite(floor) || floor < 0) return jsonResponse({error:"Invalid market-cap filter"},400);
    const minMarketCap = floor;
    const universeFilter: string[] | null = Array.isArray(body?.universe) ? body.universe.map((s:any)=>String(s).toUpperCase()) : null;
    const date = String(body?.date || todayET());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return jsonResponse({error:"Invalid calendar date"},400);
    const warnings: string[] = [];
    const sources: string[] = [];
    const requests: {name:string;request:Promise<any[]>}[] = [];
    if(FINNHUB_API_KEY) requests.push({name:"Finnhub",request:fetchFinnhubCalendar(date,FINNHUB_API_KEY)});
    if(FMP_API_KEY) requests.push({name:"FMP",request:fetchFmpFallbackCalendar(date,FMP_API_KEY)});
    if(!requests.length) throw new Error("No earnings calendar provider is configured");
    const results=await Promise.allSettled(requests.map(x=>x.request));
    const raw:any[]=[];
    results.forEach((result,i)=>{
      if(result.status==='fulfilled'){sources.push(requests[i].name);raw.push(...result.value);}
      else warnings.push(`${requests[i].name} calendar unavailable; coverage may be incomplete.`);
    });
    if(!sources.length) throw new Error("Earnings calendar sources are unavailable. Retry shortly.");
    let rows: EarningsRow[] = normalizeCalendar(raw,date);
    const calendarTotal=rows.length;
    // Calendar membership never depends on successful quote/profile enrichment.
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const metadata=new Map<string,any>();
    for(let offset=0;offset<rows.length;offset+=200){
      const symbols=rows.slice(offset,offset+200).map(r=>r.symbol);
      const {data,error}=await sb.from("qualified_rs_universe").select("symbol,company_name,market_cap,current_price").in("symbol",symbols);
      if(error){warnings.push("Cached company details unavailable; reporters are still included.");break;}
      for(const r of data??[]) metadata.set(r.symbol,r);
    }
    rows=rows.map(r=>{const m=metadata.get(r.symbol);return {...r,company:r.company??m?.company_name??null,
      marketCap:r.marketCap??(typeof m?.market_cap==='number'&&m.market_cap>0?m.market_cap*1000000:null)};});
    const scoped = filterCalendar(rows,universeFilter,0);
    const excludedByUniverse=rows.length-scoped.length;
    // Use calendar + cached metadata immediately. Request quote/profile only on manual refresh,
    // in a small bounded batch. This must never trim the calendar itself.
    let enrichment=new Map<string,Enrichment>();
    if(body?.enrich===true && FINNHUB_API_KEY){
      enrichment=await enrichFinnhub(scoped.slice(0,10).map(r=>r.symbol),FINNHUB_API_KEY,FMP_API_KEY??null);
    }
    rows=scoped.map(r=>{const q=enrichment.get(r.symbol);const px=q?.price??null,pc=q?.prevClose??null;
      return {...r,company:q?.name??r.company,marketCap:q?.marketCap??r.marketCap,currentPrice:px,previousClose:pc,
        gapPct:px!==null&&pc!==null&&pc>0?Math.round((px-pc)/pc*10000)/100:null};});
    const filtered=filterCalendar(rows,null,minMarketCap);
    const source=sources.join(" + ");
    const enrichedAny=filtered.some(r=>r.marketCap!==null);
    const coverage={calendarTotal,excludedByUniverse,excludedByMarketCap:rows.length-filtered.length,
      unknownMarketCap:filtered.filter(r=>r.marketCap===null).length,source,fetchedAt:new Date().toISOString(),warnings};
    const order = (t: EarningsRow["reportTime"]) => t === "BMO" ? 0 : t === "DMH" ? 1 : t === "AMC" ? 2 : 3;
    filtered.sort((a, b) => order(a.reportTime) - order(b.reportTime) || (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return jsonResponse({
      date,
      total: filtered.length,
      universeFiltered: !!universeFilter,
      minMarketCap,
      source,
      enriched: enrichedAny,
      enrichmentSource: body?.enrich===true ? "cached + bounded refresh" : "cached metadata",
      coverage,
      rows: filtered,
    });
  } catch (e) {
    console.error("earnings-calendar error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error" }, 500);
  }
});
