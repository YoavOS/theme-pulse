import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Match universe scan pacing: 50/min ⇒ safely under Finnhub 60/min
const BATCH_SIZE = 50;
const FINNHUB_DELAY_MS = 1100;
const YAHOO_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "object" ? Number(v.raw ?? v.fmt ?? NaN) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const pctGrowth = (now: number | null, prior: number | null): number | null => {
  if (now === null || prior === null || prior === 0) return null;
  // Use absolute denominator to handle negative bases (loss → profit etc.)
  return Math.round(((now - prior) / Math.abs(prior)) * 10000) / 100;
};

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
};

async function fetchYahooQuoteSummary(symbol: string) {
  const modules = [
    "financialData",
    "defaultKeyStatistics",
    "summaryDetail",
    "earnings",
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "summaryProfile",
    "price",
  ].join(",");
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    return { ok: !!result, status: res.status, data: result ?? null };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

async function fetchFinnhubMetric(symbol: string, key: string) {
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

interface Extracted {
  company_name: string | null;
  sector: string | null;
  market_cap: number | null;
  price: number | null;
  eps_ttm_yoy: number | null;
  eps_annual_yoy: number | null;
  eps_quarterly_yoy: number | null;
  eps_quarterly_qoq: number | null;
  revenue_ttm_yoy: number | null;
  revenue_annual_yoy: number | null;
  revenue_quarterly_yoy: number | null;
  revenue_quarterly_qoq: number | null;
  pe_ratio: number | null;
  forward_pe: number | null;
  peg_ratio: number | null;
  ps_ratio: number | null;
  pb_ratio: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  operating_margin: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  source_eps: string | null;
  source_revenue: string | null;
  source_valuation: string | null;
}

function extract(yh: any, fh: any): Extracted {
  const out: Extracted = {
    company_name: null, sector: null, market_cap: null, price: null,
    eps_ttm_yoy: null, eps_annual_yoy: null, eps_quarterly_yoy: null, eps_quarterly_qoq: null,
    revenue_ttm_yoy: null, revenue_annual_yoy: null, revenue_quarterly_yoy: null, revenue_quarterly_qoq: null,
    pe_ratio: null, forward_pe: null, peg_ratio: null, ps_ratio: null, pb_ratio: null,
    gross_margin: null, net_margin: null, operating_margin: null, roe: null, roa: null,
    debt_to_equity: null, current_ratio: null,
    source_eps: null, source_revenue: null, source_valuation: null,
  };

  // ── Yahoo extracts ──
  if (yh) {
    const fd = yh.financialData ?? {};
    const ks = yh.defaultKeyStatistics ?? {};
    const sd = yh.summaryDetail ?? {};
    const sp = yh.summaryProfile ?? {};
    const pr = yh.price ?? {};
    const ish = yh.incomeStatementHistory?.incomeStatementHistory ?? [];
    const ishq = yh.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [];
    const ea = yh.earnings ?? {};

    out.company_name = pr.longName ?? pr.shortName ?? null;
    out.sector = sp.sector ?? null;
    out.market_cap = num(pr.marketCap);
    out.price = num(pr.regularMarketPrice);

    // Valuation
    out.pe_ratio = num(sd.trailingPE) ?? num(ks.trailingPE);
    out.forward_pe = num(sd.forwardPE) ?? num(ks.forwardPE);
    out.peg_ratio = num(ks.pegRatio);
    out.ps_ratio = num(sd.priceToSalesTrailing12Months);
    out.pb_ratio = num(ks.priceToBook);
    if (out.pe_ratio !== null || out.forward_pe !== null) out.source_valuation = "yahoo";

    // Profitability
    out.gross_margin = num(fd.grossMargins);
    out.net_margin = num(fd.profitMargins) ?? num(ks.profitMargins);
    out.operating_margin = num(fd.operatingMargins);
    out.roe = num(fd.returnOnEquity);
    out.roa = num(fd.returnOnAssets);
    out.debt_to_equity = num(fd.debtToEquity);
    out.current_ratio = num(fd.currentRatio);

    // Growth: Yahoo provides earningsGrowth/revenueGrowth = quarterly YoY
    out.eps_quarterly_yoy = num(fd.earningsQuarterlyGrowth) !== null
      ? Math.round(num(fd.earningsQuarterlyGrowth)! * 10000) / 100
      : null;
    out.revenue_quarterly_yoy = num(fd.revenueGrowth) !== null
      ? Math.round(num(fd.revenueGrowth)! * 10000) / 100
      : null;
    if (out.eps_quarterly_yoy !== null) out.source_eps = "yahoo";
    if (out.revenue_quarterly_yoy !== null) out.source_revenue = "yahoo";

    // Annual YoY from incomeStatementHistory (most recent vs prior FY)
    if (ish.length >= 2) {
      const cur = ish[0], prev = ish[1];
      const curRev = num(cur.totalRevenue);
      const prevRev = num(prev.totalRevenue);
      const curNi = num(cur.netIncome);
      const prevNi = num(prev.netIncome);
      out.revenue_annual_yoy = pctGrowth(curRev, prevRev);
      out.eps_annual_yoy = pctGrowth(curNi, prevNi);  // proxy via net income (shares ~ stable)
      if (out.revenue_annual_yoy !== null) out.source_revenue = (out.source_revenue ?? "yahoo");
      if (out.eps_annual_yoy !== null) out.source_eps = (out.source_eps ?? "yahoo");
    }

    // Quarterly QoQ: most recent Q vs prior Q
    if (ishq.length >= 2) {
      const cur = ishq[0], prev = ishq[1];
      out.revenue_quarterly_qoq = pctGrowth(num(cur.totalRevenue), num(prev.totalRevenue));
      out.eps_quarterly_qoq = pctGrowth(num(cur.netIncome), num(prev.netIncome));
    }

    // TTM YoY: sum last 4 quarters vs sum prior 4 quarters
    if (ishq.length >= 8) {
      const sumRev = (arr: any[]) => arr.reduce((s, q) => s + (num(q.totalRevenue) ?? 0), 0);
      const sumNi = (arr: any[]) => arr.reduce((s, q) => s + (num(q.netIncome) ?? 0), 0);
      const ttmRev = sumRev(ishq.slice(0, 4));
      const priorRev = sumRev(ishq.slice(4, 8));
      const ttmNi = sumNi(ishq.slice(0, 4));
      const priorNi = sumNi(ishq.slice(4, 8));
      out.revenue_ttm_yoy = pctGrowth(ttmRev, priorRev);
      out.eps_ttm_yoy = pctGrowth(ttmNi, priorNi);
    }

    // Fallback: earnings module yearly array if incomeStatementHistory was thin
    const earningsYearly = ea?.financialsChart?.yearly ?? [];
    if (out.revenue_annual_yoy === null && earningsYearly.length >= 2) {
      const last = earningsYearly[earningsYearly.length - 1];
      const prev = earningsYearly[earningsYearly.length - 2];
      out.revenue_annual_yoy = pctGrowth(num(last.revenue), num(prev.revenue));
      if (out.revenue_annual_yoy !== null) out.source_revenue = out.source_revenue ?? "yahoo";
    }
    if (out.eps_annual_yoy === null && earningsYearly.length >= 2) {
      const last = earningsYearly[earningsYearly.length - 1];
      const prev = earningsYearly[earningsYearly.length - 2];
      out.eps_annual_yoy = pctGrowth(num(last.earnings), num(prev.earnings));
      if (out.eps_annual_yoy !== null) out.source_eps = out.source_eps ?? "yahoo";
    }
  }

  // ── Finnhub fallback / supplement ──
  if (fh?.metric) {
    const m = fh.metric;
    if (out.pe_ratio === null) {
      out.pe_ratio = num(m.peTTM) ?? num(m.peBasicExclExtraTTM);
      if (out.pe_ratio !== null) out.source_valuation = out.source_valuation ?? "finnhub";
    }
    if (out.forward_pe === null) {
      // Finnhub doesn't expose forward PE here reliably; skip
    }
    if (out.ps_ratio === null) { out.ps_ratio = num(m.psTTM); }
    if (out.pb_ratio === null) { out.pb_ratio = num(m.pbAnnual) ?? num(m.pbQuarterly); }
    if (out.gross_margin === null) {
      const g = num(m.grossMarginTTM); if (g !== null) out.gross_margin = g / 100;
    }
    if (out.net_margin === null) {
      const g = num(m.netProfitMarginTTM); if (g !== null) out.net_margin = g / 100;
    }
    if (out.operating_margin === null) {
      const g = num(m.operatingMarginTTM); if (g !== null) out.operating_margin = g / 100;
    }
    if (out.roe === null) {
      const g = num(m.roeTTM); if (g !== null) out.roe = g / 100;
    }
    if (out.roa === null) {
      const g = num(m.roaTTM); if (g !== null) out.roa = g / 100;
    }
    if (out.debt_to_equity === null) out.debt_to_equity = num(m["totalDebt/totalEquityAnnual"]) ?? num(m["totalDebt/totalEquityQuarterly"]);
    if (out.current_ratio === null) out.current_ratio = num(m.currentRatioAnnual) ?? num(m.currentRatioQuarterly);

    // Growth fallbacks from Finnhub metrics
    if (out.eps_ttm_yoy === null) {
      const g = num(m.epsGrowthTTMYoy); if (g !== null) out.eps_ttm_yoy = g;
      if (out.eps_ttm_yoy !== null) out.source_eps = out.source_eps ?? "finnhub";
    }
    if (out.eps_quarterly_yoy === null) {
      const g = num(m.epsGrowthQuarterlyYoy); if (g !== null) out.eps_quarterly_yoy = g;
      if (out.eps_quarterly_yoy !== null) out.source_eps = out.source_eps ?? "finnhub";
    }
    if (out.revenue_ttm_yoy === null) {
      const g = num(m.revenueGrowthTTMYoy); if (g !== null) out.revenue_ttm_yoy = g;
      if (out.revenue_ttm_yoy !== null) out.source_revenue = out.source_revenue ?? "finnhub";
    }
    if (out.revenue_quarterly_yoy === null) {
      const g = num(m.revenueGrowthQuarterlyYoy); if (g !== null) out.revenue_quarterly_yoy = g;
      if (out.revenue_quarterly_yoy !== null) out.source_revenue = out.source_revenue ?? "finnhub";
    }
    if (out.eps_annual_yoy === null) {
      const g = num(m.epsGrowth5Y); // not exact, but a proxy if available; otherwise null
      // skip — keep null rather than report wrong figure
    }
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not set");

    const supabase = createClient(SB_URL, SB_KEY);

    // Recover stuck "processing" rows (>5 min)
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    await supabase
      .from("fundamentals_scan_queue")
      .update({ status: "pending" })
      .eq("status", "processing")
      .lt("enqueued_at", fiveMinAgo);

    // Respect pause
    const { data: prog } = await supabase
      .from("fundamentals_scan_progress")
      .select("status")
      .eq("id", 1)
      .maybeSingle();
    if (prog?.status === "paused") {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "scan paused" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Claim batch
    const { data: pending } = await supabase
      .from("fundamentals_scan_queue")
      .select("symbol, attempts")
      .eq("status", "pending")
      .limit(BATCH_SIZE);

    if (!pending || pending.length === 0) {
      // Derive final counters from queue, mark complete, and stop cron
      const { count: doneCount } = await supabase
        .from("fundamentals_scan_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "done");
      const { count: failedCount } = await supabase
        .from("fundamentals_scan_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed");
      const { count: skippedCount } = await supabase
        .from("fundamentals_scan_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "skipped");
      const { count: totalCount } = await supabase
        .from("fundamentals_scan_queue")
        .select("*", { count: "exact", head: true });

      const totalProcessed = (doneCount ?? 0) + (failedCount ?? 0) + (skippedCount ?? 0);
      await supabase
        .from("fundamentals_scan_progress")
        .update({
          status: "complete",
          processed: totalProcessed,
          succeeded: doneCount ?? 0,
          failed: failedCount ?? 0,
          total_queued: totalCount ?? totalProcessed,
          last_updated: new Date().toISOString(),
        })
        .eq("id", 1);

      try {
        await supabase.rpc("set_fundamentals_cron_active", { p_active: false });
      } catch (e) {
        console.error("Failed to deactivate cron:", e);
      }

      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "queue empty — scan complete", totalProcessed }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claimed = pending.map((p) => p.symbol);
    await supabase
      .from("fundamentals_scan_queue")
      .update({ status: "processing" })
      .in("symbol", claimed);

    let succeeded = 0;
    let processedCount = 0;
    let failed = 0;

    for (const sym of claimed) {
      try {
        // Yahoo first (no key, but rate-limited by IP)
        const yh = await fetchYahooQuoteSummary(sym);
        await sleep(YAHOO_DELAY_MS);

        if (yh.status === 429) {
          await supabase.from("fundamentals_scan_queue").update({ status: "pending" }).eq("symbol", sym);
          console.log("Yahoo 429 — releasing rest of batch");
          break;
        }

        // Finnhub metric (60/min)
        const fh = await fetchFinnhubMetric(sym, FINNHUB_KEY);
        if (fh.status === 429) {
          await supabase.from("fundamentals_scan_queue").update({ status: "pending" }).eq("symbol", sym);
          console.log("Finnhub 429 — releasing rest of batch");
          break;
        }
        await sleep(FINNHUB_DELAY_MS);

        const ext = extract(yh.data, fh.data);

        // Count "data found" — at least 1 metric populated
        const hasAny = Object.entries(ext).some(([k, v]) =>
          v !== null && k !== "source_eps" && k !== "source_revenue" && k !== "source_valuation" && k !== "company_name" && k !== "sector"
        );

        if (!hasAny) {
          await supabase.from("fundamentals_scan_queue")
            .update({ status: "skipped", last_error: "no_data", processed_at: new Date().toISOString() })
            .eq("symbol", sym);
          processedCount++;
          continue;
        }

        await supabase.from("stock_fundamentals").upsert({
          symbol: sym,
          ...ext,
          raw_yahoo: yh.data ? { fetched_at: new Date().toISOString() } : null,
          raw_finnhub: fh.data ? { fetched_at: new Date().toISOString() } : null,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "symbol" });

        await supabase.from("fundamentals_scan_queue")
          .update({ status: "done", processed_at: new Date().toISOString() })
          .eq("symbol", sym);

        succeeded++;
        processedCount++;
      } catch (e) {
        console.error(`Error processing ${sym}:`, e);
        failed++;
        processedCount++;
        await supabase
          .from("fundamentals_scan_queue")
          .update({ status: "failed", last_error: String(e), processed_at: new Date().toISOString() })
          .eq("symbol", sym);
      }
    }

    // Update progress
    const { data: progRow } = await supabase
      .from("fundamentals_scan_progress")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    const newProcessed = (progRow?.processed ?? 0) + processedCount;
    const newSucceeded = (progRow?.succeeded ?? 0) + succeeded;
    const newFailed = (progRow?.failed ?? 0) + failed;

    const { count: remaining } = await supabase
      .from("fundamentals_scan_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const newStatus =
      progRow?.status === "paused"
        ? "paused"
        : (remaining ?? 0) === 0
          ? "complete"
          : "running";

    await supabase
      .from("fundamentals_scan_progress")
      .update({
        processed: newProcessed,
        succeeded: newSucceeded,
        failed: newFailed,
        status: newStatus,
        last_updated: new Date().toISOString(),
      })
      .eq("id", 1);

    return new Response(
      JSON.stringify({
        ok: true,
        batch: claimed.length,
        processed: processedCount,
        succeeded,
        failed,
        remaining_pending: remaining,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("process-fundamentals-queue error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
