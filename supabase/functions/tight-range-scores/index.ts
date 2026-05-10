import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CONCURRENCY = 12;
const MAX_SYMBOLS = 1200;
const DEADLINE_MS = 125_000;

type Period = "3mo" | "6mo";

interface OHLCBar {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface ScoreRow {
  symbol: string;
  score: number | null;
  recentAvgRangePct: number | null;
  baselineAvgRangePct: number | null;
  ranges: number[];
  dataPoints: number;
  source: "cache" | "yahoo" | "none";
  error?: string;
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const symbol = String(raw || "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function normalizePeriods(shortRaw: unknown, longRaw: unknown) {
  let shortDays = Math.max(2, Math.min(40, Math.round(Number(shortRaw ?? 7))));
  let longDays = Math.max(10, Math.min(120, Math.round(Number(longRaw ?? 30))));
  if (shortDays >= longDays) shortDays = Math.max(2, longDays - 1);
  return { shortDays, longDays, period: longDays > 60 ? "6mo" as Period : "3mo" as Period };
}

function calcScore(symbol: string, bars: OHLCBar[], shortDays: number, longDays: number, source: ScoreRow["source"]): ScoreRow {
  const ranges = bars
    .filter((b) => b.high !== null && b.low !== null && b.close !== null && b.close > 0 && b.high >= b.low)
    .map((b) => Math.round((((b.high as number) - (b.low as number)) / (b.close as number)) * 10_000) / 100);

  if (ranges.length < Math.max(shortDays, Math.ceil(longDays * 0.6))) {
    return { symbol, score: null, recentAvgRangePct: null, baselineAvgRangePct: null, ranges: ranges.slice(-10), dataPoints: ranges.length, source, error: "insufficient_history" };
  }

  const recent = ranges.slice(-shortDays);
  const baseline = ranges.slice(-longDays);
  const avg = (arr: number[]) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  if (!Number.isFinite(recentAvg) || !Number.isFinite(baselineAvg) || baselineAvg <= 0) {
    return { symbol, score: null, recentAvgRangePct: null, baselineAvgRangePct: null, ranges: ranges.slice(-10), dataPoints: ranges.length, source, error: "invalid_range" };
  }

  return {
    symbol,
    score: Math.round((recentAvg / baselineAvg) * 100) / 100,
    recentAvgRangePct: Math.round(recentAvg * 100) / 100,
    baselineAvgRangePct: Math.round(baselineAvg * 100) / 100,
    ranges: ranges.slice(-10),
    dataPoints: ranges.length,
    source,
  };
}

async function fetchYahoo(symbol: string, period: Period): Promise<OHLCBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${period}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = q.open ?? [];
    const highs: (number | null)[] = q.high ?? [];
    const lows: (number | null)[] = q.low ?? [];
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];
    const ohlc: OHLCBar[] = ts.map((t, i) => ({
      ts: t,
      open: finiteNumber(opens[i]),
      high: finiteNumber(highs[i]),
      low: finiteNumber(lows[i]),
      close: finiteNumber(closes[i]),
      volume: finiteNumber(vols[i]),
    })).filter((b) => b.close !== null);
    return ohlc.length > 0 ? ohlc : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = sanitizeSymbols(body?.symbols);
    const { shortDays, longDays, period } = normalizePeriods(body?.shortDays, body?.longDays);
    if (symbols.length === 0) return jsonResponse({ error: "symbols[] required", rows: [] }, 400);

    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_KEY) return jsonResponse({ error: "Backend credentials not configured", rows: [] }, 500);
    const supabase = createClient(SB_URL, SB_KEY);

    const rows = new Map<string, ScoreRow>();
    const cacheMap = new Map<string, OHLCBar[]>();
    for (let i = 0; i < symbols.length; i += 500) {
      const slice = symbols.slice(i, i + 500);
      const { data } = await supabase
        .from("yahoo_history_cache")
        .select("symbol, ohlc, data_points, fetched_at")
        .eq("period", period)
        .gte("fetched_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .in("symbol", slice);
      for (const row of data ?? []) {
        if (Array.isArray(row.ohlc)) cacheMap.set(String(row.symbol).toUpperCase(), row.ohlc as OHLCBar[]);
      }
    }

    for (const symbol of symbols) {
      const cached = cacheMap.get(symbol);
      if (cached?.length) rows.set(symbol, calcScore(symbol, cached, shortDays, longDays, "cache"));
    }

    const missing = symbols.filter((symbol) => !rows.has(symbol));
    let idx = 0;
    let fetched = 0;
    async function worker() {
      while (idx < missing.length && Date.now() - startedAt < DEADLINE_MS) {
        const symbol = missing[idx++];
        const ohlc = await fetchYahoo(symbol, period);
        if (!ohlc) {
          rows.set(symbol, { symbol, score: null, recentAvgRangePct: null, baselineAvgRangePct: null, ranges: [], dataPoints: 0, source: "none", error: "no_history" });
          continue;
        }
        fetched++;
        rows.set(symbol, calcScore(symbol, ohlc, shortDays, longDays, "yahoo"));
        const closes = ohlc.map((bar) => bar.close).filter((v): v is number => v !== null);
        const start = closes[0] ?? null;
        const end = closes[closes.length - 1] ?? null;
        const returnPct = start && end ? Math.round(((end - start) / start) * 10000) / 100 : null;
        await supabase.from("yahoo_history_cache").upsert({
          symbol,
          period,
          return_pct: returnPct,
          start_price: start,
          end_price: end,
          ohlc,
          data_points: ohlc.length,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "symbol,period" });
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, () => worker()));

    const resultRows = symbols.map((symbol) => rows.get(symbol) ?? {
      symbol,
      score: null,
      recentAvgRangePct: null,
      baselineAvgRangePct: null,
      ranges: [],
      dataPoints: 0,
      source: "none" as const,
      error: "not_processed",
    });

    return jsonResponse({
      shortDays,
      longDays,
      period,
      total: symbols.length,
      scored: resultRows.filter((r) => r.score !== null).length,
      cacheHits: cacheMap.size,
      fetched,
      partial: resultRows.some((r) => r.error === "not_processed"),
      rows: resultRows,
    });
  } catch (e) {
    console.error("tight-range-scores error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});
