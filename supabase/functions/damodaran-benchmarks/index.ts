// damodaran-benchmarks — loads Aswath Damodaran's US industry averages (NYU Stern) for the
// Fundamentals Lens. He updates them once a year in early January; pg_cron calls this on Jan 20,
// and it can be run by hand: POST { force?: true }.
//
// It answers at once ({ started: true }) and does the work in the background (EdgeRuntime.waitUntil), so
// a caller never times out; the outcome is written to damodaran_loads. The industry tables load first;
// his company list (indname.xls, the heaviest file) then loads in a second, separate invocation
// ({ part: "tickers" }) so each run stays inside the per-request CPU / memory limits.
// POST { wait: true } runs in the foreground and returns the report (for debugging).
//
// Files: margin, EVA, capex, wacc, dbtfund, histgr, pedata, psdata, vebitda, divfcfe (one row per
// industry, ~94 + "Total Market"), plus indname.xls (his company → industry list, US rows only).
// Columns are found by header text (_shared/damodaran.ts); the response — also saved in
// damodaran_loads — lists anything that wasn't found, so a format change is visible, not silent.
//
// Data © Aswath Damodaran, offered free for use; the Lens shows the source and date on every figure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
// SheetJS from npm via esm.sh (the deploy bundler can't fetch from cdn.sheetjs.com). 0.18.5 is the last npm
// release; we only read Damodaran's own published files, server-side.
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { corsHeaders } from "../_shared/cors.ts";
import { DATA_BASE, FILE_SPECS, parseIndname, parseIndustrySheet, type BenchRow, type Cell } from "../_shared/damodaran.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "ThemePulse/1.0 (fundamentals lens; yearly download)";
const MIN_GAP_DAYS = 20;

// Supabase edge runtime: keep the worker alive for background work after the response is sent.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Every sheet of a workbook as a grid of { v, w } cells. */
// deno-lint-ignore no-explicit-any
function grids(wb: any): Cell[][][] {
  const out: Cell[][][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.["!ref"]) continue;
    const r = XLSX.utils.decode_range(ws["!ref"]);
    const grid: Cell[][] = [];
    for (let R = r.s.r; R <= Math.min(r.e.r, 120000); R++) {
      const row: Cell[] = [];
      for (let C = r.s.c; C <= Math.min(r.e.c, 60); C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        row.push(c ? { v: c.v, w: c.w } : {});
      }
      grid.push(row);
    }
    out.push(grid);
  }
  return out;
}

async function download(file: string): Promise<{ wb: unknown; modified: string | null }> {
  const url = DATA_BASE + file.replace(/&/g, "%26");
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) { await r.body?.cancel(); throw new Error(`${file}: HTTP ${r.status}`); }
  const buf = new Uint8Array(await r.arrayBuffer());
  return { wb: XLSX.read(buf, { type: "array", cellNF: false, cellDates: false }), modified: r.headers.get("last-modified") };
}

