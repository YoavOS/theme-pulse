// daily-lists — builds Today's lists from the daily price history (daily_bars):
//   ema21         stocks that ran a lot since they last touched the daily 21 EMA and are now back near it,
//                 in a stage 2 trend, ranked with their group's strength and volume drying up on the pullback
//   redday        stocks that were bought on red market days (SPY down ≥ 0.75%) over the last ~4 weeks
//   redday_group  industries and themes whose members were bought on those red days
// POST { minRun?: 40, day?: "YYYY-MM-DD" }. Rebuilds the lists for the latest closed session.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildEma21, buildRedDay, type Bars, type Ctx } from "../_shared/lists.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function all(sb: any, table: string, cols: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(SB_URL, SB_KEY);
    const body = await req.json().catch(() => ({}));
    const minRun = Number(body.minRun) || 40;

    const [uni, stages, tt, themes] = await Promise.all([
      all(sb, "qualified_rs_universe", "symbol, company_name, sector, rs_overall, market_cap"),
      all(sb, "stock_stages", "symbol, stage, substage"),
      all(sb, "theme_tickers", "theme_id, ticker_symbol"),
      all(sb, "themes", "id, name"),
    ]);
    const themeName = new Map(themes.map((t: any) => [t.id, t.name]));
    const ctx: Ctx = {
      info: new Map(uni.map((u: any) => [u.symbol, { name: u.company_name, industry: u.sector, rs: u.rs_overall, cap: u.market_cap }])),
      stage: new Map(stages.map((s: any) => [s.symbol, s.stage])),
      themesOf: new Map(),
    };
    for (const r of tt) {
      const s = String(r.ticker_symbol).toUpperCase();
      const n = themeName.get(r.theme_id);
      if (!n) continue;
      ctx.themesOf.set(s, [...(ctx.themesOf.get(s) ?? []), n]);
    }

    // price history, 500 symbols at a time
    const symbols = [...new Set([...ctx.info.keys(), ...ctx.themesOf.keys(), "SPY"])];
    const bars = new Map<string, Bars>();
    for (let i = 0; i < symbols.length; i += 500) {
      const { data, error } = await sb.rpc("bars_arrays", { syms: symbols.slice(i, i + 500), n: 260 });
      if (error) throw new Error(`bars_arrays: ${error.message}`);
      for (const r of data ?? []) bars.set(r.symbol, { d: r.d, h: r.h, l: r.l, c: r.c, v: (r.v ?? []).map((x: any) => Number(x ?? 0)) });
    }
    const spy = bars.get("SPY");
    if (!spy || spy.d.length < 60) return json({ error: "No SPY history yet — the price download (daily-bars) hasn't finished." }, 409);
    const day = body.day ?? spy.d[spy.d.length - 1];
    const covered = [...ctx.info.keys()].filter((s) => bars.get(s)?.d.at(-1) === day).length;
    if (covered < ctx.info.size * 0.8 && !body.force) return json({ waiting: true, day, covered, universe: ctx.info.size }, 202);

    const ema = buildEma21(bars, ctx, day, minRun);
    const red = buildRedDay(bars, ctx, day);
    const rows = [
      ...ema.map((r, i) => ({ day, list: "ema21", symbol: r.symbol, rank: i + 1, grp: r.grp, score: r.score, evidence: r.evidence })),
      ...red.stocks.map((r, i) => ({ day, list: "redday", symbol: r.symbol, rank: i + 1, grp: r.grp, score: r.score, evidence: r.evidence })),
      ...red.groups.map((r, i) => ({ day, list: "redday_group", symbol: r.name, rank: i + 1, grp: r.kind, score: r.score, evidence: r.evidence })),
    ];
    await sb.from("today_list").delete().eq("day", day);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from("today_list").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`today_list: ${error.message}`);
    }
    return json({ ok: true, day, ema21: ema.length, redday: red.stocks.length, groups: red.groups.length, redDays: red.redDays });
  } catch (e) {
    console.error("[daily-lists]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
