// company-file — "From the filings": what the company says about itself, read by the AI and checked against its numbers.
//   POST { symbol, step: "prepare" }          download the latest 10-K (business, risk factors, management's discussion),
//                                             last year's risk factors, the latest earnings release, and the backlog
//   POST { symbol, step: "story", lang }      the AI: the business in plain words, competitors, customers, the 3P test,
//                                             where management's words and the numbers disagree, guidance
//   POST { symbol, step: "risks", lang }      the AI: which risks are new or gone since last year, and why that matters
//   POST { symbol, step: "get", lang }        the saved result
// Every quote is checked against the filing text; a quote that isn't found word-for-word is marked unverified.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { extractJson, hasAnyLlm } from "../_shared/llm.ts";
import { jobState, runAi, type Finisher } from "../_shared/aiJobs.ts";
import { SEC_UA, secCik } from "../_shared/secFundamentals.ts";
import { clipText, diffRisks, htmlToText, riskHeadings, tenKSections } from "../_shared/filingText.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const sec = (url: string) => fetch(url, { headers: { "User-Agent": SEC_UA, Accept: "*/*" }, signal: AbortSignal.timeout(45_000) });
const archive = (cik: number, acc: string, file: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}/${file}`;

async function prepare(sb: any, symbol: string) {
  const cik = await secCik(symbol);
  if (!cik) return json({ error: `${symbol} doesn't file with the SEC (a foreign listing or an unknown ticker).` }, 404);
  const r = await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  if (!r.ok) return json({ error: `SEC submissions: HTTP ${r.status}` }, 502);
  const sub = await r.json();
  const f = sub?.filings?.recent ?? {};
  const idx = (pred: (i: number) => boolean) => { const out: number[] = []; for (let i = 0; i < (f.form?.length ?? 0); i++) if (pred(i)) out.push(i); return out; };
  const tenKs = idx((i) => f.form[i] === "10-K");
  const releases = idx((i) => f.form[i] === "8-K" && String(f.items?.[i] ?? "").includes("2.02"));
  if (!tenKs.length) return json({ error: `No 10-K found for ${symbol} (it may file 20-F or 40-F as a foreign company).` }, 404);

  const { data: have } = await sb.from("filing_texts").select("tenk_acc, release_acc").eq("symbol", symbol).maybeSingle();
  const k0 = tenKs[0], k1 = tenKs[1], rel = releases[0];
  if (have && have.tenk_acc === f.accessionNumber[k0] && have.release_acc === (rel != null ? f.accessionNumber[rel] : null)) return json({ ok: true, cached: true });

  const doc = async (i: number) => { const x = await sec(archive(cik, f.accessionNumber[i], f.primaryDocument[i])); return x.ok ? htmlToText(await x.text()) : ""; };
  const cur = tenKSections(await doc(k0));
  const prev = k1 != null ? tenKSections(await doc(k1)) : null;
  const now = riskHeadings(cur.risks), before = prev ? riskHeadings(prev.risks) : [];
  const diff = prev && now.length >= 5 && before.length >= 5 ? diffRisks(now, before) : { added: [], removed: [] };

  // earnings release = the 8-K's exhibit 99
  let release = "", releaseUrl: string | null = null;
  if (rel != null) {
    const ix = await sec(archive(cik, f.accessionNumber[rel], "index.json"));
    if (ix.ok) {
      const items: { name: string }[] = (await ix.json())?.directory?.item ?? [];
      const ex = items.find((x) => /ex-?99(\.?1)?[^0-9]?.*\.htm/i.test(x.name)) ?? items.find((x) => /99/.test(x.name) && /\.htm/i.test(x.name));
      if (ex) { releaseUrl = archive(cik, f.accessionNumber[rel], ex.name); const t = await sec(releaseUrl); if (t.ok) release = htmlToText(await t.text()); }
    }
  }
  // backlog: remaining performance obligations (XBRL)
  let rpo: { end: string; val: number }[] = [];
  const c = await sec(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/RevenueRemainingPerformanceObligation.json`);
  if (c.ok) {
    const byEnd = new Map<string, number>();
    for (const x of (await c.json())?.units?.USD ?? []) byEnd.set(x.end, x.val);
    rpo = [...byEnd].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([end, val]) => ({ end, val }));
  } else await c.body?.cancel();

  const row = {
    symbol, cik,
    tenk_acc: f.accessionNumber[k0], tenk_filed: f.filingDate[k0], tenk_url: archive(cik, f.accessionNumber[k0], f.primaryDocument[k0]),
    prev_acc: k1 != null ? f.accessionNumber[k1] : null, prev_filed: k1 != null ? f.filingDate[k1] : null,
    release_acc: rel != null ? f.accessionNumber[rel] : null, release_filed: rel != null ? f.filingDate[rel] : null, release_url: releaseUrl,
    business: clipText(cur.business, 60_000), risks: clipText(cur.risks, 120_000), mdna: clipText(cur.mdna, 80_000), release: clipText(release, 30_000),
    risks_added: diff.added, risks_removed: diff.removed, rpo, fetched_at: new Date().toISOString(),
  };
  const { error } = await sb.from("filing_texts").upsert(row, { onConflict: "symbol" });
  if (error) throw new Error(`filing_texts: ${error.message}`);
  return json({ ok: true, sections: { business: cur.business.length, risks: cur.risks.length, mdna: cur.mdna.length, release: release.length }, risksAdded: diff.added.length, risksRemoved: diff.removed.length, rpo: rpo.length });
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
/** Mark each quote verified only if it appears word-for-word in the text it claims to come from. */
function verifyQuotes(x: any, texts: Record<string, string>) {
  const all = norm(Object.values(texts).join(" "));
  const walk = (o: any) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === "object") {
      if (typeof o.quote === "string" && o.quote.trim()) o.verified = all.includes(norm(o.quote).replace(/^["'…. ]+|["'…. ]+$/g, ""));
      Object.values(o).forEach(walk);
    }
  };
  walk(x);
  return x;
}

const FIN: Record<string, Finisher> = {};
/** One model call: queued on the PC model (→ { job }) or answered now on the cloud keys (→ the finisher's output). */
const ai = (sb: any, kind: string, params: any, messages: any[], label: string) =>
  runAi(sb, "company-file", kind, params, { model: "openai/gpt-oss-120b", reasoning_effort: "low", temperature: 0.2, max_tokens: 5000, response_format: { type: "json_object" }, messages }, FIN[kind], { label });
const parsed = (msg: any) => JSON.parse(extractJson(msg?.content ?? "{}"));
const LANG = (lang: string) => (lang === "he" ? "Write every text value in natural Hebrew (gender-neutral), but keep each \"quote\" exactly as it appears in the English filing." : "Write in plain English for a beginner in fundamentals.");

async function story(sb: any, symbol: string, lang: string) {
  const { data: t } = await sb.from("filing_texts").select("*").eq("symbol", symbol).maybeSingle();
  if (!t) return json({ error: "prepare first" }, 409);
  const { data: years } = await sb.from("company_year_metrics").select("fy_end, revenue, rev_growth, op_margin, margin, spread, reinvest, rnd_rev, sbc_rev").eq("symbol", symbol).order("fy_end", { ascending: false }).limit(6);
  const numbers = { annual: (years ?? []).reverse(), backlog_rpo: t.rpo };
  return json(await ai(sb, "story", { symbol, lang }, [
    { role: "system", content: `You read SEC filings for a private momentum trader who is learning fundamentals the way Aswath Damodaran teaches them. Use only the texts given. Never invent facts or numbers. ${LANG(lang)} Reply with one JSON object.` },
    { role: "user", content: `Company: ${symbol}. 10-K filed ${t.tenk_filed}; earnings release filed ${t.release_filed ?? "n/a"}.
Return JSON with:
"story": 4-6 sentences — what the business does, how it makes money, and what the company says drives it.
"segments": [{"name","what"}] (from the business section, if described).
"customers": {"concentration": text about how dependent it is on big customers (or "not stated"), "quote", "source"}.
"competitors": [names the filing itself mentions].
"edge_claims": [{"claim": what the company says sets it apart, "quote", "source"}] (max 4).
"three_p": Damodaran's test of the story — {"possible": {"verdict":"yes|maybe|no","why"}, "plausible": {...}, "probable": {...}} judged against the numbers below.
"words_vs_numbers": [{"claim": something management says about results or trends, "quote", "source", "numbers_say": what the numbers below show, "agrees": "yes|partly|no"}] (max 5; include disagreements if any).
"guidance": {"text": the outlook given in the earnings release, or "none given", "quote", "source"}.
"backlog": one sentence on the backlog (remaining performance obligations) trend, or null.
"watch": [3 things to check in the next reports].
Every "quote" must be copied word-for-word from the text (max 25 words); "source" is one of: business, mdna, release, risks.
Numbers (annual, oldest first; % values are percent; spread = return on capital minus cost of capital, in points):
${JSON.stringify(numbers)}
--- BUSINESS (10-K Item 1) ---
${clipText(t.business ?? "", 16_000)}
--- MANAGEMENT'S DISCUSSION (10-K Item 7) ---
${clipText(t.mdna ?? "", 16_000)}
--- EARNINGS RELEASE ---
${clipText(t.release ?? "", 9_000)}` },
  ], "company-file:story"));
}
FIN.story = async (sb, { symbol, lang }, msg, model) => {
  const { data: t } = await sb.from("filing_texts").select("*").eq("symbol", symbol).maybeSingle();
  const data = verifyQuotes(parsed(msg), { business: t.business ?? "", mdna: t.mdna ?? "", release: t.release ?? "", risks: t.risks ?? "" });
  const { data: prev } = await sb.from("company_files").select("data").eq("symbol", symbol).eq("lang", lang).maybeSingle();
  const merged = { ...(prev?.data ?? {}), ...data, sources: { tenK: { url: t.tenk_url, filed: t.tenk_filed }, release: t.release_url ? { url: t.release_url, filed: t.release_filed } : null }, rpo: t.rpo };
  await sb.from("company_files").upsert({ symbol, lang, tenk_acc: t.tenk_acc, release_acc: t.release_acc, data: merged, model, created_at: new Date().toISOString() }, { onConflict: "symbol,lang" });
  return { ok: true, model };
};

async function risks(sb: any, symbol: string, lang: string) {
  const { data: t } = await sb.from("filing_texts").select("risks_added, risks_removed, tenk_filed, prev_filed, risks").eq("symbol", symbol).maybeSingle();
  if (!t) return json({ error: "prepare first" }, 409);
  const added: string[] = t.risks_added ?? [], removed: string[] = t.risks_removed ?? [];
  const base = { added: added.length, removed: removed.length, summary: null, notable: [], allAdded: added, allRemoved: removed, since: t.prev_filed };
  if (!added.length && !removed.length) return json(await saveRisks(sb, symbol, lang, base));
  {
    return json(await ai(sb, "risks", { symbol, lang, base }, [
      { role: "system", content: `You compare a company's risk factors between two annual reports. ${LANG(lang)} Reply with one JSON object.` },
      { role: "user", content: `${symbol}: risk-factor headings NEW in the 10-K filed ${t.tenk_filed} (not in the one filed ${t.prev_filed}), and headings DROPPED.
Return {"summary": 2-3 sentences on what changed and what it suggests, "notable": [{"heading": the exact heading, "kind": "new|dropped", "why": why it matters, one sentence}] (max 6, most important first)}.
NEW:\n${added.slice(0, 40).map((h) => "- " + h).join("\n")}\nDROPPED:\n${removed.slice(0, 40).map((h) => "- " + h).join("\n")}` },
    ], "company-file:risks"));
  }
}
FIN.risks = async (sb, { symbol, lang, base }, msg, model) => saveRisks(sb, symbol, lang, { ...base, ...parsed(msg), model });
async function saveRisks(sb: any, symbol: string, lang: string, riskChanges: any) {
  const { data: prev } = await sb.from("company_files").select("data").eq("symbol", symbol).eq("lang", lang).maybeSingle();
  await sb.from("company_files").upsert({ symbol, lang, data: { ...(prev?.data ?? {}), riskChanges } }, { onConflict: "symbol,lang" });
  return { ok: true, added: riskChanges.added, removed: riskChanges.removed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "job" || body.action === "finish") return json(await jobState(createClient(SB_URL, SB_KEY), Number(body.id ?? body.job), FIN));
    const symbol = String(body.symbol ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (!symbol) return json({ error: "symbol required" }, 400);
    const lang = body.lang === "he" ? "he" : "en";
    const sb = createClient(SB_URL, SB_KEY);
    const step = String(body.step ?? "get");
    if (step === "get") {
      const { data } = await sb.from("company_files").select("*").eq("symbol", symbol).eq("lang", lang).maybeSingle();
      return json({ file: data ?? null });
    }
    if (step === "prepare") return await prepare(sb, symbol);
    if (!hasAnyLlm()) return json({ error: "No AI is set up." }, 503);
    if (step === "story") return await story(sb, symbol, lang);
    if (step === "risks") return await risks(sb, symbol, lang);
    return json({ error: `unknown step ${step}` }, 400);
  } catch (e) {
    console.error("[company-file]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
