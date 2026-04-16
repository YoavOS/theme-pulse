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

    // 1. Fetch full US symbol list
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB_KEY}`
    );
    if (!res.ok) throw new Error(`Finnhub symbol list failed: ${res.status}`);
    const data = await res.json();

    const symbols: string[] = data
      .filter((s: any) => s.type === "Common Stock" && s.symbol && !s.symbol.includes("."))
      .map((s: any) => s.symbol);

    console.log(`Seeding ${symbols.length} symbols into scan queue`);

    // 2. Clear existing queue + qualified universe
    await supabase.from("stock_scan_queue").delete().neq("symbol", "__none__");
    await supabase.from("qualified_rs_universe").delete().neq("symbol", "__none__");

    // 3. Insert in batches of 1000
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

    // 4. Reset progress tracker
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

    return new Response(
      JSON.stringify({ ok: true, total_queued: inserted }),
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
