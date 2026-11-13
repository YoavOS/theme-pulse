// proven-strength — has this business earned more than its capital costs, for how long, and is it
// holding? (Damodaran's definition of a good business, measured over ~10 years of 10-Ks.)
//
//   POST { symbol }                         compute one now (also used on demand by the app)
//   POST { action: "batch", limit?, force? } nightly: work through the RS universe, missing first,
//                                           then the stalest (≥ 7 days); a company is re-scored only
//                                           when a newer 10-K appears or the scoring version changes
//
// Hurdle = Damodaran's cost of capital for the company's industry (January table; floor 6%).
// Every company gets a verdict — young ones on their own track (see _shared/provenEngine.ts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { SEC_UA, secCik } from "../_shared/secFundamentals.ts";
import { classifyLabel } from "../_shared/gicsTaxonomy.ts";
import { resolveDamodaranIndustry } from "../_shared/damodaranMap.ts";
import { defaultRndLife, TOTAL_MARKET } from "../_shared/damodaran.ts";
import { evaluate, parseAnnualPanel, PROVEN_VERSION, yearMetrics, type EngineCtx } from "../_shared/provenEngine.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STALE_MS = 7 * 86400_000;
const BUDGET_MS = 110_000;       // stay inside the edge wall-clock limit
const CONCURRENCY = 3;           // SEC asks for ≤ 10 requests/second

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const cleanSymbol = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
// deno-lint-ignore no-explicit-any
type Sb = any;

/** Damodaran industry figures the engine needs (latest January table), keyed by industry. */
async function loadBench(sb: Sb) {
  const { data: latest } = await sb.from("damodaran_benchmarks").select("source_year, as_of").order("source_year", { ascending: false }).limit(1).maybeSingle();
  const idx = new Map<string, Record<string, number>>();
  if (!latest) return { idx, asOf: null as string | null };
  const { data } = await sb.from("damodaran_benchmarks").select("industry, metric, value")
    .eq("source_year", latest.source_year).in("metric", ["cost_of_capital", "cost_of_equity", "gross_margin", "sales_to_capital"]);
  for (const r of data ?? []) { if (!idx.has(r.industry)) idx.set(r.industry, {}); idx.get(r.industry)![r.metric] = Number(r.value); }
  return { idx, asOf: latest.as_of ?? `January ${latest.source_year}` };
}
type Bench = Awaited<ReturnType<typeof loadBench>>;

async function scoreOne(sb: Sb, symbol: string, sector: string | null, bench: Bench, prev: { last_10k_filed: string | null; calc_version: number } | null, force: boolean) {
  const cik = await secCik(symbol);
  const base = { symbol, cik, calc_version: PROVEN_VERSION, computed_at: new Date().toISOString() };
  if (!cik) return { ...base, status: "not_sec_filer", sentence: "Not an SEC filer (foreign listing, ETF or unknown ticker) — no 10-K history to judge." };
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
  if (!r.ok) { await r.body?.cancel(); throw new Error(`SEC HTTP ${r.status}`); }
  const panel = parseAnnualPanel(await r.json());
  if (!panel.length) return { ...base, status: "no_annual_filings", sentence: "No US-GAAP annual filings (IFRS / 20-F filer, or too new) — nothing to judge yet." };
  const lastFiled = panel[0].filed;
  // unchanged since the last scoring → just mark it checked
  if (!force && prev && prev.calc_version === PROVEN_VERSION && prev.last_10k_filed === lastFiled) return { ...base, status: "unchanged" as const };

  const classification = classifyLabel(sector);
  const financial = classification.sector === "Financials";
  const { data: own } = await sb.from("damodaran_tickers").select("industry").eq("symbol", symbol).maybeSingle();
  let ind = resolveDamodaranIndustry(own?.industry ?? null, classification.subIndustry !== "Other" ? classification.subIndustry : null);
  if (!bench.idx.has(ind.name)) ind = resolveDamodaranIndustry(null, classification.subIndustry);
  const row = bench.idx.get(ind.name) ?? bench.idx.get(TOTAL_MARKET) ?? {};
  const hurdleSource = bench.idx.has(ind.name) && ind.match !== "market"
    ? `Damodaran cost of capital, ${ind.name} (${bench.asOf})` : bench.idx.has(TOTAL_MARKET) ? `Damodaran cost of capital, whole market (${bench.asOf})` : "app assumption (8%) — Damodaran data not loaded";
  const ctx: EngineCtx = {
    hurdle: row.cost_of_capital ?? 8, costOfEquity: row.cost_of_equity ?? null, financial,
    rndLife: defaultRndLife(ind.match !== "market" ? ind.name : null, classification.sector),
    industry: ind.match !== "market" ? ind.name : null, industryGm: row.gross_margin ?? null, industrySalesToCapital: row.sales_to_capital ?? null,
  };
  const ms = yearMetrics(panel, ctx);
  const v = evaluate(ms, ctx);

  const years = ms.filter((m) => m.end).map((m) => ({
    symbol, fy_end: m.end, filed: m.filed, revenue: m.revenue, nopat: m.nopat, invested_capital: m.ic, roic: m.roic, roic_rd: m.roicRd, roic_ex_gw: m.roicExGw,
    primary_roic: m.primary, hurdle: m.hurdle, spread: m.spread, economic_profit: m.ep, pooled3: m.pooled3, margin: m.margin, turnover: m.turnover,
    gross_margin: m.gm, op_margin: m.opMargin, fcf: m.fcf, rnd_rev: m.rndRev, sbc_rev: m.sbcRev, reinvest: m.reinvest, coverage: m.coverage,
    nd_ebitda: m.ndEbitda, roe: m.roe, rev_growth: m.revGrowth, shares: m.shares, calc_version: PROVEN_VERSION,
  }));
  const { error: yErr } = await sb.from("company_year_metrics").upsert(years, { onConflict: "symbol,fy_end" });
  if (yErr) console.error("company_year_metrics", symbol, yErr.message);
  return {
    ...base, status: "ok", error: null, as_of: v.asOf, last_10k_filed: lastFiled, track: v.track, label: v.label, sentence: v.sentence, why: v.why,
    years_valid: v.yearsValid, years_above: v.yearsAbove, median_spread: v.medianSpread, min_pooled_spread: v.minPooledSpread, cum_ep: v.cumEp,
    spread_slope: v.spreadSlope, hurdle: v.hurdle, hurdle_source: hurdleSource, industry: ctx.industry, archetype: v.archetype, archetypes: v.archetypes,
    flags: v.flags, checks: v.checks, gates: v.gates, series: v.series, score: v.score,
  };
}

