import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Common ticker-to-sector mappings for suggestion
const TICKER_HINTS: Record<string, string[]> = {
  NVDA: ["GPU / AI Chips", "AI Infrastructure / Data Centers", "Semiconductors"],
  AMD: ["GPU / AI Chips", "Semiconductors"],
  AVGO: ["GPU / AI Chips", "Semiconductors"],
  TSM: ["Semiconductors", "Semiconductor Equipment"],
  ASML: ["Semiconductor Equipment", "Semiconductors"],
  CCJ: ["Uranium & Nuclear Revival"],
  LEU: ["Uranium & Nuclear Revival"],
  UEC: ["Uranium & Nuclear Revival"],
  JOBY: ["Drone & Autonomous Systems", "Advanced Air Mobility / eVTOL"],
  ACHR: ["Drone & Autonomous Systems", "Advanced Air Mobility / eVTOL"],
  PLTR: ["AI Software / Agents", "Defense & Robotics"],
  IONQ: ["Quantum Computing"],
  RGTI: ["Quantum Computing"],
  QUBT: ["Quantum Computing"],
  CRWD: ["Cybersecurity"],
  PANW: ["Cybersecurity"],
  ZS: ["Cybersecurity"],
  TSLA: ["Electric Vehicles & Battery"],
  RIVN: ["Electric Vehicles & Battery"],
  LCID: ["Electric Vehicles & Battery"],
  COIN: ["Crypto & Blockchain"],
  MSTR: ["Crypto & Blockchain"],
  ASTS: ["Space Economy"],
  RKLB: ["Space Economy", "Drone & Autonomous Systems"],
  VRT: ["AI Infrastructure / Data Centers", "Thermal Management / Liquid Cooling"],
  EQIX: ["AI Infrastructure / Data Centers"],
  FCX: ["Copper & Base Metals"],
  NEM: ["Gold & Precious Metals"],
  GOLD: ["Gold & Precious Metals"],
  MP: ["Critical Minerals / Rare Earths"],
  ENPH: ["Solar Energy"],
  FSLR: ["Solar Energy"],
  LMT: ["Defense & Robotics"],
  RTX: ["Defense & Robotics"],
  NOW: ["SaaS & Cloud Software"],
  CRM: ["SaaS & Cloud Software"],
  SQ: ["Fintech & Digital Payments"],
  PYPL: ["Fintech & Digital Payments"],
  ISRG: ["Robotics & Industrial Automation"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol")?.toUpperCase();

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Missing symbol parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Check if ticker already exists in any theme
    const { data: existing } = await sb
      .from("theme_tickers")
      .select("theme_id, themes(name)")
      .eq("ticker_symbol", symbol);

    if (existing && existing.length > 0) {
      const theme = (existing[0] as any).themes;
      return new Response(
        JSON.stringify({
          symbol,
          theme_name: theme?.name,
          theme_id: existing[0].theme_id,
          already_exists: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check our hints map
    const hints = TICKER_HINTS[symbol];
    if (hints && hints.length > 0) {
      // Find matching theme in DB
      const { data: themes } = await sb
        .from("themes")
        .select("id, name")
        .in("name", hints);

      if (themes && themes.length > 0) {
        return new Response(
          JSON.stringify({
            symbol,
            theme_name: themes[0].name,
            theme_id: themes[0].id,
            confidence: "high",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fallback: no suggestion
    return new Response(
      JSON.stringify({ symbol, theme_name: null, theme_id: null, confidence: "none" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
