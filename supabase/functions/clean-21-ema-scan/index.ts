import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 8;
const MAX_SYMBOLS = 600;
const DEADLINE_MS = 125_000;
const EMA_LENGTHS = new Set([9, 21, 50, 200]);

type EmaTimeframe = "daily" | "weekly";

interface OHLCBar {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface ResultRow {
  symbol: string;
  qualifies: boolean;
  gainPct: number | null;
  latestClose: number | null;
  startClose: number | null;
  ema21: number | null;
  emaValue: number | null;
  emaLength: number;
  timeframe: EmaTimeframe;
  daysWithoutBelow: number;
  periodsWithoutBelow: number;
  source: "cache" | "yahoo" | "none";
  error?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function finiteNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function normalizeNumber(raw: unknown, fallback: number, min: number, max: number) {
  const n = Math.round(Number(raw ?? fallback));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

function normalizeEmaLength(raw: unknown): number {
  const n = Math.round(Number(raw ?? 21));
  return EMA_LENGTHS.has(n) ? n : 21;
}

function normalizeTimeframe(raw: unknown): EmaTimeframe {
  return raw === "weekly" ? "weekly" : "daily";
}

function computeEmaSeries(closes: number[], length: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < length) return out;
  const k = 2 / (length + 1);
  let ema = closes.slice(0, length).reduce((sum, v) => sum + v, 0) / length;
  out[length - 1] = ema;
  for (let i = length; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const weekNum = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function toWeeklyBars(dailyBars: OHLCBar[]): OHLCBar[] {
  const byWeek = new Map<string, OHLCBar>();
  const order: string[] = [];
  for (const bar of dailyBars) {
    if (!bar.ts || bar.close === null || !Number.isFinite(bar.close) || (bar.close as number) <= 0) continue;
    const key = isoWeekKey(new Date(bar.ts * 1000));
    const existing = byWeek.get(key);
    if (!existing) {
      byWeek.set(key, { ...bar });
      order.push(key);
    } else {
      existing.high = existing.high === null || bar.high === null ? existing.high ?? bar.high : Math.max(existing.high, bar.high);
      existing.low = existing.low === null || bar.low === null ? existing.low ?? bar.low : Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume = (existing.volume ?? 0) + (bar.volume ?? 0);
      existing.ts = bar.ts;
    }
  }
  return order.map((key) => byWeek.get(key)!).filter(Boolean);
}

function emptyRow(symbol: string, source: ResultRow["source"], emaLength: number, timeframe: EmaTimeframe, error: string): ResultRow {
  return {
    symbol,
    qualifies: false,
    gainPct: null,
    latestClose: null,
    startClose: null,
    ema21: null,
    emaValue: null,
    emaLength,
    timeframe,
    daysWithoutBelow: 0,
    periodsWithoutBelow: 0,
    source,
    error,
  };
}

function computeRow(
  symbol: string,
  rawBars: OHLCBar[],
  minGainPct: number,
  minPeriod: number,
  emaLength: number,
  timeframe: EmaTimeframe,
  source: ResultRow["source"],
): ResultRow {
  const dailyBars = rawBars
    .filter((bar) => bar.ts && bar.close !== null && Number.isFinite(bar.close) && (bar.close as number) > 0)
    .sort((a, b) => a.ts - b.ts);
  const bars = timeframe === "weekly" ? toWeeklyBars(dailyBars) : dailyBars;
  const requiredBars = minPeriod + emaLength;
  if (bars.length < requiredBars) {
    return emptyRow(symbol, source, emaLength, timeframe, "insufficient_history");
  }

  const closes = bars.map((bar) => bar.close as number);
  const ema = computeEmaSeries(closes, emaLength);
  const startIdx = closes.length - minPeriod;
  let clean = true;
  for (let i = startIdx; i < closes.length; i++) {
    const e = ema[i];
    if (e === null || closes[i] < e) { clean = false; break; }
  }

  let daysWithoutBelow = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    const e = ema[i];
    if (e === null || closes[i] < e) break;
    daysWithoutBelow++;
  }

  const startClose = closes[startIdx];
  const latestClose = closes[closes.length - 1];
  const gainPct = startClose > 0 ? Math.round(((latestClose - startClose) / startClose) * 1000) / 10 : null;
  const emaValue = ema[ema.length - 1];
  const qualifies = clean && gainPct !== null && gainPct >= minGainPct;
  const periodMultiplier = timeframe === "weekly" ? 5 : 1;
  return {
    symbol,
    qualifies,
    gainPct,
    latestClose: Math.round(latestClose * 100) / 100,
    startClose: Math.round(startClose * 100) / 100,
    ema21: emaValue !== null ? Math.round(emaValue * 100) / 100 : null,
    emaValue: emaValue !== null ? Math.round(emaValue * 100) / 100 : null,
    emaLength,
    timeframe,
    daysWithoutBelow: timeframe === "weekly" ? daysWithoutBelow * periodMultiplier : daysWithoutBelow,
    periodsWithoutBelow: daysWithoutBelow,
    source,
  };
}

function requiredDailyBars(emaLength: number, minPeriod: number, timeframe: EmaTimeframe) {
  return timeframe === "weekly" ? (emaLength + minPeriod) * 5 + 10 : emaLength + minPeriod;
}

function rangeFor(requiredBars: number): "6mo" | "1y" | "2y" | "5y" {
  if (requiredBars <= 126) return "6mo";
  if (requiredBars <= 252) return "1y";
  if (requiredBars <= 504) return "2y";
  return "5y";
}

async function fetchYahoo(symbol: string, range: "6mo" | "1y" | "2y" | "5y"): Promise<OHLCBar[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const opens: (number | null)[] = q.open ?? [];
    const highs: (number | null)[] = q.high ?? [];
    const lows: (number | null)[] = q.low ?? [];
    const closes: (number | null)[] = q.close ?? [];
    const vols: (number | null)[] = q.volume ?? [];
    const bars = ts.map((t, i) => ({
      ts: t,
      open: finiteNumber(opens[i]),
      high: finiteNumber(highs[i]),
      low: finiteNumber(lows[i]),
      close: finiteNumber(closes[i]),
      volume: finiteNumber(vols[i]),
    })).filter((bar) => bar.close !== null);
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = sanitize(body?.symbols);
    const minGainPct = normalizeNumber(body?.minGainPct, 70, 0, 500);
    const emaLength = normalizeEmaLength(body?.emaLength);
    const timeframe = normalizeTimeframe(body?.timeframe);
    const minDefault = timeframe === "weekly" ? 12 : 60;
    const minPeriod = normalizeNumber(body?.minPeriod ?? body?.minDays, minDefault, timeframe === "weekly" ? 1 : 5, timeframe === "weekly" ? 260 : 504);
    if (symbols.length === 0) return json({ error: "symbols[] required", rows: [] }, 400);

    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_KEY) return json({ error: "Backend not configured", rows: [] }, 500);
    const sb = createClient(SB_URL, SB_KEY);

    const rows = new Map<string, ResultRow>();
    const cacheHits = new Map<string, OHLCBar[]>();
    const minBarsNeeded = requiredDailyBars(emaLength, minPeriod, timeframe);
    const preferredRange = rangeFor(minBarsNeeded);
    const periods = preferredRange === "6mo"
      ? ["6mo", "1y", "2y", "5y"] as const
      : preferredRange === "1y"
        ? ["1y", "2y", "5y"] as const
        : preferredRange === "2y"
          ? ["2y", "5y"] as const
          : ["5y"] as const;

    for (const period of periods) {
      const missing = symbols.filter((s) => !cacheHits.has(s));
      if (missing.length === 0) break;
      for (let i = 0; i < missing.length; i += 500) {
        const slice = missing.slice(i, i + 500);
        const { data } = await sb
          .from("yahoo_history_cache")
          .select("symbol, ohlc")
          .eq("period", period)
          .gte("fetched_at", new Date(Date.now() - CACHE_MAX_AGE_MS).toISOString())
          .in("symbol", slice);
        for (const row of data ?? []) {
          if (!Array.isArray(row.ohlc)) continue;
          const ohlc = row.ohlc as OHLCBar[];
          if (ohlc.filter((bar) => bar.close !== null).length >= minBarsNeeded) {
            cacheHits.set(String(row.symbol).toUpperCase(), ohlc);
          }
        }
      }
    }

    for (const symbol of symbols) {
      const cached = cacheHits.get(symbol);
      if (cached?.length) rows.set(symbol, computeRow(symbol, cached, minGainPct, minPeriod, emaLength, timeframe, "cache"));
    }

    const missing = symbols.filter((symbol) => !rows.has(symbol));
    const range = preferredRange;
    let idx = 0;
    let fetched = 0;
    const worker = async () => {
      while (idx < missing.length && Date.now() - startedAt < DEADLINE_MS) {
        const symbol = missing[idx++];
        const ohlc = await fetchYahoo(symbol, range);
        if (!ohlc) {
          rows.set(symbol, emptyRow(symbol, "none", emaLength, timeframe, "no_history"));
          continue;
        }
        fetched++;
        rows.set(symbol, computeRow(symbol, ohlc, minGainPct, minPeriod, emaLength, timeframe, "yahoo"));
        const closes = ohlc.map((bar) => bar.close).filter((v): v is number => v !== null);
        const start = closes[0] ?? null;
        const end = closes[closes.length - 1] ?? null;
        const retPct = start && end ? Math.round(((end - start) / start) * 10000) / 100 : null;
        await sb.from("yahoo_history_cache").upsert({
          symbol,
          period: range,
          return_pct: retPct,
          start_price: start,
          end_price: end,
          ohlc,
          data_points: ohlc.length,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "symbol,period" });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, missing.length)) }, worker));

    const allRows = symbols.map((symbol) => rows.get(symbol) ?? {
      symbol,
      qualifies: false,
      gainPct: null,
      latestClose: null,
      startClose: null,
      ema21: null,
      emaValue: null,
      emaLength,
      timeframe,
      daysWithoutBelow: 0,
      periodsWithoutBelow: 0,
      source: "none" as const,
      error: "not_processed",
    });
    const qualifyingRows = allRows
      .filter((row) => row.qualifies && row.gainPct !== null)
      .sort((a, b) => (b.gainPct ?? -999) - (a.gainPct ?? -999));

    return json({
      total: symbols.length,
      minGainPct,
      minPeriod,
      emaLength,
      timeframe,
      cacheHits: cacheHits.size,
      fetched,
      partial: allRows.some((row) => row.error === "not_processed"),
      rows: qualifyingRows,
    });
  } catch (e) {
    console.error("clean-21-ema-scan error:", e);
    return json({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});