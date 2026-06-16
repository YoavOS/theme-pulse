// Fetch today's daily candle (open + close) for a list of symbols from Yahoo Finance.
// POST { symbols: string[] }  (max 500)
// Returns: { results: { [symbol]: { open: number, close: number } | null } }

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
    const symbols: string[] = Array.isArray(body.symbols)
      ? Array.from(
          new Set(
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
