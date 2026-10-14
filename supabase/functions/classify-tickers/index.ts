import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";
import { ALL_SUB_INDUSTRIES, classifyLabel, norm, resolveSubIndustry } from "../_shared/gicsTaxonomy.ts";

/** ---------------------------------------------------------------
 * classify-tickers — permanent Sector → Industry → Sub-Industry labels.
 *
 * Order per ticker (stops at the first good answer):
 *   1. FMP profile        (capped at FMP_DAILY_CAP calls/day, shared free tier)
 *   2. Yahoo summaryProfile
 *   3. Finnhub industry   (re-uses the label already stored in the universe when present)
 *   4. Alpha Vantage OVERVIEW (≤ AV_DAILY_CAP/day, ≤5/min) — leftovers only
 *   5. Groq               — last resort, must pick from the canonical list
 *
 * Results are stored forever in public.ticker_classification and copied into
 * qualified_rs_universe.sector so every existing view uses them.
 *
 * Actions (POST body):
 *   { action: "status" }        → counts only, no external calls
 *   { action: "run" }           → one batch (≈ ≤110s); call again until done
 *   { action: "retry_failed" }  → put failed tickers back in the queue
 * --------------------------------------------------------------*/

const FMP_DAILY_CAP = 150;   // FMP free = 250/day; leave room for earnings features
const AV_DAILY_CAP = 24;     // Alpha Vantage free = 25/day
const AV_PER_RUN = 5;        // Alpha Vantage free = 5/min → one run uses at most 5
const AV_GAP_MS = 12_500;    // spacing between AV calls (keeps us under 5/min)
const BATCH = 60;            // pending tickers per run (≈30–45s)
const PARALLEL = 4;
const GROQ_BATCH = 25;
const DEADLINE_MS = 105_000; // edge functions allow ~150s; keep headroom

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FMP_KEY = Deno.env.get("FMP_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
const AV_KEY = [
  "ALPHA_VANTAGE_API_KEY", "ALPHAVANTAGE_API_KEY", "ALPHA_VANTAGE_KEY",
  "ALPHAVANTAGE_KEY", "AV_API_KEY", "ALPHA_VANTAGE",
].map((n) => Deno.env.get(n)).find((v) => !!v);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

/** Yahoo / FMP style sector names → GICS sector (used only as a partial hint). */
const SECTOR_HINT: Record<string, string> = {
  "technology": "Information Technology", "information technology": "Information Technology",
  "healthcare": "Health Care", "health care": "Health Care",
  "financial services": "Financials", "financial": "Financials", "financials": "Financials",
  "consumer cyclical": "Consumer Discretionary", "consumer discretionary": "Consumer Discretionary",
  "consumer defensive": "Consumer Staples", "consumer staples": "Consumer Staples",
  "basic materials": "Materials", "materials": "Materials",
  "communication services": "Communication Services", "industrials": "Industrials",
  "energy": "Energy", "utilities": "Utilities", "real estate": "Real Estate",
  "manufacturing": "Industrials", "life sciences": "Health Care", "trade & services": "Industrials",
};
const sectorHint = (s: string | null | undefined) => (s ? SECTOR_HINT[norm(s)] ?? null : null);

interface Row {
  symbol: string;
  sector: string | null;
  industry: string | null;
  sub_industry: string | null;
  source: string | null;
  raw_label: string | null;
  quality: string | null;
  status: string;
  tried: string[];
  company_name: string | null;
  description: string | null;
}

type Found = { sub: string; source: string; raw: string; quality: string } | null;

function accept(label: string | null | undefined, source: string): Found {
  if (!label) return null;
  const r = resolveSubIndustry(label);
  if (r.sub && (r.quality === "exact" || r.quality === "fuzzy")) {
    return { sub: r.sub, source, raw: label, quality: r.quality };
  }
  return null;
}

function finished(row: Row, f: NonNullable<Found>): Row {
  const c = classifyLabel(f.sub);
  return {
    ...row, sector: c.sector, industry: c.industry, sub_industry: c.subIndustry,
    source: f.source, raw_label: f.raw, quality: f.quality, status: "done", description: null,
  };
}

// ── Usage counters ───────────────────────────────────────────────
async function getUsage(db: SupabaseClient, source: string): Promise<number> {
  const { data } = await db.from("classification_usage").select("calls").eq("day", today()).eq("source", source).maybeSingle();
  return data?.calls ?? 0;
}
async function setUsage(db: SupabaseClient, source: string, calls: number) {
  await db.from("classification_usage").upsert({ day: today(), source, calls }, { onConflict: "day,source" });
}

// ── Providers ────────────────────────────────────────────────────
async function fmpProfile(sym: string) {
  const res = await fetch(
    `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(sym)}&apikey=${FMP_KEY}`,
    { headers: { "User-Agent": UA } },
  );
  if (res.status === 429 || res.status === 402 || res.status === 403) return { blocked: true as const };
  if (!res.ok) return null;
  const arr = await res.json().catch(() => null);
  const p = Array.isArray(arr) ? arr[0] : null;
  if (!p) return null;
  return {
    industry: (p.industry as string) || null,
    sector: (p.sector as string) || null,
    name: (p.companyName as string) || null,
    description: (p.description as string) || null,
  };
}

let yahooCrumb: { crumb: string; cookie: string } | null = null;
let yahooCrumbTried = false;
async function getYahooCrumb() {
  if (yahooCrumb || yahooCrumbTried) return yahooCrumb;
  yahooCrumbTried = true;
  try {
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    // deno-lint-ignore no-explicit-any
    const cookies: string[] = (r1.headers as any).getSetCookie?.() ?? [r1.headers.get("set-cookie") ?? ""];
    const cookie = cookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    await r1.body?.cancel();
    if (!cookie) return null;
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.includes("<")) return null;
    yahooCrumb = { crumb, cookie };
  } catch { /* ignore */ }
  return yahooCrumb;
}

