import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METRICS = [
  "eps_ttm_yoy", "eps_annual_yoy", "eps_quarterly_yoy", "eps_quarterly_qoq",
  "revenue_ttm_yoy", "revenue_annual_yoy", "revenue_quarterly_yoy", "revenue_quarterly_qoq",
  "pe_ratio", "forward_pe", "peg_ratio", "ps_ratio", "pb_ratio",
  "gross_margin", "net_margin", "operating_margin", "roe", "roa",
  "debt_to_equity", "current_ratio",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    // Pull all rows in pages
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("stock_fundamentals")
        .select(METRICS.join(","))
        .range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const total = rows.length;
    const coverage: Record<string, { count: number; pct: number }> = {};
    for (const m of METRICS) {
      const c = rows.filter((r) => r[m] !== null && r[m] !== undefined).length;
      coverage[m] = { count: c, pct: total > 0 ? Math.round((c / total) * 1000) / 10 : 0 };
    }

    return new Response(
      JSON.stringify({ ok: true, total, coverage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fundamentals-coverage error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
