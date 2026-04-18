import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getHistoricalData, HistoricalResult, YahooPeriod } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PERIODS: YahooPeriod[] = ["5d", "1mo", "3mo", "6mo"];
const BATCH_PER_INVOCATION = 15;
const HISTORY_BATCH_SIZE = 5;
const LIVE_SCAN_MAX_AGE_MS = 18 * 60 * 60 * 1000;

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function isFreshScan(lastScanned: string | null | undefined): boolean {
  if (!lastScanned) return false;
  const scannedAt = new Date(lastScanned).getTime();
  if (!Number.isFinite(scannedAt)) return false;
  return Date.now() - scannedAt <= LIVE_SCAN_MAX_AGE_MS;
}

function derive1dReturn(history: HistoricalResult | undefined): number | null {
  const closes = (history?.ohlc ?? [])
    .map((bar) => bar.close)
    .filter((close): close is number => close !== null);

  if (closes.length < 2) return null;
  const prev = closes[closes.length - 2];
  const last = closes[closes.length - 1];
  if (!prev || prev <= 0) return null;
  return Math.round(((last - prev) / prev) * 10000) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    const body = await req.json().catch(() => ({}));
    const offset: number = body.offset ?? 0;

    // 1. Load qualified universe (paged)
    const { data: universe, count } = await supabase
      .from("qualified_rs_universe")
      .select("symbol, current_price", { count: "exact" })
      .order("symbol")
      .range(offset, offset + BATCH_PER_INVOCATION - 1);

    if (!universe || universe.length === 0) {
      return new Response(
        JSON.stringify({ done: true, processed: offset, total: count ?? 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const symbols = universe.map((u) => u.symbol);
    const historySymbols = [...symbols, "SPY"];

    await supabase
      .from("yahoo_history_cache")
      .delete()
      .in("symbol", historySymbols)
      .in("period", PERIODS);

    const { data: perfRows } = await supabase
      .from("ticker_performance")
      .select("symbol, perf_1d, price, last_scanned")
      .in("symbol", historySymbols);

    const perfMap = new Map<string, { perf1d: number | null; price: number | null; lastScanned: string | null }>();
    for (const row of perfRows ?? []) {
      perfMap.set(row.symbol, {
        perf1d: toNumberOrNull(row.perf_1d),
        price: toNumberOrNull(row.price),
        lastScanned: row.last_scanned,
      });
    }

    const historyBySymbol = new Map<string, Record<YahooPeriod, HistoricalResult>>();
    for (const sym of historySymbols) {
      historyBySymbol.set(sym, {} as Record<YahooPeriod, HistoricalResult>);
    }

    for (let i = 0; i < historySymbols.length; i += HISTORY_BATCH_SIZE) {
      const slice = historySymbols.slice(i, i + HISTORY_BATCH_SIZE);
      const periodResults = await Promise.all(
        PERIODS.map((period) =>
          Promise.all(
            slice.map(async (sym) => ({
              sym,
              period,
              result: await getHistoricalData(supabase, sym, period, {
                skipCache: true,
                skipEod: true,
              }),
            })),
          ),
        ),
      );

      for (const periodGroup of periodResults) {
        for (const { sym, period, result } of periodGroup) {
          historyBySymbol.get(sym)![period] = result;
        }
      }
    }

    const history5d = Object.fromEntries(historySymbols.map((sym) => [sym, historyBySymbol.get(sym)?.["5d"]])) as Record<string, HistoricalResult | undefined>;
    const history1m = Object.fromEntries(historySymbols.map((sym) => [sym, historyBySymbol.get(sym)?.["1mo"]])) as Record<string, HistoricalResult | undefined>;
    const history3m = Object.fromEntries(historySymbols.map((sym) => [sym, historyBySymbol.get(sym)?.["3mo"]])) as Record<string, HistoricalResult | undefined>;
    const history6m = Object.fromEntries(historySymbols.map((sym) => [sym, historyBySymbol.get(sym)?.["6mo"]])) as Record<string, HistoricalResult | undefined>;

    const spyPerf = perfMap.get("SPY");
    const spyFresh1d = isFreshScan(spyPerf?.lastScanned)
      ? spyPerf?.perf1d ?? null
      : null;
    const spy1d = spyFresh1d ?? derive1dReturn(history5d.SPY) ?? 0;
    const spyReturns: Record<string, number | null> = {
      "5d": history5d.SPY?.returnPct ?? null,
      "1mo": history1m.SPY?.returnPct ?? null,
      "3mo": history3m.SPY?.returnPct ?? null,
      "6mo": history6m.SPY?.returnPct ?? null,
    };

    const updates: any[] = [];
    for (const u of universe) {
      const sym = u.symbol;
      const perfRow = perfMap.get(sym);
      const weeklyHistory = history5d[sym];
      const monthlyHistory = history1m[sym];
      const quarterlyHistory = history3m[sym];
      const semiAnnualHistory = history6m[sym];

      const freshPerf1d = isFreshScan(perfRow?.lastScanned)
        ? perfRow?.perf1d ?? null
        : null;

      const r1d = freshPerf1d ?? derive1dReturn(weeklyHistory);
      const r1w = weeklyHistory?.returnPct ?? null;
      const r1m = monthlyHistory?.returnPct ?? null;
      const r3m = quarterlyHistory?.returnPct ?? null;
      const r6m = semiAnnualHistory?.returnPct ?? null;
      const freshPrice = isFreshScan(perfRow?.lastScanned)
        ? perfRow?.price ?? null
        : null;
      const latestPrice =
        freshPrice ??
        toNumberOrNull(weeklyHistory?.endPrice) ??
        toNumberOrNull(monthlyHistory?.endPrice) ??
        perfRow?.price ??
        toNumberOrNull(u.current_price);

      const rs1d = r1d !== null && spy1d !== null ? Math.round((r1d - spy1d) * 100) / 100 : null;
      const rs1w = r1w !== null && spyReturns["5d"] !== null ? Math.round((r1w - spyReturns["5d"]!) * 100) / 100 : null;
      const rs1m = r1m !== null && spyReturns["1mo"] !== null ? Math.round((r1m - spyReturns["1mo"]!) * 100) / 100 : null;
      const rs3m = r3m !== null && spyReturns["3mo"] !== null ? Math.round((r3m - spyReturns["3mo"]!) * 100) / 100 : null;
      const rs6m = r6m !== null && spyReturns["6mo"] !== null ? Math.round((r6m - spyReturns["6mo"]!) * 100) / 100 : null;

      // Dynamic weighted overall (1M/3M/6M only — 1D and 1W excluded from default Overall)
      const parts: { v: number; w: number }[] = [];
      if (rs1m !== null) parts.push({ v: rs1m, w: 0.5 });
      if (rs3m !== null) parts.push({ v: rs3m, w: 0.3 });
      if (rs6m !== null) parts.push({ v: rs6m, w: 0.2 });
      let rsOverall: number | null = null;
      if (parts.length > 0) {
        const tw = parts.reduce((s, p) => s + p.w, 0);
        rsOverall = Math.round(parts.reduce((s, p) => s + p.v * (p.w / tw), 0) * 100) / 100;
      }

      updates.push({
        symbol: sym,
        current_price: latestPrice,
        return_1d: r1d, return_1w: r1w, return_1m: r1m, return_3m: r3m, return_6m: r6m,
        spy_return_1d: spy1d,
        spy_return_1w: spyReturns["5d"],
        spy_return_1m: spyReturns["1mo"], spy_return_3m: spyReturns["3mo"], spy_return_6m: spyReturns["6mo"],
        rs_1d: rs1d, rs_1w: rs1w, rs_1m: rs1m, rs_3m: rs3m, rs_6m: rs6m,
        rs_overall: rsOverall,
        rs_calculated_at: new Date().toISOString(),
      });
    }

    if (updates.length > 0) {
      const { error: upErr } = await supabase.from("qualified_rs_universe").upsert(updates, { onConflict: "symbol" });
      if (upErr) console.error("Upsert error:", upErr);
    }

    const nextOffset = offset + universe.length;
    const done = nextOffset >= (count ?? 0);

    return new Response(
      JSON.stringify({
        done,
        processed: nextOffset,
        total: count ?? 0,
        next_offset: done ? null : nextOffset,
        batch_size: universe.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("calculate-rs-scores error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
