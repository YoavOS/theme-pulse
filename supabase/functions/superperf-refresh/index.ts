// superperf-refresh — keeps the Superperformance list fresh in the background.
//
// Runs every 20 minutes between 22:00 and 23:40 UTC on weekdays (pg_cron, migrations 20261101090000
// and 20261101130000), so the backend is idle the rest of the day. Each run rescores a small
// batch of stocks that are due, by calling minervini-analysis in its quick "minimal" mode, and
// stores every profile score + a compact breakdown + the company's report dates.
//
// A stock is due when (most urgent first):
//   1. it reported earnings since its last score (next_report has passed),
//   2. it was never scored, or is missing the newer profile scores,
//   3. its score is more than 30 days old.
// When nothing is due the run ends after two small reads.
//
// POST body:
//   { trigger: "cron" }                 → process one batch
//   { action: "status" }                → counts only, no scoring
//   { action: "pause" | "resume" }      → switch the 20-minute schedule off / on

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LEGACY = ["minervini", "oneil", "ryan", "current"] as const;
const COL: Record<(typeof LEGACY)[number], string> = {
  minervini: "minervini_score", oneil: "oneil_score", ryan: "ryan_score", current: "current_score",
};
/** Stocks per run. Each takes ~2 s and several upstream API calls, so runs stay small and spread out. */
const BATCH = 30;
const CONCURRENCY = 3;
/** Stop starting new stocks after this long; edge functions are cut off at ~60 s. */
const TIME_BUDGET_MS = 45_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Same heuristic as the RS Alpha page: foreign OTC tickers are skipped. */
function isOtc(sym: string) {
  return /\.(PK|OTC|OB)$/i.test(sym) || (/^[A-Z]{5}$/.test(sym) && sym.endsWith("F"));
}

interface Row { symbol: string; last_scanned: string | null; next_report: string | null; profile_scores: unknown }

// deno-lint-ignore no-explicit-any
async function readAll<T>(sb: any, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Ordered list of due symbols, with the reason (for the status call). */
function dueList(universe: string[], rows: Map<string, Row>, now: number) {
  const reported: string[] = [], missing: string[] = [], old: { s: string; t: number }[] = [];
  for (const s of universe) {
    const r = rows.get(s);
    if (!r || !r.last_scanned || !r.profile_scores) { missing.push(s); continue; }
    const last = Date.parse(r.last_scanned);
    // Reported since the last score: the report day has passed (give data a day to land).
    if (r.next_report && Date.parse(r.next_report) + DAY_MS <= now && last < Date.parse(r.next_report) + DAY_MS) { reported.push(s); continue; }
    if (now - last > MAX_AGE_MS) old.push({ s, t: last });
  }
  old.sort((a, b) => a.t - b.t);
  return { reported, missing, old: old.map((x) => x.s), all: [...reported, ...missing, ...old.map((x) => x.s)] };
}

async function scoreOne(symbol: string) {
  const res = await fetch(`${SB_URL}/functions/v1/minervini-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY },
    body: JSON.stringify({ symbol, minimal: true, profiles: LEGACY, breakdown: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
  const row: Record<string, unknown> = {
    symbol,
    last_scanned: new Date().toISOString(),
    profile_scores: data.profileScores ?? {},
    breakdown: data.breakdown ?? null,
    last_report: data.lastReport ?? null,
    next_report: data.nextReport ?? null,
  };
  for (const k of LEGACY) row[COL[k]] = typeof data.scores?.[k] === "number" ? data.scores[k] : null;
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; trigger?: string };
    const sb = createClient(SB_URL, SB_KEY);

    if (body.action === "pause" || body.action === "resume") {
      const { error } = await sb.rpc("set_superperf_cron_active", { p_active: body.action === "resume" });
      if (error) throw error;
      return json({ ok: true, active: body.action === "resume" });
    }

    const [uni, rows] = await Promise.all([
      readAll<{ symbol: string }>(sb, "qualified_rs_universe", "symbol"),
      readAll<Row>(sb, "superperformance_stocks", "symbol, last_scanned, next_report, profile_scores"),
    ]);
    const universe = uni.map((u) => u.symbol).filter((s) => s && !isOtc(s));
    const bySym = new Map(rows.map((r) => [r.symbol, r]));
    const due = dueList(universe, bySym, Date.now());

    if (body.action === "status") {
      const { data: active } = await sb.rpc("get_superperf_cron_active");
      return json({
        ok: true, active: active !== false, universe: universe.length,
        due: due.all.length, reportedSince: due.reported.length, neverScored: due.missing.length, older30d: due.old.length,
      });
    }

    const batch = due.all.slice(0, BATCH);
    let next = 0, scored = 0;
    const failed: string[] = [];
    const worker = async () => {
      while (next < batch.length && Date.now() - started < TIME_BUDGET_MS) {
        const sym = batch[next++];
        try {
          const row = await scoreOne(sym);
          const { error } = await sb.from("superperformance_stocks").upsert(row, { onConflict: "symbol" });
          if (error) throw error;
          scored++;
        } catch (e) {
          failed.push(sym);
          // Remember the attempt so a stock without usable filings isn't retried every 20 minutes;
          // it comes back after 30 days like any other stale score.
          await sb.from("superperformance_stocks").upsert(
            { symbol: sym, last_scanned: new Date().toISOString(), profile_scores: {}, breakdown: { err: String(e instanceof Error ? e.message : e).slice(0, 200) } },
            { onConflict: "symbol" },
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
    return json({ ok: true, due: due.all.length, scored, failed: failed.length, remaining: Math.max(0, due.all.length - scored - failed.length), ms: Date.now() - started });
  } catch (e) {
    console.error("superperf-refresh error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
