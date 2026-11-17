// proven-lookalikes — nightly, after the track records: refreshes the fade rates (how often an edge lasts)
// and every company's look-alikes with honest base rates (see _shared/lookalikes.ts).
//   POST {}            everything
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fingerprints, lookalikes, type YearRow } from "../_shared/lookalikes.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const GOOD = new Set(["elite", "proven", "proven_caveat"]);

async function all(sb: any, table: string, cols: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).order("symbol").range(from, from + 999);
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
  const t0 = Date.now();
  try {
    const sb = createClient(SB_URL, SB_KEY);
    const { data: fade, error: fErr } = await sb.rpc("refresh_fade_rates");
    if (fErr) console.error("refresh_fade_rates", fErr.message);
    const rows: YearRow[] = await all(sb, "company_year_metrics", "symbol, fy_end, spread, margin, turnover, rev_growth, reinvest, gross_margin, rnd_rev, nd_ebitda");
    const labels = await all(sb, "proven_strength", "symbol, label", (q) => q.eq("status", "ok"));
    const labelOf = new Map(labels.map((r: any) => [r.symbol, r.label]));
    const good = new Map(labels.filter((r: any) => GOOD.has(r.label)).map((r: any) => [r.symbol, r.label]));
    const pts = fingerprints(rows);
    const { results, allKeptPct } = lookalikes(pts, good);

    const la: any[] = [], base: any[] = [];
    const now = new Date().toISOString();
    for (const r of results) {
      r.now.forEach((x, i) => la.push({ symbol: r.symbol, mode: "now", rank: i + 1, peer: x.peer, peer_year: x.end, distance: x.distance, peer_label: labelOf.get(x.peer) ?? null, shared: x.shared, computed_at: now }));
      r.before.forEach((x, i) => la.push({ symbol: r.symbol, mode: "before", rank: i + 1, peer: x.peer, peer_year: x.end, distance: x.distance, peer_label: labelOf.get(x.peer) ?? null, shared: x.shared, computed_at: now }));
      if (r.base) base.push({ symbol: r.symbol, as_of: r.asOf, k: r.base.k, kept_pct: r.base.keptPct, strong_pct: r.base.strongPct, all_kept_pct: allKeptPct, computed_at: now });
    }
    await sb.from("lookalikes").delete().neq("symbol", "");
    for (let i = 0; i < la.length; i += 1000) { const { error } = await sb.from("lookalikes").insert(la.slice(i, i + 1000)); if (error) throw new Error(`lookalikes: ${error.message}`); }
    await sb.from("lookalike_base").delete().neq("symbol", "");
    for (let i = 0; i < base.length; i += 1000) { const { error } = await sb.from("lookalike_base").insert(base.slice(i, i + 1000)); if (error) throw new Error(`lookalike_base: ${error.message}`); }
    return json({ ok: true, fadeRows: fade, points: pts.length, companies: results.length, lookalikes: la.length, allKeptPct, ms: Date.now() - t0 });
  } catch (e) {
    console.error("[proven-lookalikes]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
