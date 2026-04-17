import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getHistoricalData, YahooPeriod } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PERIODS: YahooPeriod[] = ["1mo", "3mo", "6mo"];
const BATCH_PER_INVOCATION = 30; // symbols per invocation

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

    // 2. Get SPY returns via shared helper (cache → Yahoo)
    const spyReturns: Record<string, number | null> = {};
    for (const period of PERIODS) {
      const r = await getHistoricalData(supabase, "SPY", period);
      spyReturns[period] = r.returnPct;
    }

    // 3. Get 1D returns from ticker_performance for batch
    const symbols = universe.map((u) => u.symbol);
    const { data: perfRows } = await supabase
      .from("ticker_performance")
      .select("symbol, perf_1d, price")
      .in("symbol", symbols);
    const perf1dMap = new Map<string, { perf1d: number | null; price: number | null }>();
    for (const p of perfRows ?? []) {
      perf1dMap.set(p.symbol, { perf1d: p.perf_1d, price: p.price });
    }

    // 1D for SPY: prefer ticker_performance, fall back to Yahoo 5d (last two closes)
    const { data: spyPerf } = await supabase
      .from("ticker_performance")
      .select("perf_1d")
      .eq("symbol", "SPY")
      .maybeSingle();
    let spy1d: number | null = (spyPerf?.perf_1d ?? null) !== null && spyPerf?.perf_1d !== 0
      ? Number(spyPerf?.perf_1d)
      : null;
    if (spy1d === null) {
      const spyHist = await getHistoricalData(supabase, "SPY", "5d");
      const closes = (spyHist.ohlc ?? []).map(b => b.close).filter((c): c is number => c !== null);
      if (closes.length >= 2) {
        const prev = closes[closes.length - 2];
        const last = closes[closes.length - 1];
        if (prev > 0) spy1d = Math.round(((last - prev) / prev) * 10000) / 100;
      }
    }
    if (spy1d === null) spy1d = 0;

    // Helper: Yahoo 5d fallback for a single symbol's 1D return
    async function yahoo1dReturn(sym: string, todayPrice: number | null): Promise<number | null> {
      const hist = await getHistoricalData(supabase, sym, "5d", { todayPrice });
      const closes = (hist.ohlc ?? []).map(b => b.close).filter((c): c is number => c !== null);
      if (closes.length < 2) return null;
      const prev = closes[closes.length - 2];
      const last = closes[closes.length - 1];
      if (!prev || prev <= 0) return null;
      return Math.round(((last - prev) / prev) * 10000) / 100;
    }

    // 4. For each stock: get 1M/3M/6M returns via shared helper (cache → Yahoo)
    const updates: any[] = [];
    for (const u of universe) {
      const sym = u.symbol;
      const periodReturns: Record<string, number | null> = {};

      for (const period of PERIODS) {
        const r = await getHistoricalData(supabase, sym, period, { todayPrice: u.current_price ?? null });
        periodReturns[period] = r.returnPct;
      }

      // 1D return: ticker_performance first, Yahoo 5d fallback for missing/zero rows
      const perfRow = perf1dMap.get(sym);
      let r1d: number | null = (perfRow?.perf1d ?? null) !== null && perfRow?.perf1d !== 0
        ? Number(perfRow!.perf1d)
        : null;
      if (r1d === null) {
        r1d = await yahoo1dReturn(sym, u.current_price ?? null);
      }

      const r1m = periodReturns["1mo"];
      const r3m = periodReturns["3mo"];
      const r6m = periodReturns["6mo"];

      const rs1d = r1d !== null && spy1d !== null ? Math.round((r1d - spy1d) * 100) / 100 : null;
      const rs1m = r1m !== null && spyReturns["1mo"] !== null ? Math.round((r1m - spyReturns["1mo"]!) * 100) / 100 : null;
      const rs3m = r3m !== null && spyReturns["3mo"] !== null ? Math.round((r3m - spyReturns["3mo"]!) * 100) / 100 : null;
      const rs6m = r6m !== null && spyReturns["6mo"] !== null ? Math.round((r6m - spyReturns["6mo"]!) * 100) / 100 : null;

      // Dynamic weighted overall (1M/3M/6M only — 1D excluded from Overall)
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
        return_1d: r1d, return_1m: r1m, return_3m: r3m, return_6m: r6m,
        spy_return_1d: spy1d,
        spy_return_1m: spyReturns["1mo"], spy_return_3m: spyReturns["3mo"], spy_return_6m: spyReturns["6mo"],
        rs_1d: rs1d, rs_1m: rs1m, rs_3m: rs3m, rs_6m: rs6m,
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
