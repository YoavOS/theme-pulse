import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    let mode: "resume" | "restart" = "resume";
    try {
      const body = await req.json();
      if (body?.mode === "restart") mode = "restart";
    } catch (_) { /* no body */ }

    // Check for pending/processing work
    const { count: pendingCount } = await supabase
      .from("fundamentals_scan_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "processing"]);

    if (mode === "resume" && (pendingCount ?? 0) > 0) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      await supabase
        .from("fundamentals_scan_queue")
        .update({ status: "pending" })
        .eq("status", "processing")
        .lt("enqueued_at", fiveMinAgo);

      await supabase
        .from("fundamentals_scan_progress")
        .update({ status: "running", last_updated: new Date().toISOString() })
        .eq("id", 1);

      try {
        await supabase.rpc("set_fundamentals_cron_active", { p_active: true });
      } catch (_) { /* ignore */ }

      return new Response(
        JSON.stringify({ ok: true, mode: "resumed", pending: pendingCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // RESTART path: seed from qualified_rs_universe
    const symbols: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("qualified_rs_universe")
        .select("symbol")
        .range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      symbols.push(...data.map((r: any) => r.symbol).filter(Boolean));
      if (data.length < 1000) break;
    }

    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "No qualified universe found. Run 'Update Stock List' first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Wipe queue
    await supabase.from("fundamentals_scan_queue").delete().neq("symbol", "__none__");

    let inserted = 0;
    for (let i = 0; i < symbols.length; i += 1000) {
      const batch = symbols.slice(i, i + 1000).map((s) => ({ symbol: s, status: "pending" }));
      const { error: insErr } = await supabase
        .from("fundamentals_scan_queue")
        .upsert(batch, { onConflict: "symbol" });
      if (insErr) console.error("Insert error:", insErr);
      else inserted += batch.length;
    }

    await supabase
      .from("fundamentals_scan_progress")
      .update({
        total_queued: inserted,
        processed: 0,
        succeeded: 0,
        failed: 0,
        status: "running",
        started_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      })
      .eq("id", 1);

    try {
      await supabase.rpc("set_fundamentals_cron_active", { p_active: true });
    } catch (_) { /* ignore */ }

    return new Response(
      JSON.stringify({ ok: true, mode: "restarted", total_queued: inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("seed-fundamentals-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
