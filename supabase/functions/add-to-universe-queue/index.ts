import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lightweight: queue specific symbols for scanning without wiping the universe.
// Used by the "Add Missing Stocks to Universe" UI when a user pastes tickers that
// aren't yet in the qualified universe. We only insert pending rows and kick the
// existing worker — no fresh Finnhub fetch, no staging wipe, no swap.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    let body: any = {};
    try { body = await req.json(); } catch (_) { /* */ }

    const rawSymbols: unknown = body?.symbols;
    if (!Array.isArray(rawSymbols)) {
      return new Response(JSON.stringify({ error: "symbols[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const symbols = Array.from(new Set(
      rawSymbols
        .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
        .filter((s) => s.length > 0 && s.length <= 10 && /^[A-Z0-9.\-]+$/.test(s))
    )).slice(0, 500);

    if (symbols.length === 0) {
      return new Response(JSON.stringify({ ok: true, queued: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert as pending (do nothing if symbol already in queue).
    const rows = symbols.map((s) => ({ symbol: s, status: "pending" }));
    const { error } = await supabase
      .from("stock_scan_queue")
      .upsert(rows, { onConflict: "symbol", ignoreDuplicates: false });
    if (error) throw error;

    // Make sure the worker is on.
    try { await supabase.rpc("set_universe_cron_active", { p_active: true }); } catch (_) {}
    try { await supabase.rpc("release_universe_scan_lock"); } catch (_) {}

    // Kick one tick immediately.
    supabase.functions.invoke("process-universe-queue", { body: {} })
      .catch((e) => console.error("kick failed:", e));

    return new Response(JSON.stringify({ ok: true, queued: symbols.length, symbols }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("add-to-universe-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
