// analyze-setup-catalysts
// Given a list of symbols, returns per-symbol catalyst signals:
//   - newsCount7d      (number of headlines last 7 days)
//   - upgradeSignal    (-1..+1 — analyst recommendation trend vs prior month)
//   - earningsInDays   (days until next earnings, or null)
//   - sentiment        (0..100 — AI-scored sentiment over recent headlines, or null)
//   - topHeadline      (most recent headline for hover/context)
//
// All data is fetched live from Finnhub. No DB writes. Pure compute.
// Designed to be called once per Setup Analyzer run (on-demand, no persistence).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoDateNDaysAhead(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface CatalystRow {
  symbol: string;
  newsCount7d: number;
  upgradeSignal: number; // -1..1
  earningsInDays: number | null;
  sentiment: number | null; // 0..100
  topHeadline: string | null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getSymbolSignals(symbol: string): Promise<{
  row: CatalystRow;
  headlines: string[];
}> {
  const row: CatalystRow = {
    symbol,
    newsCount7d: 0,
    upgradeSignal: 0,
    earningsInDays: null,
    sentiment: null,
    topHeadline: null,
  };

  if (!FINNHUB_KEY) return { row, headlines: [] };

  const from7 = isoDateNDaysAgo(7);
  const today = isoDateNDaysAgo(0);
  const ahead30 = isoDateNDaysAhead(30);

  const [news, rec, earnings] = await Promise.all([
    fetchJson(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from7}&to=${today}&token=${FINNHUB_KEY}`,
    ),
    fetchJson(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
    ),
    fetchJson(
      `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${ahead30}&symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
    ),
  ]);

  // News
  const headlines: string[] = [];
  if (Array.isArray(news)) {
    row.newsCount7d = news.length;
    for (const n of news.slice(0, 8)) {
      const h = String(n?.headline || "").trim();
      if (h) headlines.push(h);
    }
    if (headlines.length > 0) row.topHeadline = headlines[0];
  }

  // Recommendation trend — compare most recent month vs prior month
  if (Array.isArray(rec) && rec.length >= 1) {
    const cur = rec[0];
    const prev = rec[1] ?? null;
    const score = (r: any) =>
      (Number(r?.strongBuy) || 0) * 2 +
      (Number(r?.buy) || 0) -
      (Number(r?.sell) || 0) -
      (Number(r?.strongSell) || 0) * 2;
    const curScore = score(cur);
    const prevScore = prev ? score(prev) : curScore;
    const diff = curScore - prevScore;
    // Normalize: each +1 analyst-upgrade ≈ 0.15 signal, clamp -1..1
    row.upgradeSignal = Math.max(-1, Math.min(1, diff * 0.15));
  }

  // Earnings
  const evs = earnings?.earningsCalendar;
  if (Array.isArray(evs) && evs.length > 0) {
    const dates = evs
      .map((e: any) => e?.date)
      .filter(Boolean)
      .map((d: string) => Date.parse(d + "T12:00:00Z"))
      .filter((n: number) => Number.isFinite(n));
    if (dates.length > 0) {
      const next = Math.min(...dates);
      const days = Math.round((next - Date.now()) / (24 * 60 * 60 * 1000));
      if (days >= 0 && days <= 30) row.earningsInDays = days;
    }
  }

  return { row, headlines };
}

async function scoreSentimentBatch(
  perSymbol: Array<{ symbol: string; headlines: string[] }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!LOVABLE_API_KEY) return result;
  const withNews = perSymbol.filter((p) => p.headlines.length > 0);
  if (withNews.length === 0) return result;

  const prompt = `Score the news sentiment for each ticker on a 0-100 scale where:
0-30 = clearly bearish (downgrades, missed earnings, lawsuits, layoffs, guidance cuts)
40-60 = neutral / mixed / no clear signal
70-100 = clearly bullish (upgrades, beats, new contracts, breakouts, buyouts)

Return ONLY compact JSON: { "<TICKER>": <number>, ... }. No commentary.

${withNews.map((p) => `${p.symbol}:\n - ${p.headlines.slice(0, 6).join("\n - ")}`).join("\n\n")}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a terse financial sentiment scorer. Output JSON only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return result;
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(txt);
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n)) result.set(String(k).toUpperCase(), Math.max(0, Math.min(100, n)));
    }
  } catch {
    /* swallow; sentiment is optional */
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const rawSymbols: unknown = body?.symbols;
    if (!Array.isArray(rawSymbols)) return jsonResponse({ error: "symbols[] required" }, 400);

    const symbols = Array.from(
      new Set(
        rawSymbols
          .map((s) => String(s || "").toUpperCase().trim())
          .filter((s) => /^[A-Z0-9.\-]{1,8}$/.test(s)),
      ),
    ).slice(0, 100);

    if (symbols.length === 0) return jsonResponse({ rows: [] });

    // Fetch per-symbol signals with limited concurrency
    const CONCURRENCY = 5;
    const rows: CatalystRow[] = [];
    const headlinesBySymbol: Array<{ symbol: string; headlines: string[] }> = [];

    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      const out = await Promise.all(batch.map((s) => getSymbolSignals(s)));
      for (const { row, headlines } of out) {
        rows.push(row);
        headlinesBySymbol.push({ symbol: row.symbol, headlines });
      }
      // Light pacing to stay polite with Finnhub
      if (i + CONCURRENCY < symbols.length) await sleep(250);
    }

    // Batched AI sentiment (one call, optional)
    const sentimentMap = await scoreSentimentBatch(headlinesBySymbol);
    for (const r of rows) {
      const s = sentimentMap.get(r.symbol);
      if (typeof s === "number") r.sentiment = s;
    }

    return jsonResponse({ rows });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err), rows: [] },
      200,
    );
  }
});
