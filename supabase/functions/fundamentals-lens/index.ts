// fundamentals-lens — the Fundamentals Lens side panel.
//
// POST { symbol, refresh? }                       → LensPayload (metrics, peers, life cycle, concept cards)
// POST { action: "explain", symbol, conceptId }   → grounded explanation for one card (or "story")
//
// Company numbers come from SEC companyfacts (computed in code: lib _shared/lensMetrics.ts).
// Peers come from the app's stock_fundamentals + GICS-style classification of the universe.
// Explanations: the AI only verbalises the computed facts; _shared/lensPayload.ts validates every
// number against them and falls back to a template sentence when it doesn't pass.
// Caches: lens_cache (12h per symbol), lens_explanations (per symbol + concept + facts hash).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { SEC_UA, secCik } from "../_shared/secFundamentals.ts";
import { classifyLabel } from "../_shared/gicsTaxonomy.ts";
import { parseLensHistory, type CompanyHistory } from "../_shared/lensMetrics.ts";
import {
  LENS_VERSION, PEER_FIELDS, buildPayload, computePeers, explanationPrompt, factsFor, factsHash, templateExplanation, validateExplanation,
  type Explanation, type LensPayload, type PeerRow,
} from "../_shared/lensPayload.ts";
import { extractJson, hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_MS = 12 * 3600_000;
const PROMPT_VERSION = 1;

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

async function buildLens(sb: Sb, symbol: string): Promise<LensPayload> {
  const [{ data: uRow }, { data: fRow }] = await Promise.all([
    sb.from("qualified_rs_universe").select("symbol, company_name, sector, market_cap, current_price").eq("symbol", symbol).maybeSingle(),
    sb.from("stock_fundamentals").select("*").eq("symbol", symbol).maybeSingle(),
  ]);
  const sectorLabel: string | null = uRow?.sector ?? fRow?.sector ?? null;
  const classification = classifyLabel(sectorLabel);
  const financial = classification.sector === "Financials";
  const marketCap = typeof fRow?.market_cap === "number" ? fRow.market_cap : typeof uRow?.market_cap === "number" ? uRow.market_cap * 1e6 : null;
  const price = typeof uRow?.current_price === "number" ? uRow.current_price : typeof fRow?.price === "number" ? fRow.price : null;

  // Peers: everyone in the universe with provider fundamentals, grouped by the same taxonomy.
  const cols = ["symbol", ...new Set(Object.values(PEER_FIELDS).map((f) => f.col))].join(", ");
  const [uni, funds, hist] = await Promise.all([
    readAll<{ symbol: string; sector: string | null }>(sb, "qualified_rs_universe", "symbol, sector"),
    readAll<Record<string, number | string | null>>(sb, "stock_fundamentals", cols),
    fetchHistory(symbol),
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

  return buildPayload({
    symbol, company: uRow?.company_name ?? fRow?.company_name ?? null, classification, financial,
    history: hist.history, market: { price, marketCap, asOf: fRow?.fetched_at ?? null }, secStatus: hist.status, peers,
  });
}

async function getLens(sb: Sb, symbol: string, refresh: boolean): Promise<LensPayload> {
  if (!refresh) {
    const { data } = await sb.from("lens_cache").select("payload, computed_at").eq("symbol", symbol).maybeSingle();
    if (data?.payload && data.payload.version === LENS_VERSION && Date.now() - Date.parse(data.computed_at) < CACHE_MS) return data.payload as LensPayload;
  }
  const payload = await buildLens(sb, symbol);
  await sb.from("lens_cache").upsert({ symbol, payload, computed_at: payload.computedAt }, { onConflict: "symbol" });
  return payload;
}

async function explain(sb: Sb, p: LensPayload, conceptId: string): Promise<Explanation & { facts: number }> {
  const facts = factsFor(p, conceptId);
  const hash = factsHash(facts);
  const { data: hit } = await sb.from("lens_explanations").select("payload").eq("symbol", p.symbol).eq("concept_id", conceptId).eq("facts_hash", hash).eq("prompt_version", PROMPT_VERSION).maybeSingle();
  if (hit?.payload) return { ...(hit.payload as Explanation), facts: facts.length };

  let result: Explanation = templateExplanation(p, conceptId);
  if (hasAnyLlm() && facts.length > 3) {
    const { system, user } = explanationPrompt(p, conceptId, facts);
    const messages = [{ role: "system", content: system }, { role: "user", content: user }];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await llmFetch({ messages, temperature: 0.2, max_tokens: 700, response_format: { type: "json_object" } }, { task: "fast", label: "fundamentals-lens" });
        if (!res.ok) break;
        const j = await res.json();
        const content = j?.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(extractJson(String(content)));
        const v = validateExplanation(parsed, facts);
        if (v.ok) { result = { sentences: v.sentences, missing: v.missing, source: "model", provider: j?.provider }; break; }
        // one retry, telling the model exactly what failed
        messages.push({ role: "assistant", content: String(content) }, { role: "user", content: `Your answer broke these rules: ${v.errors.join("; ")}. Fix them and reply with the JSON only.` });
      } catch (e) {
        console.error("explain attempt failed", e);
        break;
      }
    }
  }
  if (result.source === "model") {
    await sb.from("lens_explanations").upsert({ symbol: p.symbol, concept_id: conceptId, facts_hash: hash, prompt_version: PROMPT_VERSION, payload: result }, { onConflict: "symbol,concept_id,facts_hash,prompt_version" });
  }
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
