// Historical big earnings gappers — find stocks that gapped ≥ +X% the day after
// reporting earnings in the past N days. Uses Finnhub for the calendar, profile,
// and daily candles. Yahoo kept only as last-resort fallback for daily bars
// (Finnhub free tier sometimes restricts /stock/candle).
// Optional Groq analysis for top winners.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA = "Mozilla/5.0 (compatible; LovableEarnings/1.0)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Gapper {
  symbol: string;
  company: string | null;
  reportDate: string;
  reportTime: "BMO" | "AMC" | "DMH" | null;
  gapPct: number;
  prevClose: number;
  openPrice: number;
  marketCap: number | null;
  sector: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  revenueSurprisePct: number | null;
  rsRating: number | null;
  aiAnalysis?: string | null;
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

// ───────── Finnhub calendar (chunked into 30-day windows) ─────────
async function fetchFinnhubRange(from: string, to: string, apiKey: string): Promise<any[]> {
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  const out: any[] = [];
  let cur = new Date(fromD);
  while (cur <= toD) {
    const chunkEnd = new Date(Math.min(cur.getTime() + 29 * 86400_000, toD.getTime()));
    const f = cur.toISOString().slice(0, 10);
    const t = chunkEnd.toISOString().slice(0, 10);
    try {
      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${f}&to=${t}&token=${apiKey}`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        const arr = Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
        out.push(...arr);
      } else {
        console.error("Finnhub range error", res.status);
      }
    } catch (e) { console.error("Finnhub fetch failed", e); }
    cur = new Date(chunkEnd.getTime() + 86400_000);
    await sleep(150);
  }
  return out;
}

// ───────── Finnhub profile2 enrichment ─────────
async function fetchFinnhubProfiles(symbols: string[], apiKey: string): Promise<Map<string, { mcap: number | null; sector: string | null; name: string | null }>> {
  const out = new Map();
  const concurrency = 3;
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      const sym = symbols[i];
      try {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (res.ok) {
          const j = await res.json().catch(() => null);
          if (j && j.name) {
            const mcRaw = Number(j.marketCapitalization);
            out.set(sym.toUpperCase(), {
              mcap: Number.isFinite(mcRaw) && mcRaw > 0 ? mcRaw * 1_000_000 : null,
              sector: j.finnhubIndustry ?? j.sector ?? null,
              name: j.name ?? null,
            });
          }
        }
      } catch (e) { console.error(`Finnhub profile ${sym}`, e); }
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

// FMP profile fallback (used only if Finnhub returns nothing)
async function fetchFmpProfilesFallback(symbols: string[], apiKey: string): Promise<Map<string, { mcap: number | null; sector: string | null; name: string | null }>> {
  const out = new Map();
  let idx = 0;
  while (idx < symbols.length) {
    const sym = symbols[idx++];
    try {
      const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const arr = await res.json().catch(() => null);
        const p = Array.isArray(arr) ? arr[0] : null;
        if (p) out.set(sym.toUpperCase(), {
          mcap: Number.isFinite(p.marketCap) ? p.marketCap : null,
          sector: p.sector ?? p.industry ?? null,
          name: p.companyName ?? p.name ?? null,
        });
      }
    } catch {}
    await sleep(380);
  }
  return out;
}

// ───────── Daily candles: Finnhub primary, Yahoo fallback ─────────
interface DailyBar { date: string; open: number; close: number; }

async function fetchFinnhubDaily(symbol: string, fromTs: number, toTs: number, apiKey: string): Promise<DailyBar[]> {
  try {
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const j = await res.json().catch(() => null);
    if (!j || j.s !== "ok") return [];
    const ts: number[] = j.t ?? [];
    const opens: number[] = j.o ?? [];
    const closes: number[] = j.c ?? [];
    const out: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = opens[i], c = closes[i];
      if (o == null || c == null) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, close: c });
    }
    return out;
  } catch { return []; }
}

async function fetchYahooDailyFallback(symbol: string, fromTs: number, toTs: number): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${fromTs}&period2=${toTs}&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return [];
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return [];
    const ts: number[] = r.timestamp ?? [];
    const opens: (number | null)[] = r.indicators?.quote?.[0]?.open ?? [];
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    const out: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = opens[i], c = closes[i];
      if (o == null || c == null) continue;
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, close: c });
    }
    return out;
  } catch { return []; }
}

async function groqSummarize(g: Gapper, groqKey: string): Promise<string | null> {
  const surprise = g.epsSurprisePct !== null ? `EPS surprise ${g.epsSurprisePct.toFixed(1)}%` : "EPS surprise N/A";
  const revSurprise = g.revenueSurprisePct !== null ? `, Revenue surprise ${g.revenueSurprisePct.toFixed(1)}%` : "";
  const prompt = `Stock ${g.symbol} (${g.company ?? "?"} — sector: ${g.sector ?? "?"}) gapped +${g.gapPct.toFixed(1)}% the day after reporting on ${g.reportDate} (${g.reportTime ?? "?"}). ${surprise}${revSurprise}.

Write a single concise insight (max 2 sentences, ~35 words) covering: (1) the size of the beat, and (2) the most plausible catalyst type given the sector/numbers (e.g. guidance raise, product cycle, AI demand, contract win). Be specific. Don't invent press releases — speak in terms of likely drivers.`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 180,
        temperature: 0.4,
        messages: [
          { role: "system", content: "You are a sharp equity research analyst. Be concise, specific, and never fabricate facts." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY");
    const FMP_API_KEY = Deno.env.get("FMP_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!FINNHUB_API_KEY) return jsonResponse({ error: "FINNHUB_API_KEY not configured" }, 500);

    let body: any = {};
    try { body = await req.json(); } catch {}

    const lookbackDays = Math.min(120, Math.max(7, Number(body?.lookbackDays ?? 60)));
    const minGapPct = Math.max(3, Number(body?.minGapPct ?? 10));
    const minMarketCap = Number(body?.minMarketCap ?? 1_000_000_000);
    const universeFilter: string[] | null = Array.isArray(body?.universe) && body.universe.length > 0
      ? body.universe.map((s: any) => String(s).toUpperCase())
      : null;
    const enableAi = body?.enableAi !== false;
    const maxAiRows = Math.min(15, Number(body?.maxAiRows ?? 10));

    const today = new Date();
    const from = new Date(today.getTime() - lookbackDays * 86400_000);
    const fromStr = isoDate(from);
    const toStr = isoDate(today);

    const cal = await fetchFinnhubRange(fromStr, toStr, FINNHUB_API_KEY);

    const mapTime = (h: any): Gapper["reportTime"] => {
      const s = String(h || "").toLowerCase();
      if (s === "bmo" || s.includes("before")) return "BMO";
      if (s === "amc" || s.includes("after")) return "AMC";
      if (s === "dmh" || s.includes("during")) return "DMH";
      return null;
    };

    const seen = new Set<string>();
    const universe = universeFilter ? new Set(universeFilter) : null;
    const reports = cal
      .filter((r: any) => r?.symbol && !String(r.symbol).includes("."))
      .map((r: any) => ({
        symbol: String(r.symbol).toUpperCase(),
        date: String(r.date || "").slice(0, 10),
        time: mapTime(r.hour),
        epsEst: Number.isFinite(r.epsEstimate) ? Number(r.epsEstimate) : null,
        epsAct: Number.isFinite(r.epsActual) ? Number(r.epsActual) : null,
        revEst: Number.isFinite(r.revenueEstimate) ? Number(r.revenueEstimate) : null,
        revAct: Number.isFinite(r.revenueActual) ? Number(r.revenueActual) : null,
      }))
      .filter((r) => {
        if (!r.date) return false;
        if (universe && !universe.has(r.symbol)) return false;
        const k = `${r.symbol}|${r.date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    if (reports.length === 0) {
      return jsonResponse({ from: fromStr, to: toStr, total: 0, rows: [] });
    }

    // Profiles: Finnhub primary, FMP fallback
    const allSymbols = Array.from(new Set(reports.map(r => r.symbol)));
    let profiles = await fetchFinnhubProfiles(allSymbols, FINNHUB_API_KEY);
    if (profiles.size === 0 && FMP_API_KEY) {
      console.log("Finnhub profiles empty — falling back to FMP");
      profiles = await fetchFmpProfilesFallback(allSymbols, FMP_API_KEY);
    }

    let eligible = reports.filter(r => {
      const p = profiles.get(r.symbol);
      if (!p || p.mcap === null) return false;
      return p.mcap >= minMarketCap;
    });

    eligible.sort((a, b) => (profiles.get(b.symbol)?.mcap ?? 0) - (profiles.get(a.symbol)?.mcap ?? 0));
    eligible = eligible.slice(0, 250);

    const bySymbol = new Map<string, typeof eligible>();
    for (const r of eligible) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push(r);
      bySymbol.set(r.symbol, arr);
    }

    const gappers: Gapper[] = [];
    let candleSource: "finnhub" | "yahoo" | "mixed" | "none" = "none";
    let finnhubBars = 0;
    let yahooBars = 0;

    for (const [symbol, list] of bySymbol) {
      const fromTs = Math.floor(from.getTime() / 1000) - 7 * 86400;
      const toTs = Math.floor(today.getTime() / 1000) + 86400;

      let bars = await fetchFinnhubDaily(symbol, fromTs, toTs, FINNHUB_API_KEY);
      if (bars.length >= 2) finnhubBars++;
      if (bars.length < 2) {
        bars = await fetchYahooDailyFallback(symbol, fromTs, toTs);
        if (bars.length >= 2) yahooBars++;
      }
      if (bars.length < 2) { await sleep(80); continue; }

      for (const r of list) {
        const idx = bars.findIndex(b => b.date === r.date);
        if (idx < 0) continue;
        let prevClose: number | null = null;
        let openPrice: number | null = null;
        if (r.time === "BMO") {
          if (idx === 0) continue;
          prevClose = bars[idx - 1].close;
          openPrice = bars[idx].open;
        } else {
          if (idx >= bars.length - 1) continue;
          prevClose = bars[idx].close;
          openPrice = bars[idx + 1].open;
        }
        if (!prevClose || !openPrice || prevClose <= 0) continue;
        const gap = ((openPrice - prevClose) / prevClose) * 100;
        if (gap < minGapPct) continue;

        const epsSurprise = (r.epsEst !== null && r.epsAct !== null && Math.abs(r.epsEst) > 0.01)
          ? ((r.epsAct - r.epsEst) / Math.abs(r.epsEst)) * 100 : null;
        const revSurprise = (r.revEst !== null && r.revAct !== null && r.revEst > 0)
          ? ((r.revAct - r.revEst) / r.revEst) * 100 : null;

        const profile = profiles.get(symbol);
        gappers.push({
          symbol,
          company: profile?.name ?? null,
          reportDate: r.date,
          reportTime: r.time,
          gapPct: Math.round(gap * 100) / 100,
          prevClose: Math.round(prevClose * 100) / 100,
          openPrice: Math.round(openPrice * 100) / 100,
          marketCap: profile?.mcap ?? null,
          sector: profile?.sector ?? null,
          epsEstimate: r.epsEst,
          epsActual: r.epsAct,
          epsSurprisePct: epsSurprise !== null ? Math.round(epsSurprise * 10) / 10 : null,
          revenueEstimate: r.revEst,
          revenueActual: r.revAct,
          revenueSurprisePct: revSurprise !== null ? Math.round(revSurprise * 10) / 10 : null,
          rsRating: null,
        });
      }
      await sleep(80);
    }

    if (finnhubBars > 0 && yahooBars === 0) candleSource = "finnhub";
    else if (yahooBars > 0 && finnhubBars === 0) candleSource = "yahoo";
    else if (finnhubBars > 0 && yahooBars > 0) candleSource = "mixed";

    gappers.sort((a, b) => b.gapPct - a.gapPct);

    if (enableAi && GROQ_API_KEY) {
      const top = gappers.slice(0, maxAiRows);
      for (const g of top) {
        g.aiAnalysis = await groqSummarize(g, GROQ_API_KEY);
        await sleep(300);
      }
    }

    return jsonResponse({
      from: fromStr,
      to: toStr,
      lookbackDays,
      minGapPct,
      minMarketCap,
      universeFiltered: !!universeFilter,
      total: gappers.length,
      candleSource,
      profileCount: profiles.size,
      rows: gappers,
    });
  } catch (e) {
    console.error("earnings-historical-gappers error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error" }, 500);
  }
});
