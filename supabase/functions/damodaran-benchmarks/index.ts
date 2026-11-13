// damodaran-benchmarks — loads Aswath Damodaran's US industry averages (NYU Stern) for the
// Fundamentals Lens. He updates them once a year in early January; pg_cron calls this on Jan 20,
// and it can be run by hand: POST { force?: true }.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb: Sb = createClient(SB_URL, SB_KEY);
  const body = await req.json().catch(() => ({}));
  const startedAt = new Date().toISOString();
  try {
    if (body.force !== true) {
      const { data: last } = await sb.from("damodaran_loads").select("started_at").eq("ok", true).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - Date.parse(last.started_at) < MIN_GAP_DAYS * 86400_000) return json({ skipped: true, reason: `loaded ${last.started_at}; pass {"force": true} to reload` });
    }

    const files: Record<string, { industries: number; values: number; missing: string[]; error?: string }> = {};
    const all: BenchRow[] = [];
    let modified: string | null = null;
    for (const spec of FILE_SPECS) {
      try {
        const d = await download(spec.file);
        modified ??= d.modified;
        // the industry table is on whichever sheet has the "Industry Name" header row
        let best = { rows: [] as BenchRow[], missing: spec.cols.map((c) => c.metric), industries: 0 };
        for (const g of grids(d.wb)) {
          const p = parseIndustrySheet(spec.file, g);
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

    // His company list (large, global). Optional: the crosswalk covers anything missing.
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

    const report = { year, asOf, values: all.length, industries: new Set(all.map((r) => r.industry)).size, files, tickers };
    await sb.from("damodaran_loads").insert({ started_at: startedAt, source_year: year, ok: true, report });
    // cached lens payloads carry last year's figures — let them rebuild
    await sb.from("lens_cache").delete().neq("symbol", "");
    return json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("damodaran-benchmarks", msg);
    await sb.from("damodaran_loads").insert({ started_at: startedAt, ok: false, report: { error: msg } });
    return json({ error: msg }, 500);
  }
});
