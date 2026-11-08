// sec-filings-watch — reads SEC EDGAR's free daily filing index for the stocks in the universe.
//
// Runs at 22:05, 22:45 and 23:25 UTC on weekdays (pg_cron, migration 20261109090000), inside the
// existing after-close window. Each run:
//   1. reads up to DAYS_PER_RUN daily index files not read yet (newest first, looking back
//      LOOKBACK_DAYS, so the first evenings also fill in the last few months), and stores every
//      10-Q / 10-K / 20-F / 40-F and Form 4 filed by a universe stock in sec_filings;
//   2. parses pending Form 4s (newest first) into insider_trades: open-market purchases (P) and
//      sales (S), with the insider's role and whether the trade was under a 10b5-1 plan.
// superperf-refresh then rescores any stock whose periodic report landed after its last score.
//
// SEC fair-access rules: a User-Agent with contact info and at most 10 requests/second
// (https://www.sec.gov/os/accessing-edgar-data). This function stays under 8/second.
//
// POST body:
//   { trigger: "cron" }        → one run
//   { action: "status" }       → counts only

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Supabase client in Deno */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  INSIDER_FORMS, PERIODIC_FORMS, SEC_UA, fetchCikTickers, masterIndexUrl, parseForm4, parseMasterIndex, type IndexRow,
} from "../_shared/secFilings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TIME_BUDGET_MS = 45_000;
const LOOKBACK_DAYS = 95;
const DAYS_PER_RUN = 5;
const FORM4_MAX_AGE_DAYS = 120;
const FORM4_BATCH = 400;
const CONCURRENCY = 4;
/** Each worker waits this long between requests → 4 workers ≈ 8 requests/second at most. */
const PER_WORKER_GAP_MS = 500;
const DAY_MS = 86_400_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
function isOtc(sym: string) {
  return /\.(PK|OTC|OB)$/i.test(sym) || (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F"));
}

// deno-lint-ignore no-explicit-any
async function readAll<T>(sb: any, table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function secGet(url: string): Promise<{ status: number; text: string | null }> {
  const r = await fetch(url, { headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" } });
  if (!r.ok) { await r.body?.cancel(); return { status: r.status, text: null }; }
  return { status: r.status, text: await r.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; trigger?: string };
    // deno-lint-ignore no-explicit-any
    const sb: any = createClient(SB_URL, SB_KEY);

    if (body.action === "status") {
      const [{ count: filings }, { count: pending }, { count: trades }, { data: lastDay }] = await Promise.all([
        sb.from("sec_filings").select("accession", { count: "exact", head: true }),
        sb.from("sec_filings").select("accession", { count: "exact", head: true }).eq("form", "4").eq("parsed", false),
        sb.from("insider_trades").select("accession", { count: "exact", head: true }),
        sb.from("sec_index_days").select("day").eq("status", "ok").order("day", { ascending: false }).limit(1),
      ]);
      return json({ ok: true, filings, form4Pending: pending, insiderTrades: trades, newestIndexDay: lastDay?.[0]?.day ?? null });
    }

    // ── 1) Daily index files ────────────────────────────────────────────────
    const done = new Set((await readAll<{ day: string }>(sb, "sec_index_days", "day",
      (q) => q.gte("day", isoDay(Date.now() - LOOKBACK_DAYS * DAY_MS)))).map((r) => r.day));
    const days: string[] = [];
    for (let i = 0; i <= LOOKBACK_DAYS; i++) {
      const t = Date.now() - i * DAY_MS, wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const d = isoDay(t);
      if (!done.has(d)) days.push(d);
    }
    const todo = days.slice(0, DAYS_PER_RUN);
    let indexRead = 0, filingsKept = 0;
    if (todo.length) {
      const uni = await readAll<{ symbol: string }>(sb, "qualified_rs_universe", "symbol");
      const universe = new Map<string, string>();   // SEC-style ticker (BRK-B) → app ticker (BRK.B)
      for (const u of uni) if (u.symbol && !isOtc(u.symbol)) universe.set(u.symbol.toUpperCase().replace(".", "-"), u.symbol.toUpperCase());
      const cikTickers = await fetchCikTickers();
      const symOfCik = new Map<number, string>();
      for (const [cik, ts] of cikTickers) { const hit = ts.find((t) => universe.has(t)); if (hit) symOfCik.set(cik, universe.get(hit)!); }
      const forms = new Set([...PERIODIC_FORMS, ...INSIDER_FORMS]);

      for (const day of todo) {
        if (timeLeft() < 15_000) break;
        const { status, text } = await secGet(masterIndexUrl(day));
        if (status === 429 || status === 403) break;          // rate-limited: try again next run
        const ageDays = (Date.now() - Date.parse(day + "T12:00:00Z")) / DAY_MS;
        if (text === null) {
          // Not published yet (today) or no filings that day (holiday). Holidays are marked after 3 days.
          if (ageDays > 3) await sb.from("sec_index_days").upsert({ day, status: "missing", rows_kept: 0 }, { onConflict: "day" });
          continue;
        }
        const rows: IndexRow[] = parseMasterIndex(text, forms);
        const keep = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const symbol = symOfCik.get(r.cik);
          if (!symbol || keep.has(r.accession)) continue;      // Form 4s are listed under issuer AND insider
          const old4 = INSIDER_FORMS.has(r.form) && ageDays > FORM4_MAX_AGE_DAYS;
          keep.set(r.accession, { accession: r.accession, symbol, cik: r.cik, form: r.form, filed: r.filed, path: r.path, parsed: old4 });
        }
        const list = [...keep.values()];
        for (let i = 0; i < list.length; i += 500) {
          const { error } = await sb.from("sec_filings").upsert(list.slice(i, i + 500), { onConflict: "accession", ignoreDuplicates: true });
          if (error) throw error;
        }
        await sb.from("sec_index_days").upsert({ day, status: "ok", rows_kept: list.length }, { onConflict: "day" });
        indexRead++; filingsKept += list.length;
      }
    }

    // ── 2) Form 4 → insider trades ─────────────────────────────────────────
    let parsed = 0, trades = 0, failed = 0, rateLimited = false;
    if (timeLeft() > 8_000) {
      const { data: pending, error } = await sb.from("sec_filings")
        .select("accession, symbol, filed, path")
        .eq("form", "4").eq("parsed", false)
        .gte("filed", isoDay(Date.now() - FORM4_MAX_AGE_DAYS * DAY_MS))
        .order("filed", { ascending: false }).limit(FORM4_BATCH);
      if (error) throw error;
      const queue = (pending ?? []) as { accession: string; symbol: string; filed: string; path: string }[];
      let next = 0;
      const worker = async () => {
        while (next < queue.length && timeLeft() > 4_000 && !rateLimited) {
          const f = queue[next++];
          const t0 = Date.now();
          try {
            const { status, text } = await secGet(`https://www.sec.gov/Archives/${f.path}`);
            if (status === 429 || status === 403) { rateLimited = true; break; }
            if (text === null) {
              await sb.from("sec_filings").update({ parsed: true, parse_error: `HTTP ${status}` }).eq("accession", f.accession);
              failed++;
            } else {
              const rows = parseForm4(text).map((t) => ({
                accession: f.accession, line: t.line, symbol: f.symbol, owner: t.owner.slice(0, 200), owner_cik: t.ownerCik,
                title: t.title?.slice(0, 120) ?? null, is_director: t.isDirector, is_officer: t.isOfficer, is_ten_pct: t.isTenPct,
                code: t.code, trade_date: t.tradeDate, shares: t.shares, price: t.price, value: t.value,
                plan_10b5_1: t.plan10b51, filed: f.filed,
              }));
              if (rows.length) {
                const { error: e2 } = await sb.from("insider_trades").upsert(rows, { onConflict: "accession,line", ignoreDuplicates: true });
                if (e2) throw e2;
                trades += rows.length;
              }
              await sb.from("sec_filings").update({ parsed: true, parse_error: null }).eq("accession", f.accession);
              parsed++;
            }
          } catch (e) {
            failed++;
            await sb.from("sec_filings").update({ parsed: true, parse_error: String(e instanceof Error ? e.message : e).slice(0, 200) }).eq("accession", f.accession);
          }
          const wait = PER_WORKER_GAP_MS - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    }

    return json({ ok: true, indexDaysRead: indexRead, indexDaysLeft: Math.max(0, days.length - indexRead), filingsKept, form4Parsed: parsed, insiderTrades: trades, failed, rateLimited, ms: Date.now() - started });
  } catch (e) {
    console.error("sec-filings-watch error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
