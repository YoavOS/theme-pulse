// daily-bars — keeps ~5 years of daily prices for the universe on your PC (table daily_bars).
//   POST {}                    work through the symbols that miss the last closed session, for up to ~110 s
//   POST { symbols: [...] }    refresh these now (5 years if new, else the last month)
// The first run downloads the full history (a few thousand symbols, ~1–2 hours in the background);
// after that each night only adds the new day.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const BUDGET_MS = 50_000;   // the local backend stops a request after about a minute
const CONCURRENCY = 2;   // gentle on the PC during the first big download
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** New York calendar date + whether the regular session is still open (a bar for today isn't final). */
function nyNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  const mins = Number(g("hour")) * 60 + Number(g("minute"));
  return { date, final: mins >= 16 * 60 + 30 };
}

async function fetchBars(symbol: string, range: string): Promise<{ rows: any[]; status: number; split?: boolean }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false&events=split`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }).catch(() => null);
    if (!res) { await sleep(1000); continue; }
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) return { rows: [], status: res.status };
    const j = await res.json().catch(() => null);
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp) return { rows: [], status: 404 };
    const q = r.indicators?.quote?.[0] ?? {};
    const tz = r.meta?.exchangeTimezoneName ?? "America/New_York";
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const rows = (r.timestamp as number[]).map((t, i) => ({
      symbol, d: fmt.format(new Date(t * 1000)), o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] ?? null,
    })).filter((b) => b.c != null && b.h != null && b.l != null && b.c > 0);
    // one row per date (Yahoo sometimes repeats the live bar)
    const byDate = new Map<string, any>();
    for (const b of rows) byDate.set(b.d, b);
    return { rows: [...byDate.values()], status: 200, split: !!(r.events?.splits && Object.keys(r.events.splits).length) };
  }
  return { rows: [], status: 429 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const sb = createClient(SB_URL, SB_KEY);
  const body = await req.json().catch(() => ({}));
  const ny = nyNow();

  let todo: { symbol: string; last_d: string | null }[];
  if (Array.isArray(body.symbols) && body.symbols.length) {
    const syms = body.symbols.map((s: string) => String(s).toUpperCase()).slice(0, 200);
    const { data } = await sb.from("daily_bars_state").select("symbol, last_d").in("symbol", syms);
    const m = new Map((data ?? []).map((r: any) => [r.symbol, r.last_d]));
    todo = syms.map((s: string) => ({ symbol: s, last_d: m.get(s) ?? null }));
  } else {
    const { data, error } = await sb.rpc("daily_bars_due", { max_n: 3000 });
    if (error) return json({ error: error.message }, 500);
    todo = data ?? [];
  }

  let done = 0, bars = 0, failed = 0, limited = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length && Date.now() - started < BUDGET_MS) {
      const t = queue.shift()!;
      const stale = !t.last_d || (Date.now() - new Date(t.last_d).getTime()) > 25 * 864e5;
      let { rows, status, split } = await fetchBars(t.symbol, stale ? "5y" : "1mo");
      // a split in the last month changes every older price: start this stock over from 5 years
      let restart = false;
      if (split && !stale) {
        const full = await fetchBars(t.symbol, "5y");
        if (full.rows.length) { await sb.from("daily_bars").delete().eq("symbol", t.symbol); rows = full.rows; status = full.status; restart = true; }
      }
      if (status === 429) limited++;
      // a bar for today is only final after the close
      const final = rows.filter((b) => b.d < ny.date || (b.d === ny.date && ny.final));
      if (final.length) {
        for (let i = 0; i < final.length; i += 1000) {
          const { error } = await sb.from("daily_bars").upsert(final.slice(i, i + 1000), { onConflict: "symbol,d" });
          if (error) { failed++; break; }
        }
        bars += final.length;
      } else if (status !== 200) failed++;
      const first = final[0]?.d ?? null, last = final[final.length - 1]?.d ?? null;
      const state: any = { symbol: t.symbol, checked_at: new Date().toISOString(), error: status === 200 ? null : `HTTP ${status}` };
      if (last) state.last_d = last > (t.last_d ?? "") ? last : t.last_d;
      if (restart && last) state.last_d = last;
      if (first && (stale || restart)) state.first_d = first;
      await sb.from("daily_bars_state").upsert(state, { onConflict: "symbol" });
      done++;
      await sleep(150);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return json({ ok: true, done, bars, failed, rateLimited: limited, remaining: queue.length, ms: Date.now() - started });
});
