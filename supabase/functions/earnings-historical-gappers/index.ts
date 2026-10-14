// Historical big earnings gappers — find stocks that gapped ≥ +X% the day after
// reporting earnings in the past N days. Finnhub is the primary earnings calendar
// and profile source; daily bars use Finnhub when available with Yahoo as the
// practical fallback when candle access is restricted. FMP remains profile fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA = "Mozilla/5.0 (compatible; LovableEarnings/1.0)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_SYMBOLS_TO_SCAN = 900;
const BAR_CONCURRENCY = 14;
const PROFILE_CONCURRENCY = 3;
const EDGE_DEADLINE_MS = 125_000;

interface Report {
  symbol: string;
  date: string;
  time: "BMO" | "AMC" | "DMH" | null;
  epsEst: number | null;
  epsAct: number | null;
  revEst: number | null;
  revAct: number | null;
}

interface Profile {
  mcap: number | null;
  sector: string | null;
  name: string | null;
}

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

interface DailyBar { date: string; open: number; close: number; }

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rounded(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
function isUsLikeSymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9-]{0,5}$/.test(symbol) && !symbol.includes(".");
}
function mapTime(h: unknown): Gapper["reportTime"] {
  const s = String(h || "").toLowerCase();
  if (s === "bmo" || s.includes("before")) return "BMO";
  if (s === "amc" || s.includes("after")) return "AMC";
  if (s === "dmh" || s.includes("during")) return "DMH";
  return null;
}
function deadlineExceeded(startedAt: number): boolean {
  return Date.now() - startedAt > EDGE_DEADLINE_MS;
}

