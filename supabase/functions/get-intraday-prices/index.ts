// Fetch intraday (current trading day) prices for one or more symbols from Yahoo Finance.
// POST { symbols: string[], interval?: "1m"|"2m"|"5m"|"15m" }
// Returns: { interval, results: { [symbol]: { ts:number[], close:number[], prevClose:number|null } } }

import { corsHeaders } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchOne(symbol: string, interval: string) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp ?? [];
    const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
    const prevClose: number | null = r.meta?.chartPreviousClose ?? r.meta?.previousClose ?? null;
    const out: { ts: number[]; close: number[] } = { ts: [], close: [] };
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      out.ts.push(ts[i]);
      out.close.push(c);
    }
    return { ...out, prevClose };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = Array.isArray(body.symbols)
      ? body.symbols.map((s: string) => String(s).toUpperCase()).filter(Boolean).slice(0, 20)
      : [];
    const interval: string = ["1m", "2m", "5m", "15m"].includes(body.interval) ? body.interval : "5m";
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ error: "symbols[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const results: Record<string, unknown> = {};
    // Run in parallel — small set.
    const fetched = await Promise.all(symbols.map((s) => fetchOne(s, interval)));
    symbols.forEach((s, i) => { results[s] = fetched[i]; });
    return new Response(JSON.stringify({ interval, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
