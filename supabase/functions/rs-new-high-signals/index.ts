import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getHistoricalData } from "../_shared/yahooHistory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_SYMBOLS = 300;
const HISTORY_BATCH_SIZE = 8;
const VALID_BENCHMARKS = new Set(["SPY", "QQQ"]);

const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const symbols = Array.from(new Set(
      (Array.isArray(body.symbols) ? body.symbols : [])
        .map((s: unknown) => String(s || "").trim().toUpperCase())
        .filter((s: string) => /^[A-Z0-9.-]{1,12}$/.test(s))
    )).slice(0, MAX_SYMBOLS);
    const benchmark = VALID_BENCHMARKS.has(String(body.benchmark || "SPY").toUpperCase())
      ? String(body.benchmark || "SPY").toUpperCase()
      : "SPY";
    const lookbackDays = Math.max(10, Math.min(252, Number(body.lookbackDays ?? 20)));

    if (symbols.length === 0) {
      return new Response(JSON.stringify({ rows: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const benchmarkHistory = await getHistoricalData(supabase, benchmark, "1y", { skipEod: true });
    const benchmarkByDate = new Map(
      (benchmarkHistory.ohlc ?? [])
        .filter((b) => isNum(b.close) && b.close > 0)
        .map((b) => [dayKey(b.ts), b.close as number])
    );

    const rows: unknown[] = [];
    for (let i = 0; i < symbols.length; i += HISTORY_BATCH_SIZE) {
      const slice = symbols.slice(i, i + HISTORY_BATCH_SIZE);
      const histories = await Promise.all(slice.map((symbol) => getHistoricalData(supabase, symbol, "1y", { skipEod: true })));

      for (const history of histories) {
        const paired = (history.ohlc ?? [])
          .map((bar) => {
            const benchClose = benchmarkByDate.get(dayKey(bar.ts));
            if (!isNum(bar.close) || bar.close <= 0 || !isNum(benchClose) || benchClose <= 0) return null;
            return {
              close: bar.close,
              high: isNum(bar.high) ? bar.high : bar.close,
              rs: bar.close / benchClose,
            };
          })
          .filter((x): x is { close: number; high: number; rs: number } => x !== null)
          .slice(-lookbackDays);

        if (paired.length < Math.min(10, lookbackDays)) {
          rows.push({ symbol: history.symbol, isSignal: false, benchmark, lookbackDays, rsHighDaysAgo: null, priceHighDaysAgo: null, rsLatest: null, rsHigh: null, priceLatest: null, priceHigh: null });
          continue;
        }

        let rsHighIdx = 0;
        let priceHighIdx = 0;
        for (let idx = 1; idx < paired.length; idx++) {
          if (paired[idx].rs >= paired[rsHighIdx].rs) rsHighIdx = idx;
          if (paired[idx].high >= paired[priceHighIdx].high) priceHighIdx = idx;
        }
        const latestIdx = paired.length - 1;
        const rsHighDaysAgo = latestIdx - rsHighIdx;
        const priceHighDaysAgo = latestIdx - priceHighIdx;
        const isSignal = rsHighDaysAgo < priceHighDaysAgo;

        rows.push({
          symbol: history.symbol,
          isSignal,
          rsHighDaysAgo,
          priceHighDaysAgo,
          rsLatest: paired[latestIdx].rs,
          rsHigh: paired[rsHighIdx].rs,
          priceLatest: paired[latestIdx].close,
          priceHigh: paired[priceHighIdx].high,
          benchmark,
          lookbackDays,
        });
      }
    }

    return new Response(JSON.stringify({ rows, benchmark, lookbackDays }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("rs-new-high-signals error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});