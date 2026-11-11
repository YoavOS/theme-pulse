// Fetch today's daily candle (open + close) for a list of symbols from Yahoo Finance.
// POST { symbols: string[] }  (max 500)
// Returns: { results: { [symbol]: { open: number, close: number } | null } }
//
// History mode (21 EMA pullback check in Live Execution):
// POST { history: "NVDA" }
// Returns: { symbol, bars: [{ t: "YYYY-MM-DD", o, h, l, c, v }] (≈9 months, oldest first), barInProgress }
//   barInProgress = the last bar is today's and the regular session hasn't closed yet.

import { corsHeaders } from "../_shared/cors.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchOne(symbol: string): Promise<{ open: number; close: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=5d&interval=1d&includePrePost=false`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r) return null;
    const opens: (number | null)[] = r.indicators?.quote?.[0]?.open ?? [];
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    // Walk backwards to find the most recent bar with both open and close.
    for (let i = opens.length - 1; i >= 0; i--) {
      const o = opens[i];
      const c = closes[i];
      if (typeof o === "number" && typeof c === "number" && Number.isFinite(o) && Number.isFinite(c)) {
        return { open: o, close: c };
      }
    }
    // Fall back to meta regularMarketPrice / chartPreviousClose if needed (not green/red signal).
    return null;
  } catch {
    return null;
  }
}

async function fetchHistory(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=9mo&interval=1d&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`Yahoo HTTP ${res.status}`); }
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description ?? "No data for this ticker");
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const gmtoff: number = r.meta?.gmtoffset ?? 0;
  const bars = ts.map((t, i) => ({
    t: new Date((t + gmtoff) * 1000).toISOString().slice(0, 10),
    o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? 0,
  })).filter((b) => [b.o, b.h, b.l, b.c].every((x) => typeof x === "number" && Number.isFinite(x)));
  const reg = r.meta?.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const today = new Date((now + gmtoff) * 1000).toISOString().slice(0, 10);
  const barInProgress = !!reg && now >= reg.start && now < reg.end && bars.length > 0 && bars[bars.length - 1].t === today;
  return { symbol, bars, barInProgress, currency: r.meta?.currency ?? null };
}

async function runPool<T, R>(items: T[], limit: number, worker: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.history === "string" && body.history.trim()) {
      const sym = body.history.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 15);
      try {
        return new Response(JSON.stringify(await fetchHistory(sym)), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ symbol: sym, error: e instanceof Error ? e.message : String(e) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const symbols: string[] = Array.isArray(body.symbols)
      ? Array.from(
          new Set<string>(
            body.symbols
              .map((s: unknown) => String(s ?? "").trim().toUpperCase())
              .filter(Boolean),
          ),
        ).slice(0, 500)
      : [];
    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "symbols[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const fetched = await runPool(symbols, 12, fetchOne);
    const results: Record<string, { open: number; close: number } | null> = {};
    symbols.forEach((s, idx) => { results[s] = fetched[idx]; });
    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