async function yahooProfile(sym: string) {
  const base = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=summaryProfile,price`;
  try {
    let res = await fetch(base, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      const c = await getYahooCrumb();
      if (!c) return null;
      res = await fetch(`${base}&crumb=${encodeURIComponent(c.crumb)}`, {
        headers: { "User-Agent": UA, Accept: "application/json", Cookie: c.cookie },
      });
    }
    if (!res.ok) { await res.body?.cancel(); return null; }
    const j = await res.json();
    const r = j?.quoteSummary?.result?.[0];
    if (!r) return null;
    const sp = r.summaryProfile ?? {};
    return {
      industry: (sp.industry as string) || null,
      sector: (sp.sector as string) || null,
      name: (r.price?.longName as string) || (r.price?.shortName as string) || null,
      description: (sp.longBusinessSummary as string) || null,
    };
  } catch {
    return null;
  }
}

async function finnhubIndustry(sym: string) {
  if (!FINNHUB_KEY) return null;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${FINNHUB_KEY}`);
    if (!res.ok) { await res.body?.cancel(); return null; }
    const p = await res.json();
    return { industry: (p?.finnhubIndustry as string) || null, name: (p?.name as string) || null };
  } catch {
    return null;
  }
}

// ── Stage 0: make sure every universe + theme ticker has a row ──
async function fetchAll<T>(db: SupabaseClient, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function discover(db: SupabaseClient): Promise<number> {
  const existing = new Set(
    (await fetchAll<{ symbol: string }>(db, "ticker_classification", "symbol")).map((r) => r.symbol),
  );
  const universe = await fetchAll<{ symbol: string; sector: string | null; company_name: string | null }>(
    db, "qualified_rs_universe", "symbol, sector, company_name",
  );
  const themeTickers = await fetchAll<{ ticker_symbol: string }>(db, "theme_tickers", "ticker_symbol");

  const fresh = new Map<string, Partial<Row>>();
  for (const u of universe) {
    const sym = u.symbol?.toUpperCase();
    if (!sym || existing.has(sym) || fresh.has(sym)) continue;
    // The universe label is the Finnhub industry — keep it as a free fallback.
    const label = u.sector && !ALL_SUB_SET.has(norm(u.sector)) ? u.sector : null;
    fresh.set(sym, { symbol: sym, raw_label: label, company_name: u.company_name ?? null, status: "pending" });
  }
  for (const t of themeTickers) {
    const sym = t.ticker_symbol?.toUpperCase();
    if (!sym || existing.has(sym) || fresh.has(sym)) continue;
    fresh.set(sym, { symbol: sym, status: "pending" });
  }
  const rows = [...fresh.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("ticker_classification").upsert(rows.slice(i, i + 500), {
      onConflict: "symbol", ignoreDuplicates: true,
    });
    if (error) throw error;
  }
  return rows.length;
}

const ALL_SUB_SET = new Set(ALL_SUB_INDUSTRIES.map((s) => norm(s)));
const SUB_BY_NORM = new Map(ALL_SUB_INDUSTRIES.map((s) => [norm(s), s]));

// ── Stage 1: FMP → Yahoo → Finnhub ───────────────────────────────
async function resolveFree(row: Row, fmp: { left: number; blocked: boolean }): Promise<Row> {
  let r: Row = { ...row, tried: [...(row.tried ?? [])] };
  const info = { hint: null as string | null };
  const keepInfo = (name: string | null, desc: string | null, sector: string | null) => {
    if (name && !r.company_name) r.company_name = name;
    if (desc && !r.description) r.description = desc.slice(0, 600);
    info.hint = info.hint ?? sectorHint(sector);
  };

  // 1. FMP
  if (FMP_KEY && !fmp.blocked && fmp.left > 0) {
    fmp.left--;
    const p = await fmpProfile(r.symbol).catch(() => null);
    r.tried.push("fmp");
    if (p && "blocked" in p) fmp.blocked = true;
    else if (p) {
      keepInfo(p.name, p.description, p.sector);
      const f = accept(p.industry, "fmp");
      if (f) return finished(r, f);
    }
  }

  // 2. Yahoo
  const y = await yahooProfile(r.symbol);
  r.tried.push("yahoo");
  if (y) {
    keepInfo(y.name, y.description, y.sector);
    const f = accept(y.industry, "yahoo");
    if (f) return finished(r, f);
  }

  // 3. Finnhub (stored universe label first — no call needed)
  let fl = r.raw_label;
  if (!fl) {
    const fh = await finnhubIndustry(r.symbol);
    if (fh) { fl = fh.industry; keepInfo(fh.name, null, null); }
  }
  r.tried.push("finnhub");
  const f = accept(fl, "finnhub");
  if (f) return finished(r, f);

  // Nothing precise yet → Alpha Vantage queue. Keep a partial sector if we have one.
  r = { ...r, status: "needs_av", quality: info.hint ? "partial" : null, sector: info.hint ?? r.sector };
  return r;
}

// ── Stage 2: Alpha Vantage (leftovers, daily-capped) ─────────────
async function runAlphaVantage(db: SupabaseClient, deadline: number) {
  const out: { calls: number; done: number; toAi: number; limited: boolean; message?: string } =
    { calls: 0, done: 0, toAi: 0, limited: false };
  if (!AV_KEY) {
    // No Alpha Vantage key configured → skip straight to the AI step.
    const { data } = await db.from("ticker_classification").select("symbol").eq("status", "needs_av").limit(500);
    if (data?.length) {
      await db.from("ticker_classification")
        .update({ status: "needs_ai", updated_at: new Date().toISOString() })
        .in("symbol", data.map((d) => d.symbol));
      out.toAi = data.length;
    }
    return out;
  }
  let used = await getUsage(db, "alphavantage");
  const allowed = Math.min(AV_PER_RUN, AV_DAILY_CAP - used);
  if (allowed <= 0) { out.limited = true; return out; }

  const { data: rows } = await db.from("ticker_classification").select("*")
    .eq("status", "needs_av").order("updated_at", { ascending: true }).limit(allowed);
  for (const row of (rows ?? []) as Row[]) {
    if (Date.now() + AV_GAP_MS + 5_000 > deadline) break;
    await sleep(AV_GAP_MS);
    used++; out.calls++;
    await setUsage(db, "alphavantage", used);
    let j: Record<string, string> | null = null;
    try {
      const res = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(row.symbol)}&apikey=${AV_KEY}`);
      j = res.ok ? await res.json() : null;
    } catch { j = null; }
    if (j && (j.Note || j.Information || j["Error Message"])) {
      const raw = `${j.Note ?? ""} ${j.Information ?? ""} ${j["Error Message"] ?? ""}`.trim();
      const msg = raw.toLowerCase();
      out.message = raw.slice(0, 300);
      if (msg.includes("per day") || msg.includes("daily") || msg.includes("premium")) {
        // Daily allowance used up (or key not allowed) — stop for today.
        await setUsage(db, "alphavantage", AV_DAILY_CAP);
        out.limited = true;
        break;
      }
      if (msg.includes("per second") || msg.includes("per minute") || msg.includes("rate limit") || msg.includes("sparingly")) {
        // Burst limit — leave the row queued and stop this run.
        out.limited = true;
        break;
      }
      // Any other answer (e.g. unknown symbol) → Alpha Vantage can't help this ticker; hand it to the AI step.
      await db.from("ticker_classification").upsert({
        ...row, tried: [...(row.tried ?? []), "alphavantage"], status: "needs_ai", updated_at: new Date().toISOString(),
      });
      out.toAi++;
      continue;
    }
    let next: Row = { ...row, tried: [...(row.tried ?? []), "alphavantage"] };
    if (j?.Name && !next.company_name) next.company_name = j.Name;
    if (j?.Description && !next.description) next.description = j.Description.slice(0, 600);
    if (!next.sector) next.sector = sectorHint(j?.Sector) ?? next.sector;
    const f = accept(j?.Industry, "alphavantage");
    if (f) { next = finished(next, f); out.done++; }
    else { next.status = "needs_ai"; out.toAi++; }
    await db.from("ticker_classification").upsert({ ...next, updated_at: new Date().toISOString() });
  }
  return out;
}

// ── Stage 3: Groq (last resort, constrained to the canonical list) ──
async function runGroq(db: SupabaseClient) {
  const out = { done: 0, failed: 0 };
  const { data } = await db.from("ticker_classification").select("*")
    .eq("status", "needs_ai").order("updated_at", { ascending: true }).limit(GROQ_BATCH);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return out;

  // Real data only: without a name or description an AI guess would be invented.
  const usable = rows.filter((r) => r.company_name || r.description);
  const unusable = rows.filter((r) => !(r.company_name || r.description));

  let answers: Record<string, string | null> = {};
  if (GROQ_KEY && usable.length) {
    const items = usable.map((r) =>
      `${r.symbol} | ${r.company_name ?? "?"} | sector hint: ${r.sector ?? "?"} | ${(r.description ?? "").slice(0, 300)}`
    ).join("\n");
    const prompt =
`Classify each US-listed company into exactly ONE sub-industry from this list (copy the name exactly):
${ALL_SUB_INDUSTRIES.join("; ")}

Companies (symbol | name | sector hint | business description):
${items}

Return JSON only: {"SYMBOL": "Sub-Industry name", ...}. Use null if you are not confident.`;
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: "json_object" },
        }),
      });
      if (res.ok) {
        const j = await res.json();
        answers = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
      } else {
        await res.body?.cancel();
        return out; // try again on the next run
      }
    } catch {
      return out;
    }
  } else if (usable.length) {
    return out; // no Groq key: leave them queued
  }

  const now = new Date().toISOString();
  for (const r of usable) {
    const pick = answers[r.symbol] ?? answers[r.symbol.toLowerCase()] ?? null;
    const sub = pick ? SUB_BY_NORM.get(norm(pick)) : undefined;
    const base: Row = { ...r, tried: [...(r.tried ?? []), "groq"] };
    if (sub) {
      await db.from("ticker_classification").upsert({
        ...finished(base, { sub, source: "groq", raw: pick!, quality: "ai" }), updated_at: now,
      });
      out.done++;
    } else {
      await db.from("ticker_classification").upsert({ ...base, status: "failed", description: null, updated_at: now });
      out.failed++;
    }
  }
  for (const r of unusable) {
    await db.from("ticker_classification").upsert({
      ...r, tried: [...(r.tried ?? []), "groq"], status: "failed", description: null, updated_at: now,
    });
    out.failed++;
  }
  return out;
}

// ── Status ───────────────────────────────────────────────────────
async function status(db: SupabaseClient) {
  const counts: Record<string, number> = {};
  for (const s of ["pending", "needs_av", "needs_ai", "done", "failed"]) {
    const { count, error } = await db.from("ticker_classification").select("symbol", { count: "exact", head: true }).eq("status", s);
    if (error) throw error;
    counts[s] = count ?? 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    total,
    ...counts,
    avKeyConfigured: !!AV_KEY,
    avUsedToday: await getUsage(db, "alphavantage"),
    avDailyCap: AV_DAILY_CAP,
    fmpUsedToday: await getUsage(db, "fmp"),
  };
}

const isMissingTable = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("42p01");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const started = Date.now();
  const deadline = started + DEADLINE_MS;

  try {
    const body = await req.json().catch(() => ({})) as { action?: string };
    const action = body.action ?? "run";

    if (action === "status") return json({ ok: true, status: await status(db) });

    if (action === "retry_failed") {
      const { error } = await db.from("ticker_classification")
        .update({ status: "pending", tried: [], updated_at: new Date().toISOString() })
        .eq("status", "failed");
      if (error) throw error;
      return json({ ok: true, status: await status(db) });
    }

    // ── run ──
    const added = await discover(db);

    // Stage 1
    const fmpUsed = await getUsage(db, "fmp");
    const fmp = { left: Math.max(0, FMP_DAILY_CAP - fmpUsed), blocked: false };
    const fmpStart = fmp.left;
    const { data: pending } = await db.from("ticker_classification").select("*")
      .eq("status", "pending").order("symbol").limit(BATCH);
    const stage1 = { done: 0, toAv: 0 };
    const list = (pending ?? []) as Row[];
    for (let i = 0; i < list.length && Date.now() < deadline - 20_000; i += PARALLEL) {
      const chunk = list.slice(i, i + PARALLEL);
      const results = await Promise.all(chunk.map((r) => resolveFree(r, fmp)));
      const now = new Date().toISOString();
      await db.from("ticker_classification").upsert(results.map((r) => ({ ...r, updated_at: now })));
      for (const r of results) {
        if (r.status === "done") stage1.done++;
        else stage1.toAv++;
      }
      if (FINNHUB_KEY) await sleep(300); // gentle on Finnhub's 60/min
    }
    if (fmp.left !== fmpStart) await setUsage(db, "fmp", fmpUsed + (fmpStart - fmp.left));
    if (fmp.blocked) await setUsage(db, "fmp", FMP_DAILY_CAP);

    // Stage 2 + 3 only once the free sources are drained (keeps runs short and predictable)
    const morePending = list.length === BATCH;
    const av = morePending ? { calls: 0, done: 0, toAi: 0, limited: false } : await runAlphaVantage(db, deadline);
    const ai = morePending ? { done: 0, failed: 0 } : await runGroq(db);

    const { data: synced } = await db.rpc("sync_universe_classification");

    return json({
      ok: true,
      ran: { added, stage1, av, ai, synced: synced ?? 0, ms: Date.now() - started },
      status: await status(db),
    });
  } catch (e) {
    if (isMissingTable(e)) {
      return json({ ok: false, setupNeeded: true, error: "Classification tables are not created yet (database migration not applied)." });
    }
    console.error("classify-tickers error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
