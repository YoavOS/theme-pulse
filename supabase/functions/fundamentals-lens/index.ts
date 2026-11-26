// fundamentals-lens — the Fundamentals Lens side panel.
//
// POST { symbol, refresh? }                       → LensPayload (metrics, peers, life cycle, concept cards)
// POST { action: "explain", symbol, conceptId }   → grounded explanation for one card (or "story")
//
// Company numbers come from SEC companyfacts (computed in code: lib _shared/lensMetrics.ts).
// Peers come from the app's stock_fundamentals + GICS-style classification of the universe.
// Explanations: the AI only verbalises the computed facts; _shared/lensPayload.ts validates every
// number against them and falls back to a template sentence when it doesn't pass.
// Industry averages: Aswath Damodaran's January data (damodaran_benchmarks, loaded yearly by the
// damodaran-benchmarks function). His own company list picks the industry; otherwise the app's
// GICS → Damodaran crosswalk (_shared/damodaranMap.ts).
// Caches: lens_cache (12h per symbol), lens_explanations (per symbol + concept + facts hash).

import { companyFinancials, companyClassification } from "../_shared/companyFinancials.ts";
import { readEarningsRelease, reportingWindow } from "../_shared/earningsRelease.ts";
import { foreignQuarterlyReports } from "../_shared/foreignEarnings.ts";
import { lensConnection } from "../_shared/lensConnections.ts";
import { lensMarketFallback, positive } from "../_shared/lensMarket.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { SEC_UA, secCik } from "../_shared/secFundamentals.ts";
import { classifyLabel } from "../_shared/gicsTaxonomy.ts";
import { parseLensHistory, type CompanyHistory } from "../_shared/lensMetrics.ts";
import {
  LENS_VERSION, PEER_FIELDS, buildPayload, computePeers, explanationPrompt, factsFor, factsHash, templateExplanation, validateExplanation,
  type Explanation, type LensPayload, type PeerRow,
} from "../_shared/lensPayload.ts";
import { industryProfile, indexBenchmarks, TOTAL_MARKET, TOTAL_MARKET_EX_FIN, type BenchIndex, type IndustryProfile } from "../_shared/damodaran.ts";
import { resolveDamodaranIndustry } from "../_shared/damodaranMap.ts";
import { extractJson, hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_MS = 12 * 3600_000;
const PROMPT_VERSION = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const cleanSymbol = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);

// deno-lint-ignore no-explicit-any
type Sb = any;

