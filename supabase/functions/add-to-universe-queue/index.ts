import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// APPEND-ONLY: Add missing tickers DIRECTLY to the qualified
// universe. This function does NOT touch the staging table and
// does NOT trigger the swap pipeline (which would wipe the
// existing universe). It also does NOT pull fundamentals.
//
// Pipeline per symbol:
//   1) Yahoo chart → price / 10d avg volume / ADR
//   2) Pre-filter (price, ADR, $-volume)
//   3) Finnhub profile2 → market cap, sector, OTC check
//   4) Upsert directly into qualified_rs_universe
//   5) Kick calculate-rs-scores so RS columns get filled
// ============================================================

const YAHOO_PARALLEL = 8;
const FINNHUB_DELAY_MS = 1200;
const ADR_LOOKBACK_DAYS = 14;
const MAX_SYMBOLS = 100;

const DEFAULT_FILTERS = {
  MIN_MARKET_CAP_M: 300,
  MIN_PRICE: 5,
  MIN_DOLLAR_VOLUME: 10_000_000,
  MIN_ADR_PCT: 3,
  EXCLUDE_OTC: true,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface YahooStats {
  price: number | null;
  avgVolume10d: number | null;
  adrPct: number | null;
  source: string;
}

async function fetchYahooStats(symbol: string): Promise<YahooStats> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_fail" };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const meta = result?.meta;
    if (!quote || !meta) return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_fail" };

    const price = meta.regularMarketPrice ?? null;
    const highs: number[] = quote.high || [];
    const lows: number[] = quote.low || [];
    const closes: number[] = quote.close || [];
    const vols: number[] = quote.volume || [];

    const dailyAdr: number[] = [];
    for (let i = highs.length - 1; i >= 0 && dailyAdr.length < ADR_LOOKBACK_DAYS; i--) {
      const h = highs[i], l = lows[i], c = closes[i];
      if (h != null && l != null && c != null && c > 0) {
        dailyAdr.push(((h - l) / c) * 100);
      }
    }
    const adrPct = dailyAdr.length >= 5
      ? Math.round((dailyAdr.reduce((s, v) => s + v, 0) / dailyAdr.length) * 100) / 100
      : null;

    const recentVols: number[] = [];
    for (let i = vols.length - 1; i >= 0 && recentVols.length < 10; i--) {
      if (vols[i] != null && vols[i] > 0) recentVols.push(vols[i]);
    }
    const avgVolume10d = recentVols.length >= 5
      ? Math.round(recentVols.reduce((s, v) => s + v, 0) / recentVols.length)
      : null;

    return { price, avgVolume10d, adrPct, source: "yahoo" };
  } catch (_e) {
    return { price: null, avgVolume10d: null, adrPct: null, source: "yahoo_error" };
  }
}