// deno-lint-ignore no-explicit-any
type Sb = any;
async function upsertChunks(sb: Sb, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// deno-lint-ignore no-explicit-any
async function loadIndustries(sb: Sb, startedAt: string): Promise<any> {
  const files: Record<string, { industries: number; values: number; missing: string[]; error?: string }> = {};
  const all: BenchRow[] = [];
  let modified: string | null = null;
  // download in parallel (network time), parse one at a time (CPU / memory)
  const got = await Promise.all(FILE_SPECS.map((spec) => download(spec.file).then((d) => ({ spec, d }), (e) => ({ spec, e }))));
  for (const g of got) {
    const spec = g.spec;
    if ("e" in g) {
      files[spec.file] = { industries: 0, values: 0, missing: spec.cols.map((c) => c.metric), error: g.e instanceof Error ? g.e.message : String(g.e) };
      continue;
    }
    try {
      modified ??= g.d.modified;
      // the industry table is on whichever sheet has the "Industry Name" header row
      let best = { rows: [] as BenchRow[], missing: spec.cols.map((c) => c.metric), industries: 0 };
      for (const grid of grids(g.d.wb)) {
        const p = parseIndustrySheet(spec.file, grid);
        if (p.rows.length > best.rows.length) best = p;
      }
      all.push(...best.rows);
      files[spec.file] = { industries: best.industries, values: best.rows.length, missing: best.missing };
    } catch (e) {
      files[spec.file] = { industries: 0, values: 0, missing: spec.cols.map((c) => c.metric), error: e instanceof Error ? e.message : String(e) };
    }
  }
  // The January release names the year; Last-Modified dates it (a later correction keeps the year).
  const lm = modified ? new Date(modified) : new Date();
  const year = Number.isFinite(lm.getTime()) ? lm.getUTCFullYear() : new Date().getUTCFullYear();
  const asOf = `January ${year}`;
  if (all.length < 200) throw new Error(`only ${all.length} values parsed — not saving (see files)` + JSON.stringify(files));
  await upsertChunks(sb, "damodaran_benchmarks",
    all.map((r) => ({ ...r, source_year: year, as_of: asOf, loaded_at: startedAt })), "source_year,industry,metric");
  const report = { part: "industries", year, asOf, values: all.length, industries: new Set(all.map((r) => r.industry)).size, files };
  await sb.from("damodaran_loads").insert({ started_at: startedAt, source_year: year, ok: true, report });
  // cached lens payloads carry last year's figures — let them rebuild
  await sb.from("lens_cache").delete().neq("symbol", "");
  return report;
}

// His company list (large). Optional: the crosswalk covers anything missing.
// deno-lint-ignore no-explicit-any
async function loadTickers(sb: Sb, startedAt: string): Promise<any> {
  const { data: latest } = await sb.from("damodaran_benchmarks").select("source_year").order("source_year", { ascending: false }).limit(1).maybeSingle();
  const year: number = latest?.source_year ?? new Date().getUTCFullYear();
  let tickers: { rows: number; error?: string } = { rows: 0 };
  try {
    const d = await download("indname.xls");
    let best: ReturnType<typeof parseIndname> = { map: [], error: "no sheet parsed" };
    for (const g of grids(d.wb)) { const p = parseIndname(g); if (p.map.length > best.map.length) best = p; }
    if (best.map.length > 1000) {
      await upsertChunks(sb, "damodaran_tickers", best.map.map((t) => ({ ...t, source_year: year, loaded_at: startedAt })), "symbol");
      await sb.from("damodaran_tickers").delete().lt("source_year", year);
    }
    tickers = { rows: best.map.length, error: best.map.length > 1000 ? undefined : best.error ?? "too few US rows — kept the previous list" };
  } catch (e) {
    tickers = { rows: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const report = { part: "tickers", year, tickers };
  await sb.from("damodaran_loads").insert({ started_at: startedAt, source_year: year, ok: !tickers.error, report });
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb: Sb = createClient(SB_URL, SB_KEY);
  const body = await req.json().catch(() => ({}));
  const startedAt = new Date().toISOString();
  const part: "industries" | "tickers" = body.part === "tickers" ? "tickers" : "industries";

  if (part === "industries" && body.force !== true) {
    const { data: last } = await sb.from("damodaran_loads").select("started_at").eq("ok", true).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.started_at) < MIN_GAP_DAYS * 86400_000) return json({ skipped: true, reason: `loaded ${last.started_at}; pass {"force": true} to reload` });
  }

  const run = async () => {
    try {
      if (part === "tickers") return await loadTickers(sb, startedAt);
      const report = await loadIndustries(sb, startedAt);
      // the company list goes in its own invocation (own CPU / memory budget)
      if (body.tickers !== false) {
        const r = await fetch(`${SB_URL}/functions/v1/damodaran-benchmarks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ part: "tickers" }),
        }).catch((e) => { console.error("tickers trigger", e); return null; });
        await r?.body?.cancel();
      }
      return report;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("damodaran-benchmarks", part, msg);
      await sb.from("damodaran_loads").insert({ started_at: startedAt, ok: false, report: { part, error: msg } });
      return { error: msg };
    }
  };

  if (body.wait === true || typeof EdgeRuntime === "undefined") {
    const report = await run();
    return json(report, report?.error ? 500 : 200);
  }
  EdgeRuntime.waitUntil(run());
  return json({ started: true, part, note: "Running in the background — the result is written to damodaran_loads (newest row) in about a minute." });
});
