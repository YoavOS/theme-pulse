import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const supabase = createClient(SB_URL, SB_KEY);

    // Parse optional body: { mode: "resume" | "restart" }
    let mode: "resume" | "restart" = "resume";
    try {
      const body = await req.json();
      if (body?.mode === "restart") mode = "restart";
    } catch (_) { /* no body */ }

    // ── Check if there's already pending/processing work ──
    const { count: pendingCount } = await supabase
      .from("stock_scan_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "processing"]);

    // ── RESUME path: pending work exists and user did not force restart ──
    if (mode === "resume" && (pendingCount ?? 0) > 0) {
      // Recover any "processing" symbols stuck from a dead worker (>5 min old)
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      await supabase
        .from("stock_scan_queue")
        .update({ status: "pending" })
        .eq("status", "processing")
        .lt("enqueued_at", fiveMinAgo);

      // Mark progress as running again
      await supabase
        .from("rs_scan_progress")
        .update({ status: "running", last_updated: new Date().toISOString() })
        .eq("id", 1);

      // Re-enable cron job
      try {
        await supabase.rpc("set_universe_cron_active", { p_active: true });
      } catch (_) { /* function may not exist yet, ignore */ }

      return new Response(
        JSON.stringify({ ok: true, mode: "resumed", pending: pendingCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── RESTART path: fetch full universe and reseed ──
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB_KEY}`
    );
    if (!res.ok) throw new Error(`Finnhub symbol list failed: ${res.status}`);
    const data = await res.json();

    // Allowed major US exchanges only — block OTC/Pink/Grey markets at the source.
    const ALLOWED_MICS = new Set([
      "XNYS", "XNAS", "XASE", "ARCX", "BATS", "IEXG", "XCIS", "XNGS", "XNCM", "XNMS",
    ]);
    const OTC_HINT = /\b(OTC|PINK|GREY|GRAY|OTCM|OTCBB|OTCPK|OOTC)\b/i;

    const symbols: string[] = data
      .filter((s: any) => {
        if (!s.symbol || s.type !== "Common Stock") return false;
        // Block any ticker with suffixes (.PK / .OB / .OTC etc.)
        if (s.symbol.includes(".")) return false;
        // Block 5-letter symbols ending in F (foreign OTC convention, e.g. FKURF)
        if (/^[A-Z]{5}$/.test(s.symbol) && s.symbol.endsWith("F")) return false;
        // Block by exchange MIC if present — only allow whitelisted majors
        if (s.mic && !ALLOWED_MICS.has(s.mic)) return false;
        // Block by exchange string mentioning OTC/Pink/Grey
        if (s.exchange && OTC_HINT.test(s.exchange)) return false;
        return true;
      })
      .map((s: any) => s.symbol);

    console.log(`Seeding ${symbols.length} symbols into scan queue (OTC excluded)`);

    // Clear queue + STAGING universe (NOT the live universe — keep it usable until swap)
    await supabase.from("stock_scan_queue").delete().neq("symbol", "__none__");
    await supabase.from("qualified_rs_universe_staging").delete().neq("symbol", "__none__");

    // Insert in batches of 1000
    let inserted = 0;
    for (let i = 0; i < symbols.length; i += 1000) {
      const batch = symbols.slice(i, i + 1000).map((s) => ({
        symbol: s,
        status: "pending",
      }));
      const { error: insErr } = await supabase
        .from("stock_scan_queue")
        .upsert(batch, { onConflict: "symbol" });
      if (insErr) console.error("Insert error:", insErr);
      else inserted += batch.length;
    }

    // Reset progress tracker
    await supabase
      .from("rs_scan_progress")
      .update({
        total_queued: inserted,
        processed: 0,
        qualified: 0,
        failed: 0,
        status: "running",
        started_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      })
      .eq("id", 1);

    // Enable cron
    try {
      await supabase.rpc("set_universe_cron_active", { p_active: true });
    } catch (_) { /* ignore if helper not deployed */ }

    return new Response(
      JSON.stringify({ ok: true, mode: "restarted", total_queued: inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("seed-universe-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