async function fetchYahooBatch(symbols: string[]): Promise<Record<string, YahooStats>> {
  const out: Record<string, YahooStats> = {};
  for (let i = 0; i < symbols.length; i += YAHOO_PARALLEL) {
    const slice = symbols.slice(i, i + YAHOO_PARALLEL);
    const results = await Promise.all(slice.map((s) => fetchYahooStats(s)));
    slice.forEach((s, idx) => { out[s] = results[idx]; });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    let body: any = {};
    try { body = await req.json(); } catch (_) { /* */ }

    const rawSymbols: unknown = body?.symbols;
    if (!Array.isArray(rawSymbols)) {
      return new Response(JSON.stringify({ error: "symbols[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requested = Array.from(new Set(
      rawSymbols
        .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
        .filter((s) => s.length > 0 && s.length <= 10 && /^[A-Z0-9.\-]+$/.test(s))
    )).slice(0, MAX_SYMBOLS);

    if (requested.length === 0) {
      return new Response(JSON.stringify({ ok: true, added: 0, alreadyInUniverse: [], notQualified: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip symbols already in the qualified universe.
    const { data: existingRows } = await supabase
      .from("qualified_rs_universe")
      .select("symbol")
      .in("symbol", requested);
    const alreadyInUniverse = new Set((existingRows ?? []).map((r: any) => r.symbol));
    const toProcess = requested.filter((s) => !alreadyInUniverse.has(s));

    // Read user filter overrides if present (same as worker).
    const { data: prog } = await supabase
      .from("rs_scan_progress").select("filters").eq("id", 1).maybeSingle();
    const userFilters = (prog as any)?.filters || {};
    const FILTERS = {
      MIN_MARKET_CAP_M: userFilters.minMarketCapM ?? DEFAULT_FILTERS.MIN_MARKET_CAP_M,
      MIN_PRICE: userFilters.minPrice ?? DEFAULT_FILTERS.MIN_PRICE,
      MIN_DOLLAR_VOLUME: userFilters.minDollarVolume ?? DEFAULT_FILTERS.MIN_DOLLAR_VOLUME,
      MIN_ADR_PCT: userFilters.minAdrPct ?? DEFAULT_FILTERS.MIN_ADR_PCT,
      EXCLUDE_OTC: userFilters.excludeOtc ?? DEFAULT_FILTERS.EXCLUDE_OTC,
    };

    const yahooMap = await fetchYahooBatch(toProcess);

    const notQualified: { symbol: string; reason: string }[] = [];
    const candidates: string[] = [];

    for (const sym of toProcess) {
      const y = yahooMap[sym];
      if (!y || y.price == null) { notQualified.push({ symbol: sym, reason: "no price data" }); continue; }
      if (y.price < FILTERS.MIN_PRICE) { notQualified.push({ symbol: sym, reason: `price < $${FILTERS.MIN_PRICE}` }); continue; }
      if (y.adrPct == null || y.adrPct < FILTERS.MIN_ADR_PCT) { notQualified.push({ symbol: sym, reason: `ADR < ${FILTERS.MIN_ADR_PCT}%` }); continue; }
      if (y.avgVolume10d == null) { notQualified.push({ symbol: sym, reason: "no volume data" }); continue; }
      const dollarVol = y.avgVolume10d * y.price;
      if (dollarVol < FILTERS.MIN_DOLLAR_VOLUME) { notQualified.push({ symbol: sym, reason: "dollar volume too low" }); continue; }
      candidates.push(sym);
    }

    const added: string[] = [];

    for (const sym of candidates) {
      const y = yahooMap[sym];
      try {
        const profRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`);
        if (profRes.status === 429) {
          notQualified.push({ symbol: sym, reason: "finnhub rate limited" });
          await sleep(2000);
          continue;
        }
        const prof = await profRes.json();
        await sleep(FINNHUB_DELAY_MS);

        const exch = String(prof?.exchange ?? "").toUpperCase();
        const isOtc =
          /OTC|PINK|GREY|GRAY|OOTC|OTCBB|OTCMKTS|OTCPK/.test(exch) ||
          (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F"));
        const mcM = prof?.marketCapitalization;

        if (isOtc && FILTERS.EXCLUDE_OTC) {
          notQualified.push({ symbol: sym, reason: `OTC (${exch})` });
          continue;
        }
        if (FILTERS.MIN_MARKET_CAP_M > 0 && (!mcM || mcM < FILTERS.MIN_MARKET_CAP_M)) {
          notQualified.push({ symbol: sym, reason: `market cap < $${FILTERS.MIN_MARKET_CAP_M}M` });
          continue;
        }

        const dollarVolume = (y.avgVolume10d as number) * (y.price as number);
        const { error: upsertErr } = await supabase.from("qualified_rs_universe").upsert({
          symbol: sym,
          company_name: prof?.name || sym,
          sector: prof?.finnhubIndustry || null,
          market_cap: mcM,
          current_price: y.price,
          avg_dollar_volume: dollarVolume,
          adr_percent: y.adrPct,
          adr_source: y.source,
          qualified_at: new Date().toISOString(),
        }, { onConflict: "symbol" });
        if (upsertErr) {
          notQualified.push({ symbol: sym, reason: `db error: ${upsertErr.message}` });
          continue;
        }
        added.push(sym);
      } catch (e) {
        notQualified.push({ symbol: sym, reason: String(e) });
      }
    }

    // Kick RS recalculation in the background so the newly added rows
    // get RS / return columns filled. Don't await.
    if (added.length > 0) {
      (async () => {
        try {
          let offset = 0;
          for (let i = 0; i < 500; i++) {
            const { data: rsData, error: rsErr } = await supabase.functions.invoke(
              "calculate-rs-scores", { body: { offset } },
            );
            if (rsErr) { console.error("calculate-rs-scores invoke error:", rsErr); break; }
            if (rsData?.done || rsData?.next_offset == null) break;
            offset = rsData.next_offset;
          }
        } catch (e) { console.error("RS recalc loop error:", e); }
      })();
    }

    return new Response(JSON.stringify({
      ok: true,
      added: added.length,
      addedSymbols: added,
      alreadyInUniverse: Array.from(alreadyInUniverse),
      notQualified,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("add-to-universe-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