async function fetchFinnhubRange(from: string, to: string, apiKey: string): Promise<any[]> {
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  const out: any[] = [];
  let cur = new Date(fromD);
  while (cur <= toD) {
    const chunkEnd = new Date(Math.min(cur.getTime() + 29 * 86400_000, toD.getTime()));
    const f = isoDate(cur);
    const t = isoDate(chunkEnd);
    try {
      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${f}&to=${t}&token=${apiKey}`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        const arr = Array.isArray(j?.earningsCalendar) ? j.earningsCalendar : [];
        out.push(...arr);
      } else {
        console.error("Finnhub earnings calendar error", res.status, await res.text().catch(() => ""));
      }
    } catch (e) {
      console.error("Finnhub earnings calendar failed", e);
    }
    cur = new Date(chunkEnd.getTime() + 86400_000);
    await sleep(120);
  }
  return out;
}

async function fetchFinnhubProfileOne(sym: string, apiKey: string): Promise<Profile | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${apiKey}`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) { await sleep(1200 + attempt * 900); continue; }
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      if (!j || !j.name) return null;
      const mcRaw = finiteNumber(j.marketCapitalization);
      return {
        mcap: mcRaw && mcRaw > 0 ? mcRaw * 1_000_000 : null,
        sector: j.finnhubIndustry ?? j.sector ?? null,
        name: j.name ?? null,
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchFmpProfileOne(sym: string, apiKey: string): Promise<Profile | null> {
  try {
    const url = `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(sym)}&apikey=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const arr = await res.json().catch(() => null);
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) return null;
    return {
      mcap: finiteNumber(p.marketCap),
      sector: p.sector ?? p.industry ?? null,
      name: p.companyName ?? p.name ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchProfiles(symbols: string[], finnhubKey: string, fmpKey: string | null): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const sym = symbols[idx++];
      let p = await fetchFinnhubProfileOne(sym, finnhubKey);
      if ((!p || p.mcap === null) && fmpKey) {
        const fmp = await fetchFmpProfileOne(sym, fmpKey);
        if (fmp) p = fmp;
      }
      if (p) out.set(sym.toUpperCase(), p);
      await sleep(180);
    }
  }
  await Promise.all(Array.from({ length: PROFILE_CONCURRENCY }, () => worker()));
  return out;
}

async function fetchFinnhubDaily(symbol: string, fromTs: number, toTs: number, apiKey: string): Promise<{ bars: DailyBar[]; restricted: boolean }> {
  try {
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${fromTs}&to=${toTs}&token=${apiKey}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 403 || res.status === 429) return { bars: [], restricted: true };
    if (!res.ok) return { bars: [], restricted: false };
    const j = await res.json().catch(() => null);
    if (!j || j.s !== "ok") return { bars: [], restricted: false };
    const ts: number[] = j.t ?? [];
    const opens: number[] = j.o ?? [];
    const closes: number[] = j.c ?? [];
    const out: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = finiteNumber(opens[i]);
      const c = finiteNumber(closes[i]);
      if (o === null || c === null || o <= 0 || c <= 0) continue;
      out.push({ date: isoDate(new Date(ts[i] * 1000)), open: o, close: c });
    }
    return { bars: out, restricted: false };
  } catch {
    return { bars: [], restricted: false };
  }
}

async function fetchYahooDailyFallback(symbol: string, fromTs: number, toTs: number): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${fromTs}&period2=${toTs}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return [];
    const j = await res.json().catch(() => null);
    const r = j?.chart?.result?.[0];
    if (!r) return [];
    const ts: number[] = r.timestamp ?? [];
    const quote = r.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = quote.open ?? [];
    const closes: (number | null)[] = quote.close ?? [];
    const out: DailyBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = finiteNumber(opens[i]);
      const c = finiteNumber(closes[i]);
      if (o === null || c === null || o <= 0 || c <= 0) continue;
      out.push({ date: isoDate(new Date(ts[i] * 1000)), open: o, close: c });
    }
    return out;
  } catch {
    return [];
  }
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
        temperature: 0.35,
        messages: [
          { role: "system", content: "You are a sharp equity research analyst. Be concise, specific, and never fabricate facts." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return j?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
    const FMP_API_KEY = Deno.env.get("FMP_API_KEY");
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
    if (!FINNHUB_API_KEY) return jsonResponse({ error: "FINNHUB_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const lookbackDays = Math.min(120, Math.max(7, Number(body?.lookbackDays ?? 60)));
    const minGapPct = Math.max(3, Number(body?.minGapPct ?? 10));
    const minMarketCap = Math.max(0, Number(body?.minMarketCap ?? 1_000_000_000));
    const universeFilter: string[] | null = Array.isArray(body?.universe) && body.universe.length > 0
      ? body.universe.map((s: any) => String(s).toUpperCase()).filter(isUsLikeSymbol)
      : null;
    const enableAi = body?.enableAi !== false;
    const maxAiRows = Math.min(15, Math.max(0, Number(body?.maxAiRows ?? 10)));

    const today = new Date();
    const from = new Date(today.getTime() - lookbackDays * 86400_000);
    const fromStr = isoDate(from);
    const toStr = isoDate(today);

    const cal = await fetchFinnhubRange(fromStr, toStr, FINNHUB_API_KEY);
    const seen = new Set<string>();
    const universe = universeFilter ? new Set(universeFilter) : null;
    const reports: Report[] = cal
      .map((r: any) => ({
        symbol: String(r?.symbol || "").toUpperCase(),
        date: String(r?.date || "").slice(0, 10),
        time: mapTime(r?.hour),
        epsEst: finiteNumber(r?.epsEstimate),
        epsAct: finiteNumber(r?.epsActual),
        revEst: finiteNumber(r?.revenueEstimate),
        revAct: finiteNumber(r?.revenueActual),
      }))
      .filter((r) => {
        if (!r.symbol || !r.date || !isUsLikeSymbol(r.symbol)) return false;
        if (universe && !universe.has(r.symbol)) return false;
        const k = `${r.symbol}|${r.date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    if (reports.length === 0) {
      return jsonResponse({ from: fromStr, to: toStr, total: 0, rows: [], diagnostics: { reports: 0 } });
    }

    const bySymbol = new Map<string, Report[]>();
    for (const r of reports) {
      const arr = bySymbol.get(r.symbol) ?? [];
      arr.push(r);
      bySymbol.set(r.symbol, arr);
    }

    const symbolsToScan = Array.from(bySymbol.keys()).slice(0, universe ? Math.max(MAX_SYMBOLS_TO_SCAN, bySymbol.size) : MAX_SYMBOLS_TO_SCAN);
    const fromTs = Math.floor(from.getTime() / 1000) - 10 * 86400;
    const toTs = Math.floor(today.getTime() / 1000) + 2 * 86400;
    const rawGappers: Gapper[] = [];
    let finnhubBars = 0;
    let yahooBars = 0;
    let noBars = 0;
    let finnhubCandlesRestricted = false;
    let idx = 0;

    async function barWorker() {
      while (idx < symbolsToScan.length && !deadlineExceeded(startedAt)) {
        const symbol = symbolsToScan[idx++];
        let bars: DailyBar[] = [];
        if (!finnhubCandlesRestricted) {
          const fh = await fetchFinnhubDaily(symbol, fromTs, toTs, FINNHUB_API_KEY);
          if (fh.restricted) finnhubCandlesRestricted = true;
          bars = fh.bars;
          if (bars.length >= 2) finnhubBars++;
        }
        if (bars.length < 2) {
          bars = await fetchYahooDailyFallback(symbol, fromTs, toTs);
          if (bars.length >= 2) yahooBars++;
        }
        if (bars.length < 2) { noBars++; continue; }

        for (const r of bySymbol.get(symbol) ?? []) {
          const reportIdx = bars.findIndex((b) => b.date === r.date);
          if (reportIdx < 0) continue;

          let prevClose: number | null = null;
          let openPrice: number | null = null;
          if (r.time === "BMO") {
            if (reportIdx === 0) continue;
            prevClose = bars[reportIdx - 1].close;
            openPrice = bars[reportIdx].open;
          } else {
            if (reportIdx >= bars.length - 1) continue;
            prevClose = bars[reportIdx].close;
            openPrice = bars[reportIdx + 1].open;
          }
          if (!prevClose || !openPrice || prevClose <= 0 || openPrice <= 0) continue;
          const gap = ((openPrice - prevClose) / prevClose) * 100;
          if (gap < minGapPct) continue;

          const epsSurprise = (r.epsEst !== null && r.epsAct !== null && Math.abs(r.epsEst) > 0.01)
            ? ((r.epsAct - r.epsEst) / Math.abs(r.epsEst)) * 100 : null;
          const revSurprise = (r.revEst !== null && r.revAct !== null && r.revEst > 0)
            ? ((r.revAct - r.revEst) / r.revEst) * 100 : null;

          rawGappers.push({
            symbol,
            company: null,
            reportDate: r.date,
            reportTime: r.time,
            gapPct: rounded(gap, 2),
            prevClose: rounded(prevClose, 2),
            openPrice: rounded(openPrice, 2),
            marketCap: null,
            sector: null,
            epsEstimate: r.epsEst,
            epsActual: r.epsAct,
            epsSurprisePct: epsSurprise !== null ? rounded(epsSurprise, 1) : null,
            revenueEstimate: r.revEst,
            revenueActual: r.revAct,
            revenueSurprisePct: revSurprise !== null ? rounded(revSurprise, 1) : null,
            rsRating: null,
          });
        }
      }
    }

    await Promise.all(Array.from({ length: BAR_CONCURRENCY }, () => barWorker()));

    rawGappers.sort((a, b) => b.gapPct - a.gapPct);
    const profileSymbols = Array.from(new Set(rawGappers.slice(0, 160).map((g) => g.symbol)));
    const profiles = await fetchProfiles(profileSymbols, FINNHUB_API_KEY, FMP_API_KEY ?? null);

    const gappers = rawGappers
      .map((g) => {
        const p = profiles.get(g.symbol);
        return {
          ...g,
          company: p?.name ?? null,
          marketCap: p?.mcap ?? null,
          sector: p?.sector ?? null,
        };
      })
      .filter((g) => g.marketCap === null ? minMarketCap === 0 : g.marketCap >= minMarketCap)
      .slice(0, 80);

    if (enableAi && GROQ_API_KEY && maxAiRows > 0 && gappers.length > 0) {
      const top = gappers.slice(0, maxAiRows);
      let aiIdx = 0;
      async function aiWorker() {
        while (aiIdx < top.length && !deadlineExceeded(startedAt)) {
          const g = top[aiIdx++];
          g.aiAnalysis = await groqSummarize(g, GROQ_API_KEY);
          await sleep(120);
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, top.length) }, () => aiWorker()));
    }

    const candleSource = finnhubBars > 0 && yahooBars === 0 ? "finnhub" : yahooBars > 0 && finnhubBars === 0 ? "yahoo" : finnhubBars > 0 && yahooBars > 0 ? "mixed" : "none";

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
      diagnostics: {
        reports: reports.length,
        symbolsScanned: symbolsToScan.length,
        rawGapMatches: rawGappers.length,
        finnhubBars,
        yahooBars,
        noBars,
        finnhubCandlesRestricted,
        partial: deadlineExceeded(startedAt),
      },
    });
  } catch (e) {
    console.error("earnings-historical-gappers error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "internal_error", rows: [] }, 500);
  }
});
