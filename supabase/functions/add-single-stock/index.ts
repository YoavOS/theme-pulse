// Lightweight: add a single ticker directly to qualified_rs_universe without any qualification.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.symbol ?? "").trim().toUpperCase();
    const symbol = raw.replace(/[^A-Z0-9.\-]/g, "");
    if (!symbol) {
      return new Response(JSON.stringify({ error: "Missing symbol" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing, error: selErr } = await supabase
      .from("qualified_rs_universe")
      .select("symbol")
      .eq("symbol", symbol)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      return new Response(JSON.stringify({ alreadyExists: true, symbol }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await supabase
      .from("qualified_rs_universe")
      .insert({ symbol, qualified_at: new Date().toISOString() });
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ added: true, symbol }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
