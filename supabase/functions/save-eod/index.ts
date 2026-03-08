const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const TICKERS_PER_CHUNK = 12;
const CALL_DELAY_MS = 1100;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30000;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayET(): { dateStr: string; hour: number; dayOfWeek: number } {
  const now = new Date();
  // Convert to ET (UTC-5 or UTC-4 for DST)
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, "0");
  const day = String(et.getDate()).padStart(2, "0");
  return {
    dateStr: `${year}-${month}-${day}`,
    hour: et.getHours(),
    dayOfWeek: et.getDay(), // 0=Sun, 6=Sat
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // --- CHECK: Can we save EOD today? ---
    if (action === "check") {
      const { dateStr, hour, dayOfWeek } = todayET();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isAfterClose = hour >= 16;

      // Check if already saved today
      const { data: existing } = await sb
        .from("eod_save_sessions")
        .select("*")
        .eq("date", dateStr)
        .single();

      // Check if Friday close already saved (for weekend button)
      let fridayDate: string | null = null;
      let fridayAlreadySaved = false;
      if (isWeekend) {
        // Calculate last Friday's date
        const now = new Date();
        const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
        const et = new Date(etStr);
        const diff = dayOfWeek === 0 ? 2 : 1; // Sun=2 days back, Sat=1 day back
        et.setDate(et.getDate() - diff);
        fridayDate = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
        const { data: fridaySession } = await sb
          .from("eod_save_sessions")
          .select("status, completed_at")
          .eq("date", fridayDate)
          .single();
        fridayAlreadySaved = fridaySession?.status === "completed";
        var fridayCompletedAt = fridaySession?.completed_at || null;
      }

      return new Response(JSON.stringify({
        date: dateStr,
        isWeekend,
        isAfterClose,
        alreadySaved: existing?.status === "completed",
        session: existing || null,
        fridayDate,
        fridayAlreadySaved,
        fridayCompletedAt: fridayCompletedAt ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- START: Initialize EOD save session ---
    if (action === "start") {
      const { dateStr, dayOfWeek } = todayET();
      const usePc = url.searchParams.get("use_pc") === "true";
      
      // For Friday save on weekends, use last Friday's date
      let saveDate = dateStr;
      if (usePc && (dayOfWeek === 0 || dayOfWeek === 6)) {
        const now = new Date();
        const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
        const et = new Date(etStr);
        const diff = dayOfWeek === 0 ? 2 : 1;
        et.setDate(et.getDate() - diff);
        saveDate = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
      }

      // Get all tickers with their theme names
      const { data: themes } = await sb.from("themes").select("id, name");
      const { data: tickers } = await sb.from("theme_tickers").select("theme_id, ticker_symbol");
      if (!themes || !tickers) throw new Error("Failed to read themes/tickers");

      const themeMap = new Map(themes.map(t => [t.id, t.name]));
      const tickerList = tickers.map(t => ({
        symbol: t.ticker_symbol,
        theme_name: themeMap.get(t.theme_id) || "Unknown",
      }));

      // Deduplicate by symbol (keep first theme_name)
      const seen = new Set<string>();
      const unique = tickerList.filter(t => {
        if (seen.has(t.symbol)) return false;
        seen.add(t.symbol);
        return true;
      });

      // Upsert session
      await sb.from("eod_save_sessions").upsert({
        date: saveDate,
        status: "in_progress",
        total_tickers: unique.length,
        saved_count: 0,
        failed_count: 0,
        failed_symbols: [],
        started_at: new Date().toISOString(),
        completed_at: null,
      }, { onConflict: "date" });

      return new Response(JSON.stringify({
        ok: true,
        date: saveDate,
        total: unique.length,
        tickers: unique,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- CHUNK: Process a batch of tickers for EOD save ---
    if (action === "chunk") {
      const body = await req.json();
      const { tickers, date } = body as { tickers: { symbol: string; theme_name: string }[]; date: string };

      if (!tickers || !date) {
        return new Response(JSON.stringify({ error: "Missing tickers or date" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let savedCount = 0;
      let failedCount = 0;
      const failedSymbols: string[] = [];

      for (const { symbol, theme_name } of tickers) {
        let success = false;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const res = await fetch(
              `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
            );

            if (res.status === 429) {
              if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
              break;
            }
            if (!res.ok) {
              if (attempt < MAX_RETRIES) { await delay(5000); continue; }
              break;
            }

            const data = await res.json();
            
            const usePc = url.searchParams.get("use_pc") === "true";
            
            // Determine close price with fallback logic
            let closePrice: number | null = null;
            if (usePc) {
              // Primary: pc (previous close). Fallback: c (current price, which on weekends = Friday close)
              if (data.pc && data.pc !== 0) {
                closePrice = data.pc;
              } else if (data.c && data.c !== 0) {
                closePrice = data.c;
                console.log(`${symbol}: pc was ${data.pc}, falling back to c=${data.c}`);
              }
            } else {
              closePrice = data.c;
            }

            if (closePrice === null || closePrice === 0) {
              console.log(`${symbol}: both pc=${data.pc} and c=${data.c} are zero/null — marking failed`);
              if (attempt < MAX_RETRIES) { await delay(2000); continue; }
              break;
            }

            // Upsert into eod_prices
            const { error: upsertErr } = await sb.from("eod_prices").upsert({
              symbol,
              theme_name,
              date,
              close_price: closePrice,
              open_price: usePc ? null : (data.o || null),
              high_price: usePc ? null : (data.h || null),
              low_price: usePc ? null : (data.l || null),
              volume: usePc ? null : (typeof data.v === 'number' ? Math.round(data.v) : null),
              source: usePc ? "friday_pc_save" : "finnhub_quote",
              is_backfill: false,
            }, { onConflict: "symbol,date" });

            if (upsertErr) {
              console.error(`Upsert error for ${symbol}:`, upsertErr);
              if (attempt < MAX_RETRIES) { await delay(2000); continue; }
              break;
            }

            success = true;
            savedCount++;
            break;
          } catch (e) {
            console.error(`Network error for ${symbol} attempt ${attempt}:`, e);
            if (attempt < MAX_RETRIES) { await delay(2000); continue; }
            break;
          }
        }

        if (!success) {
          failedCount++;
          failedSymbols.push(symbol);
          console.log(`EOD FAILED ${symbol}`);
        }

        await delay(CALL_DELAY_MS);
      }

      // Update session counts
      const { data: session } = await sb
        .from("eod_save_sessions")
        .select("saved_count, failed_count, failed_symbols")
        .eq("date", date)
        .single();

      if (session) {
        await sb.from("eod_save_sessions").update({
          saved_count: (session.saved_count || 0) + savedCount,
          failed_count: (session.failed_count || 0) + failedCount,
          failed_symbols: [...(session.failed_symbols || []), ...failedSymbols],
        }).eq("date", date);
      }

      return new Response(JSON.stringify({
        saved: savedCount,
        failed: failedCount,
        failedSymbols,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- COMPLETE: Mark session as done ---
    if (action === "complete") {
      const body = await req.json();
      const { date } = body as { date: string };

      // Calculate dispersion score from today's saved prices
      let dispersionScore: number | null = null;
      try {
        const { data: prices } = await sb
          .from("eod_prices")
          .select("theme_name, close_price, symbol")
          .eq("date", date);

        if (prices && prices.length > 0) {
          // Get previous day's prices for % change calculation
          // Find the most recent date before `date`
          const { data: prevDayData } = await sb
            .from("eod_prices")
            .select("date")
            .lt("date", date)
            .order("date", { ascending: false })
            .limit(1);

          if (prevDayData && prevDayData.length > 0) {
            const prevDate = prevDayData[0].date;
            const { data: prevPrices } = await sb
              .from("eod_prices")
              .select("theme_name, close_price, symbol")
              .eq("date", prevDate);

            if (prevPrices && prevPrices.length > 0) {
              const prevMap = new Map<string, Map<string, number>>();
              for (const p of prevPrices) {
                if (!prevMap.has(p.theme_name)) prevMap.set(p.theme_name, new Map());
                prevMap.get(p.theme_name)!.set(p.symbol, p.close_price);
              }

              // Calculate per-theme avg % change
              const themePerfs: number[] = [];
              const todayByTheme = new Map<string, { symbol: string; close: number }[]>();
              for (const p of prices) {
                if (!todayByTheme.has(p.theme_name)) todayByTheme.set(p.theme_name, []);
                todayByTheme.get(p.theme_name)!.push({ symbol: p.symbol, close: p.close_price });
              }

              for (const [theme, tickers] of todayByTheme) {
                const prevTheme = prevMap.get(theme);
                if (!prevTheme) continue;
                const pcts: number[] = [];
                for (const t of tickers) {
                  const prev = prevTheme.get(t.symbol);
                  if (prev && prev > 0) pcts.push(((t.close - prev) / prev) * 100);
                }
                if (pcts.length > 0) themePerfs.push(pcts.reduce((a, b) => a + b, 0) / pcts.length);
              }

              if (themePerfs.length >= 3) {
                const mean = themePerfs.reduce((a, b) => a + b, 0) / themePerfs.length;
                const variance = themePerfs.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / themePerfs.length;
                dispersionScore = Math.round(Math.sqrt(variance) * 100) / 100;
                console.log(`Dispersion score for ${date}: ${dispersionScore}`);
              }
            }
          }
        }
      } catch (dispErr) {
        console.warn("Failed to calculate dispersion:", dispErr);
      }

      await sb.from("eod_save_sessions").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        dispersion_score: dispersionScore,
      }).eq("date", date);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- STATUS: Get session info for a date ---
    if (action === "status") {
      const { dateStr } = todayET();
      const { data: session } = await sb
        .from("eod_save_sessions")
        .select("*")
        .eq("date", dateStr)
        .single();

      return new Response(JSON.stringify({ session: session || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Save EOD error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
