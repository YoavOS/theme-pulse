// portfolio-live — live data for the Portfolio tab, for the handful of stocks you hold.
//   POST { symbols: string[], parts?: ("quotes"|"earnings"|"news")[], force?: boolean }
//   quotes   — Yahoo: last price, previous close, today's high/low/volume, market state (not cached)
//   earnings — Finnhub calendar ~2 years back + next ~4 months: dates, before/after the bell, EPS and
//              revenue actual vs estimate (cached 12 h; 1 h on a reporting day)
//   news     — Finnhub company news, last 10 days, newest first (cached 30 min)
// Small by design (≤ 40 symbols, 4 at a time) so the local backend never stops it for CPU time.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function quote(symbol: string) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const m = (await r.json().catch(() => null))?.chart?.result?.[0]?.meta;
    if (!m) return null;
    return {
      price: num(m.regularMarketPrice), prevClose: num(m.chartPreviousClose ?? m.previousClose),
      dayHigh: num(m.regularMarketDayHigh), dayLow: num(m.regularMarketDayLow), volume: num(m.regularMarketVolume),
      time: num(m.regularMarketTime), currency: m.currency ?? null, name: m.longName ?? m.shortName ?? null,
    };
  } catch { return null; }
}

async function earnings(symbol: string) {
  if (!FINNHUB_KEY) return { rows: [], note: "no_finnhub_key" };
  const from = day(Date.now() - 800 * 86400_000), to = day(Date.now() + 130 * 86400_000);
  const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_KEY}`).catch(() => null);
  if (!r || !r.ok) { await r?.body?.cancel(); return null; }
  const j = await r.json().catch(() => null);
  const rows = ((j?.earningsCalendar ?? []) as any[]).map((e) => ({
    date: String(e.date), hour: e.hour ? String(e.hour).toLowerCase() : null, quarter: num(e.quarter), year: num(e.year),
    epsActual: num(e.epsActual), epsEstimate: num(e.epsEstimate), revenueActual: num(e.revenueActual), revenueEstimate: num(e.revenueEstimate),
  })).sort((a, b) => a.date.localeCompare(b.date));
  return { rows };
}

async function news(symbol: string) {
  if (!FINNHUB_KEY) return { items: [], note: "no_finnhub_key" };
  const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${day(Date.now() - 10 * 86400_000)}&to=${day(Date.now())}&token=${FINNHUB_KEY}`).catch(() => null);
  if (!r || !r.ok) { await r?.body?.cancel(); return null; }
  const arr = ((await r.json().catch(() => [])) ?? []) as any[];
  const seen = new Set<string>();
  const items = arr.filter((n) => n?.headline && n?.url).sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
    .filter((n) => { const k = String(n.headline).toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 12).map((n) => ({ headline: String(n.headline).slice(0, 300), summary: n.summary ? String(n.summary).slice(0, 400) : null, source: n.source ?? null, url: String(n.url), time: num(n.datetime), related: n.related ?? null }));
  return { items };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = [...new Set(((body?.symbols ?? []) as unknown[]).map((s) => String(s ?? "").toUpperCase().trim()).filter((s) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))].slice(0, 40);
    const parts: string[] = Array.isArray(body?.parts) && body.parts.length ? body.parts : ["quotes", "earnings", "news"];
    const force = !!body?.force;
    if (!symbols.length) return json({ quotes: {}, earnings: {}, news: {} });
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const out: { quotes: Record<string, unknown>; earnings: Record<string, unknown>; news: Record<string, unknown>; finnhub: boolean } = { quotes: {}, earnings: {}, news: {}, finnhub: !!FINNHUB_KEY };

    if (parts.includes("quotes")) await pool(symbols, 4, async (s) => { out.quotes[s] = await quote(s); });

    for (const kind of ["earnings", "news"] as const) {
      if (!parts.includes(kind)) continue;
      const { data: cached } = await sb.from("portfolio_cache").select("symbol, data, fetched_at").eq("kind", kind).in("symbol", symbols);
      const today = day(Date.now());
      const fresh = new Map<string, unknown>();
      for (const c of cached ?? []) {
        const age = Date.now() - new Date(c.fetched_at).getTime();
        const reportsToday = kind === "earnings" && ((c.data as any)?.rows ?? []).some((x: any) => x.date === today || (x.date < today && x.epsActual == null && x.date >= day(Date.now() - 3 * 86400_000)));
        const ttl = kind === "news" ? 30 * 60_000 : reportsToday ? 60 * 60_000 : 12 * 3600_000;
        if (!force && age < ttl) fresh.set(c.symbol, { ...(c.data as object), fetchedAt: c.fetched_at });
      }
      const need = symbols.filter((s) => !fresh.has(s));
      await pool(need, 3, async (s) => {
        const d = kind === "earnings" ? await earnings(s) : await news(s);
        if (d) {
          const at = new Date().toISOString();
          fresh.set(s, { ...d, fetchedAt: at });
          if (!(d as any).note) await sb.from("portfolio_cache").upsert({ symbol: s, kind, data: d, fetched_at: at }, { onConflict: "symbol,kind" });
        } else {
          const old = (cached ?? []).find((c) => c.symbol === s);
          fresh.set(s, old ? { ...(old.data as object), fetchedAt: old.fetched_at, stale: true } : { error: "unavailable" });
        }
      });
      for (const s of symbols) out[kind][s] = fresh.get(s) ?? null;
    }
    return json(out);
  } catch (e) {
    console.error("portfolio-live error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
