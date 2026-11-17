// pattern-finder — what did stocks look like before big moves?
//   POST { action: "samples" }   turn the price history into samples (≈110 s per call; call again until done:true)
//   POST { action: "mine" }      find and test the patterns (mine_patterns), then the AI explains them (EN + HE)
//   POST { action: "status" }    progress
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { samplesFor } from "../_shared/patternFeatures.ts";
import type { Bars } from "../_shared/lists.ts";
import { hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const TRAITS = ["distance from the 21 EMA (in daily ranges)", "run since the last 21 EMA touch (%)", "RS: 3-month return minus SPY (points)", "distance from the 52-week high (%)",
  "price vs its 50-day average (%)", "tightening: 10-day range / 50-day range", "volume dry-up: 10-day / 50-day volume", "up-volume / down-volume (50 days)",
  "vs SPY on red market days (points)", "stage-2 trend (above a rising 150-day average)", "industry strength (percentile among industries)"];

const toBars = (r: any): Bars => ({ d: r.d, h: r.h, l: r.l, c: r.c, v: (r.v ?? []).map((x: any) => Number(x ?? 0)) });

async function samples(sb: any) {
  const t0 = Date.now();
  const { data: spyRow } = await sb.rpc("bars_arrays", { syms: ["SPY"], n: 1400 });
  if (!spyRow?.[0]) return json({ error: "No SPY history yet — the price download hasn't finished." }, 409);
  const spy = toBars(spyRow[0]);
  const lastBar = spy.d[spy.d.length - 1];
  const uni: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("qualified_rs_universe").select("symbol, sector").order("symbol").range(from, from + 999);
    uni.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const prog = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("pattern_progress").select("symbol, last_bar").range(from, from + 999);
    for (const r of data ?? []) prog.set(r.symbol, r.last_bar);
    if (!data || data.length < 1000) break;
  }
  const todo = uni.filter((u) => (prog.get(u.symbol) ?? "") < lastBar);
  let done = 0, rows = 0;
  for (let i = 0; i < todo.length && Date.now() - t0 < 100_000; i += 40) {
    const chunk = todo.slice(i, i + 40);
    const { data, error } = await sb.rpc("bars_arrays", { syms: chunk.map((u) => u.symbol), n: 1400 });
    if (error) return json({ error: error.message }, 500);
    const ind = new Map(chunk.map((u) => [u.symbol, u.sector]));
    const batch: any[] = [];
    for (const r of data ?? []) for (const s of samplesFor(toBars(r), spy)) batch.push({ symbol: r.symbol, d: s.d, industry: ind.get(r.symbol) ?? null, f: s.f, win: s.win, fwd20: s.fwd20 });
    for (let k = 0; k < batch.length; k += 2000) {
      const { error: e2 } = await sb.from("pattern_samples").upsert(batch.slice(k, k + 2000), { onConflict: "symbol,d" });
      if (e2) return json({ error: e2.message }, 500);
    }
    await sb.from("pattern_progress").upsert(chunk.map((u) => ({ symbol: u.symbol, last_bar: lastBar, done_at: new Date().toISOString() })), { onConflict: "symbol" });
    done += chunk.length; rows += batch.length;
  }
  return json({ ok: true, done: todo.length - done <= 0, processed: done, remaining: Math.max(0, todo.length - done), samples: rows, ms: Date.now() - t0 });
}

function ruleText(r: any, th: number[][]) {
  const part = (k: number, bin: number) => {
    const c = th[k - 1] ?? [];
    const lo = bin <= 1 ? null : c[bin - 2], hi = bin >= 5 ? null : c[bin - 1];
    const range = lo == null ? `below ${hi?.toFixed(2)}` : hi == null ? `above ${lo.toFixed(2)}` : `${lo.toFixed(2)} to ${hi.toFixed(2)}`;
    return `${TRAITS[k - 1]} in its ${["lowest", "2nd", "middle", "4th", "highest"][bin - 1]} fifth (${range})`;
  };
  return r.b ? `${part(r.a, r.abin)} AND ${part(r.b, r.bbin)}` : part(r.a, r.abin);
}