async function save(sb: Sb, row: Record<string, unknown>) {
  if (row.status === "unchanged") {
    await sb.from("proven_strength").update({ computed_at: row.computed_at }).eq("symbol", row.symbol);
    return;
  }
  const { error } = await sb.from("proven_strength").upsert(row, { onConflict: "symbol" });
  if (error) throw new Error(`proven_strength: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb: Sb = createClient(SB_URL, SB_KEY);
  const body = await req.json().catch(() => ({}));
  const t0 = Date.now();
  try {
    const bench = await loadBench(sb);

    if (body.action !== "batch") {
      const symbol = cleanSymbol(body.symbol);
      if (!symbol) return json({ error: "symbol required" }, 400);
      const [{ data: u }, { data: prev }] = await Promise.all([
        sb.from("qualified_rs_universe").select("sector").eq("symbol", symbol).maybeSingle(),
        sb.from("proven_strength").select("*").eq("symbol", symbol).maybeSingle(),
      ]);
      // fresh enough → serve what's stored
      if (!body.force && prev && prev.calc_version === PROVEN_VERSION && Date.now() - Date.parse(prev.computed_at) < STALE_MS) return json(prev);
      let sector: string | null = u?.sector ?? null;
      if (!sector) { const { data: f } = await sb.from("stock_fundamentals").select("sector").eq("symbol", symbol).maybeSingle(); sector = f?.sector ?? null; }
      const row = await scoreOne(sb, symbol, sector, bench, prev, body.force === true);
      await save(sb, row);
      if (row.status === "unchanged") return json({ ...prev, computed_at: row.computed_at });
      return json(row);
    }

    // ── batch ──
    const limit = Math.max(1, Math.min(200, Number(body.limit) || 60));
    const universe: { symbol: string; sector: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("qualified_rs_universe").select("symbol, sector").range(from, from + 999);
      if (error) throw error;
      universe.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const known = new Map<string, { computed_at: string; calc_version: number; last_10k_filed: string | null }>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("proven_strength").select("symbol, computed_at, calc_version, last_10k_filed").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) known.set(r.symbol, r);
      if (!data || data.length < 1000) break;
    }
    const now = Date.now();
    const due = universe
      .map((u) => ({ ...u, symbol: u.symbol.toUpperCase(), k: known.get(u.symbol.toUpperCase()) }))
      .filter((u) => body.force === true || !u.k || u.k.calc_version !== PROVEN_VERSION || now - Date.parse(u.k.computed_at) > STALE_MS)
      .sort((a, b) => (a.k ? Date.parse(a.k.computed_at) : 0) - (b.k ? Date.parse(b.k.computed_at) : 0))
      .slice(0, limit);

    const counts: Record<string, number> = {};
    const errors: string[] = [];
    let i = 0;
    const worker = async () => {
      while (i < due.length && Date.now() - t0 < BUDGET_MS) {
        const u = due[i++];
        try {
          const row = await scoreOne(sb, u.symbol, u.sector, bench, u.k ? { last_10k_filed: u.k.last_10k_filed, calc_version: u.k.calc_version } : null, body.force === true);
          await save(sb, row);
          counts[row.status] = (counts[row.status] ?? 0) + 1;
          if (row.status === "ok" && "label" in row) counts[`label:${row.label}`] = (counts[`label:${row.label}`] ?? 0) + 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${u.symbol}: ${msg}`);
          await sb.from("proven_strength").upsert({ symbol: u.symbol, status: "error", error: msg.slice(0, 300), calc_version: PROVEN_VERSION, computed_at: new Date().toISOString() }, { onConflict: "symbol" });
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const remaining = universe.filter((u) => { const k = known.get(u.symbol.toUpperCase()); return !k || k.calc_version !== PROVEN_VERSION; }).length;
    return json({ processed: Math.min(i, due.length), due: due.length, counts, errors: errors.slice(0, 10), universe: universe.length, notYetScored: remaining, ms: Date.now() - t0, benchmarks: bench.asOf ?? "not loaded" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("proven-strength", msg);
    return json({ error: msg }, 500);
  }
});
