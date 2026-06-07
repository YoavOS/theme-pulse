import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per project policy: every click on "Update Stock List" is a hard restart.
// We always wipe the queue + staging, re-fetch Finnhub's US universe, reseed,
// re-enable the cron, release any stale advisory lock, and kick off one
// processing tick so the user sees immediate progress.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const supabase = createClient(SB_URL, SB_KEY);

    let filters: any = null;
    try {
      const body = await req.json();
      if (body?.filters && typeof body.filters === "object") filters = body.filters;
    } catch (_) { /* no body */ }

    // Release any leftover advisory lock from a previous crashed worker so the
    // very first cron tick after restart can actually do work.
    try { await supabase.rpc("release_universe_scan_lock"); } catch (_) { /* fine if not held */ }

    // Persist filters before reseeding so the worker reads them on every tick.
    if (filters) {
      await supabase.from("rs_scan_progress").update({ filters }).eq("id", 1);
    }

    // ── Fetch full Finnhub US universe ──
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB_KEY}`
    );
    if (!res.ok) throw new Error(`Finnhub symbol list failed: ${res.status}`);
    const data = await res.json();

    const ALLOWED_MICS = new Set([
      "XNYS", "XNAS", "XASE", "ARCX", "BATS", "IEXG", "XCIS", "XNGS", "XNCM", "XNMS",
    ]);
    const OTC_HINT = /\b(OTC|PINK|GREY|GRAY|OTCM|OTCBB|OTCPK|OOTC)\b/i;

    const symbols: string[] = data
      .filter((s: any) => {
        if (!s.symbol || s.type !== "Common Stock") return false;
        if (s.symbol.includes(".")) return false;
        if (/^[A-Z]{5}$/.test(s.symbol) && s.symbol.endsWith("F")) return false;
        if (s.mic && !ALLOWED_MICS.has(s.mic)) return false;
        if (s.exchange && OTC_HINT.test(s.exchange)) return false;
        return true;
      })
      .map((s: any) => s.symbol);

    console.log(`Reseeding ${symbols.length} symbols into scan queue (hard restart).`);

    // Wipe queue + STAGING (NOT the live universe — keep it serving reads until the new swap publishes).
    await supabase.from("stock_scan_queue").delete().neq("symbol", "__none__");
    await supabase.from("qualified_rs_universe_staging").delete().neq("symbol", "__none__");

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

    // Reset progress tracker.
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

    // Enable cron worker.
    try {
      await supabase.rpc("set_universe_cron_active", { p_active: true });
    } catch (e) {
      console.error("set_universe_cron_active failed:", e);
    }

    // Kick off one tick immediately so the user sees progress instead of
    // waiting up to a minute for the cron.
    supabase.functions.invoke("process-universe-queue", { body: {} })
      .catch((e) => console.error("initial process-universe-queue tick failed:", e));

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