async function mine(sb: any) {
  const { data: rid, error } = await sb.rpc("mine_patterns", { min_n: 300 });
  if (error) return json({ error: error.message }, 500);
  const { data: run } = await sb.from("pattern_runs").select("*").eq("id", rid).single();
  const { data: held } = await sb.from("pattern_rules").select("*").eq("run_id", rid).eq("held", true).order("lift_test", { ascending: false }).limit(15);
  const { data: failed } = await sb.from("pattern_rules").select("*").eq("run_id", rid).eq("held", false).gte("lift_train", 1.5).order("lift_train", { ascending: false }).limit(6);
  if (!hasAnyLlm()) return json({ ok: true, runId: rid, held: held?.length ?? 0 });
  const fmt = (r: any) => ({ pattern: ruleText(r, run.thresholds), older_period: { cases: r.n_train, big_winner_rate: +(100 * r.rate_train).toFixed(1), lift: +r.lift_train.toFixed(2) },
    newer_period: { cases: r.n_test, big_winner_rate: +(100 * r.rate_test).toFixed(1), lift: +(r.lift_test ?? 0).toFixed(2), avg_20d_vs_spy: r.fwd20_test != null ? +r.fwd20_test.toFixed(2) : null } });
  const facts = { big_winner: "rose 30%+ (best close) within the next 60 sessions", split_date: run.split_date,
    base_rate_older: +(100 * run.base_train).toFixed(1), base_rate_newer: +(100 * run.base_test).toFixed(1), samples_older: run.n_train, samples_newer: run.n_test,
    held_up: (held ?? []).map(fmt), looked_good_then_failed: (failed ?? []).map(fmt) };
  const texts: Record<string, string> = {};
  let model = "";
  for (const lang of ["en", "he"]) {
    const res = await llmFetch({ model: "openai/gpt-oss-120b", reasoning_effort: "low", temperature: 0.3, max_tokens: 3000, messages: [
      { role: "system", content: `You explain statistical findings to a momentum trader (21 EMA pullbacks and breakouts). Use only the facts. ${lang === "he" ? "Write in natural Hebrew, gender-neutral toward the reader; keep EMA, RS, SPY as is." : "Write in plain English."} No buy/sell advice.` },
      { role: "user", content: `The app scanned years of daily prices and asked: what did stocks look like before they became big winners? Patterns were found on the older period and then checked on a newer period they never saw.
Write markdown: ## What held up (the 4–6 strongest held-up patterns in plain trading words — what the setup looks like on a chart, how much more often it led to big winners than average in the newer period, with case counts) ## What looked good but didn't hold up (and why that matters) ## How to use this (as a filter for what to study, not a signal) ## Limits (only today's listed stocks — delisted losers are missing, so results lean optimistic; markets change; a lift of 2 means twice the base rate, which is still a minority of cases).
FACTS: ${JSON.stringify(facts)}` }] }, { task: "long", label: "patterns" });
    const j = await res.json();
    if (res.ok) { texts[lang] = j.choices?.[0]?.message?.content ?? ""; model = `${j.provider}/${j.model}`; }
  }
  await sb.from("pattern_runs").update({ ai_text: texts.en ?? null, ai_text_he: texts.he ?? null, ai_model: model }).eq("id", rid);
  return json({ ok: true, runId: rid, held: held?.length ?? 0 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SB_URL, SB_KEY);
    if (body.action === "samples") return await samples(sb);
    if (body.action === "mine") return await mine(sb);
    const [{ count: done }, { count: total }, { count: n }] = await Promise.all([
      sb.from("pattern_progress").select("symbol", { count: "exact", head: true }),
      sb.from("qualified_rs_universe").select("symbol", { count: "exact", head: true }),
      sb.from("pattern_samples").select("symbol", { count: "exact", head: true }),
    ]);
    return json({ done, total, samples: n });
  } catch (e) {
    console.error("[pattern-finder]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