async function readAll<T>(sb: Sb, table: string, cols: string): Promise<T[]> {
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

async function fetchHistory(symbol: string): Promise<{ history: CompanyHistory; status: string }> {
  const empty: CompanyHistory = { quarters: [], annual: [], firstFiled: null, ifrsOnly: false };
  const cik = await secCik(symbol);
  if (!cik) return { history: empty, status: "Not an SEC filer (foreign listing, ETF or unknown ticker) — no company filings to read." };
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": SEC_UA } });
  if (!r.ok) { await r.body?.cancel(); return { history: empty, status: `SEC data unavailable (HTTP ${r.status}).` }; }
  const history = parseLensHistory(await r.json());
  const status = history.quarters.length >= 8 ? "ok"
    : history.ifrsOnly ? "Files under international (IFRS) accounting, usually annual only — quarterly metrics aren't available."
    : history.quarters.length ? `Only ${history.quarters.length} quarters of filings — some year-over-year numbers are missing.`
    : "No quarterly filings found (20-F/40-F filer?).";
  return { history, status };
}

/** Damodaran's latest industry figures for this company's industry (null if not loaded yet). */
async function loadBench(sb: Sb, symbol: string, subIndustry: string | null): Promise<{ idx: BenchIndex; profile: IndustryProfile } | null> {
  const { data: latest } = await sb.from("damodaran_benchmarks").select("source_year, as_of").order("source_year", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const { data: own } = await sb.from("damodaran_tickers").select("industry").eq("symbol", symbol).maybeSingle();
  const r = resolveDamodaranIndustry(own?.industry ?? null, subIndustry && subIndustry !== "Other" ? subIndustry : null);
  const { data: rows, error } = await sb.from("damodaran_benchmarks").select("industry, metric, value, unit, n_firms")
    .eq("source_year", latest.source_year).in("industry", [r.name, TOTAL_MARKET, TOTAL_MARKET_EX_FIN]);
  if (error || !rows?.length) return null;
  const idx = indexBenchmarks(rows);
  // his list can name an industry spelled differently from the tables; fall back to the crosswalk
  const res = idx.has(r.name) ? r : resolveDamodaranIndustry(null, subIndustry);
  if (res !== r && res.match === "mapped" && !idx.has(res.name)) {
    const { data: more } = await sb.from("damodaran_benchmarks").select("industry, metric, value, unit, n_firms").eq("source_year", latest.source_year).eq("industry", res.name);
    for (const [k, v] of indexBenchmarks(more ?? [])) idx.set(k, v);
  }
  return { idx, profile: industryProfile(idx, res.name, res.match, res.confidence, res.from, latest.as_of ?? `January ${latest.source_year}`) };
}

let peerInput: { at: number; value: Promise<[any[], any[]]> } | null = null;
function peerInputs(sb: Sb, cols: string) {
  if (!peerInput || Date.now() - peerInput.at > 600000) {
    const value = Promise.all([readAll<any>(sb, "qualified_rs_universe", "symbol, sector"), readAll<any>(sb, "stock_fundamentals", cols)]) as Promise<[any[], any[]]>;
    peerInput = { at: Date.now(), value };
    value.catch(() => { peerInput = null; });
  }
  return peerInput.value;
}
async function buildLens(sb: Sb, symbol: string, refresh = false): Promise<LensPayload> {
  const [{ data: uRow }, { data: fRow }, { data: description }] = await Promise.all([
    sb.from("qualified_rs_universe").select("symbol, company_name, sector, market_cap, current_price, qualified_at").eq("symbol", symbol).maybeSingle(),
    sb.from("stock_fundamentals").select("company_name, sector, market_cap, price, fetched_at, pe_ratio, ps_ratio, pb_ratio").eq("symbol", symbol).maybeSingle(),
    sb.from("ticker_classification").select("description").eq("symbol", symbol).maybeSingle(),
  ]);
  const sectorLabel: string | null = uRow?.sector ?? fRow?.sector ?? null;
  const hasFundCap = positive(fRow?.market_cap);
  const hasUniversePrice = positive(uRow?.current_price);
  const capDate = hasFundCap ? fRow?.fetched_at : uRow?.qualified_at;
  const priceDate = hasUniversePrice ? uRow?.qualified_at : fRow?.fetched_at;
  const old = (date: string | undefined) => !date || Date.now() - Date.parse(date) > 2 * 86400000;
  const [shared, fresh] = await Promise.all([
    companyFinancials(sb, symbol, refresh),
    lensMarketFallback(symbol, {
      cap: refresh || old(capDate) || (!hasFundCap && !positive(uRow?.market_cap)),
      price: refresh || old(priceDate) || (!hasUniversePrice && !positive(fRow?.price)),
      multiples: ![fRow?.pe_ratio, fRow?.ps_ratio, fRow?.pb_ratio].some(positive),
    }),
  ]);
  const classification = companyClassification(sectorLabel, shared.sic);
  const financial = classification.sector === "Financials";
  const marketCap = fresh.cap ?? (hasFundCap ? fRow.market_cap : positive(uRow?.market_cap) ? uRow.market_cap * 1e6 : null);
  const price = fresh.price ?? (hasUniversePrice ? uRow.current_price : positive(fRow?.price) ? fRow.price : null);

  // Peers: everyone in the universe with provider fundamentals, grouped by the same taxonomy.
  const cols = ["symbol", ...new Set(Object.values(PEER_FIELDS).map((f) => f.col))].join(", ");
  const [uni, funds, bench, earningsRelease, foreign] = await Promise.all([
    peerInputs(sb, cols).then(([u]) => u),
    peerInputs(sb, cols).then(([,f]) => f),
    loadBench(sb, symbol, classification.subIndustry).catch((e) => { console.error("benchmarks", e); return null; }),
    shared.earningsFiling && shared.history.quarters[0]
      ? readEarningsRelease(shared.earningsFiling, shared.history.quarters[0].end)
      : null,
    !shared.history.quarters.length && shared.foreignFilings?.length ? foreignQuarterlyReports(shared.foreignFilings) : null,
  ]);
  const sectorOf = new Map(uni.map((u) => [u.symbol.toUpperCase(), u.sector]));
  if (!sectorOf.has(symbol)) sectorOf.set(symbol, sectorLabel);
  const rows: PeerRow[] = [];
  for (const f of funds) {
    const sym = String(f.symbol).toUpperCase();
    if (!sectorOf.has(sym)) continue;
    const values: Record<string, number | null> = {};
    for (const { col } of Object.values(PEER_FIELDS)) values[col] = typeof f[col] === "number" ? (f[col] as number) : null;
    rows.push({ symbol: sym, group: classifyLabel(sectorOf.get(sym) ?? null), values });
  }
  const peers = computePeers(symbol, rows);

  const releaseQuarters = foreign?.quarters;
  const history: CompanyHistory = releaseQuarters?.length ? { ...shared.history, quarters: releaseQuarters } : shared.history;
  const secStatus = releaseQuarters?.length ? "Quarterly financial results from SEC Form 6-K."
    : history.quarters.length >= 8 ? "ok" : "Limited supported US-GAAP quarterly history. Missing fields are not zero.";
  const payload = buildPayload({
    symbol, company: uRow?.company_name ?? fRow?.company_name ?? shared.company, classification, financial,
    history, market: { price, marketCap, asOf: fresh.cap !== null ? fresh.capDate : capDate ?? null }, secStatus, peers, bench,
  });
  payload.connection = lensConnection(history.quarters);
  payload.businessContext = {
    description: typeof description?.description === "string" ? description.description.trim().slice(0, 700) || null : null,
    industry: shared.secBusiness?.industry ?? null,
    annualUrl: shared.secBusiness?.annualUrl ?? null,
    annualFiled: shared.secBusiness?.annualFiled ?? null,
  };
  payload.marketPricing = {
    capDate: marketCap === null ? null : payload.market.asOf,
    priceDate: price === null ? null : fresh.priceDate ?? priceDate ?? null,
    multiplesDate: fresh.multiplesDate ?? fRow?.fetched_at ?? null,
    pe: positive(fRow?.pe_ratio) ? fRow.pe_ratio : fresh.pe,
    ps: positive(fRow?.ps_ratio) ? fRow.ps_ratio : fresh.ps,
    pb: positive(fRow?.pb_ratio) ? fRow.pb_ratio : fresh.pb,
    peerPe: positive(fRow?.pe_ratio) ? peers.pe ?? null : null,
  };
  return { ...payload, earningsRelease: foreign?.earningsRelease ?? earningsRelease };
}

async function getLens(sb: Sb, symbol: string, refresh: boolean): Promise<LensPayload> {
  if (!refresh) {
    const { data } = await sb.from("lens_cache").select("payload, computed_at").eq("symbol", symbol).maybeSingle();
    const maxAge = reportingWindow(data?.payload?.sec?.asOf ?? null) ? 3600_000 : CACHE_MS;
    if (data?.payload && data.payload.version === LENS_VERSION && Date.now() - Date.parse(data.computed_at) < maxAge) {
      const current = await loadBench(sb, symbol, data.payload.classification?.subIndustry ?? null);
      const { source, ...saved } = data.payload.damodaran ?? {};
      if (JSON.stringify(saved) === JSON.stringify(current?.profile ?? {})) return data.payload as LensPayload;
    }
  }
  const payload = await buildLens(sb, symbol, refresh);
  await sb.from("lens_cache").upsert({ symbol, payload, computed_at: payload.computedAt }, { onConflict: "symbol" });
  return payload;
}

async function explain(sb: Sb, p: LensPayload, conceptId: string): Promise<Explanation & { facts: number }> {
  const facts = factsFor(p, conceptId);
  const hash = factsHash(facts);
  const { data: hit } = await sb.from("lens_explanations").select("payload").eq("symbol", p.symbol).eq("concept_id", conceptId).eq("facts_hash", hash).eq("prompt_version", PROMPT_VERSION).maybeSingle();
  if (hit?.payload) return { ...(hit.payload as Explanation), facts: facts.length };

  let result: Explanation = templateExplanation(p, conceptId);
  return { ...result, facts: facts.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = cleanSymbol(body.symbol);
    if (!symbol) return json({ error: "symbol required" }, 400);
    const sb: Sb = createClient(SB_URL, SB_KEY);
    if (body.action === "explain") {
      const conceptId = String(body.conceptId ?? "").slice(0, 40);
      const p = await getLens(sb, symbol, false);
      if (conceptId !== "story" && !p.cards.some((c) => c.id === conceptId)) return json({ error: "unknown concept" }, 400);
      return json(await explain(sb, p, conceptId));
    }
    return json(await getLens(sb, symbol, body.refresh === true));
  } catch (e) {
    console.error("fundamentals-lens error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
