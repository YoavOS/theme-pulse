import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SYSTEM_PROMPT = `You are a professional market analyst writing a weekly thematic market recap.
Write a structured weekly summary in exactly this format — plain prose, no bullet points, no headers:
Paragraph 1 (3-4 sentences): Weekly winners — what led, why it mattered, whether volume confirmed.
Paragraph 2 (3-4 sentences): Weekly losers — what faded, any reversals worth noting, breadth context.
Paragraph 3 (2-3 sentences): The week's most interesting story — biggest surprise, reversal, or anomaly.
Paragraph 4 (2-3 sentences): What to watch next week — specific themes and conditions to monitor.
Be specific with theme names, percentages, and ticker names. No generic filler.`;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getFridayDate(refDate?: string): string {
  const d = refDate ? new Date(refDate + "T12:00:00Z") : new Date();
  const day = d.getUTCDay();
  // If Sunday(0), go back 2; Saturday(6), go back 1; Friday(5) keep; else go back to last Friday
  const diff = day === 0 ? 2 : day === 6 ? 1 : day === 5 ? 0 : day + 2;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().split("T")[0];
}

function getMondayDate(fridayStr: string): string {
  const d = new Date(fridayStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 4);
  return d.toISOString().split("T")[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "GROQ_API_KEY not configured" }, 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch {}

    const fridayDate = body.week_ending || getFridayDate();
    const mondayDate = getMondayDate(fridayDate);

    console.log(`Generating weekly report: ${mondayDate} to ${fridayDate}`);

    // 1. Get all EOD prices for the week
    const { data: eodData, error: eodErr } = await sb
      .from("eod_prices")
      .select("symbol, theme_name, date, close_price, volume")
      .gte("date", mondayDate)
      .lte("date", fridayDate)
      .order("date", { ascending: true });

    if (eodErr) {
      console.error("EOD query error:", eodErr);
      return jsonResponse({ error: "Failed to fetch EOD data" }, 500);
    }

    if (!eodData || eodData.length === 0) {
      return jsonResponse({ error: "No EOD data found for this week. Run EOD saves first.", insufficient_data: true, days_available: 0 });
    }

    // Count unique trading days
    const uniqueDays = new Set(eodData.map(r => r.date));
    const daysAvailable = uniqueDays.size;

    if (daysAvailable < 3) {
      return jsonResponse({
        error: `Not enough data for this week yet — report will generate automatically after Friday EOD save. ${daysAvailable} day${daysAvailable === 1 ? "" : "s"} of data available so far this week.`,
        insufficient_data: true,
        days_available: daysAvailable,
      });
    }

    // 2. Get volume data
    const { data: volData } = await sb.from("ticker_volume_cache").select("symbol, avg_20d, avg_3m, avg_10d, today_vol");
    const volMap = new Map((volData || []).map(v => [v.symbol, v]));

    // 3. Aggregate by theme
    type ThemeAgg = {
      theme: string;
      symbols: Set<string>;
      mondayPrices: Map<string, number>;
      fridayPrices: Map<string, number>;
      dailyPrices: Map<string, Map<string, number>>; // symbol -> date -> price
    };

    const themeMap = new Map<string, ThemeAgg>();

    for (const row of eodData) {
      if (!themeMap.has(row.theme_name)) {
        themeMap.set(row.theme_name, {
          theme: row.theme_name,
          symbols: new Set(),
          mondayPrices: new Map(),
          fridayPrices: new Map(),
          dailyPrices: new Map(),
        });
      }
      const agg = themeMap.get(row.theme_name)!;
      agg.symbols.add(row.symbol);

      if (!agg.dailyPrices.has(row.symbol)) {
        agg.dailyPrices.set(row.symbol, new Map());
      }
      agg.dailyPrices.get(row.symbol)!.set(row.date, row.close_price);

      if (row.date === mondayDate || (!agg.mondayPrices.has(row.symbol) && row.date <= mondayDate)) {
        agg.mondayPrices.set(row.symbol, row.close_price);
      }
      if (row.date === fridayDate || (!agg.fridayPrices.has(row.symbol) && row.date >= fridayDate)) {
        agg.fridayPrices.set(row.symbol, row.close_price);
      }
    }

    // Use earliest available price as "Monday" if exact Monday missing
    for (const agg of themeMap.values()) {
      for (const sym of agg.symbols) {
        if (!agg.mondayPrices.has(sym)) {
          const dates = agg.dailyPrices.get(sym);
          if (dates) {
            const sorted = [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            if (sorted.length > 0) agg.mondayPrices.set(sym, sorted[0][1]);
          }
        }
        if (!agg.fridayPrices.has(sym)) {
          const dates = agg.dailyPrices.get(sym);
          if (dates) {
            const sorted = [...dates.entries()].sort((a, b) => b[0].localeCompare(a[0]));
            if (sorted.length > 0) agg.fridayPrices.set(sym, sorted[0][1]);
          }
        }
      }
    }

    // 4. Compute theme-level stats
    interface ThemeStats {
      name: string;
      weekPerf: number;
      tickerCount: number;
      advancing: number;
      tickers: { symbol: string; weekPerf: number; relVol: number | null }[];
      avgRelVol: number | null;
      sustainedVol: number | null;
      midWeekReversal: boolean;
    }

    const themeStats: ThemeStats[] = [];

    for (const agg of themeMap.values()) {
      const tickers: ThemeStats["tickers"] = [];
      let advancing = 0;
      const perfs: number[] = [];

      for (const sym of agg.symbols) {
        const mon = agg.mondayPrices.get(sym);
        const fri = agg.fridayPrices.get(sym);
        if (mon && fri && mon > 0) {
          const perf = ((fri - mon) / mon) * 100;
          perfs.push(perf);
          if (perf > 0) advancing++;

          const vol = volMap.get(sym);
          const relVol = vol && vol.avg_20d && vol.avg_20d > 0 && vol.today_vol
            ? vol.today_vol / vol.avg_20d
            : null;

          tickers.push({ symbol: sym, weekPerf: Math.round(perf * 100) / 100, relVol });
        }
      }

      if (perfs.length === 0) continue;
      const avgPerf = perfs.reduce((a, b) => a + b, 0) / perfs.length;

      // Sustained vol
      const symVols = [...agg.symbols].map(s => volMap.get(s)).filter(Boolean);
      let sustainedVol: number | null = null;
      const validSustained = symVols.filter(v => v!.avg_10d && v!.avg_3m && v!.avg_3m! > 0);
      if (validSustained.length > 0) {
        const avg = validSustained.reduce((sum, v) => sum + ((v!.avg_10d! - v!.avg_3m!) / v!.avg_3m!) * 100, 0) / validSustained.length;
        sustainedVol = Math.round(avg);
      }

      // Avg rel vol
      const relVols = tickers.map(t => t.relVol).filter((v): v is number => v !== null);
      const avgRelVol = relVols.length > 0 ? relVols.reduce((a, b) => a + b, 0) / relVols.length : null;

      // Mid-week reversal detection: check if first half and second half have opposite signs
      let midWeekReversal = false;
      const allDates = [...new Set(eodData.filter(r => r.theme_name === agg.theme).map(r => r.date))].sort();
      if (allDates.length >= 3) {
        const mid = Math.floor(allDates.length / 2);
        // Compute avg theme perf for first half vs second half
        const firstHalfPerfs: number[] = [];
        const secondHalfPerfs: number[] = [];
        for (const sym of agg.symbols) {
          const prices = agg.dailyPrices.get(sym);
          if (!prices) continue;
          const first = prices.get(allDates[0]);
          const midPrice = prices.get(allDates[mid]);
          const last = prices.get(allDates[allDates.length - 1]);
          if (first && midPrice && first > 0) firstHalfPerfs.push(((midPrice - first) / first) * 100);
          if (midPrice && last && midPrice > 0) secondHalfPerfs.push(((last - midPrice) / midPrice) * 100);
        }
        if (firstHalfPerfs.length > 0 && secondHalfPerfs.length > 0) {
          const avgFirst = firstHalfPerfs.reduce((a, b) => a + b, 0) / firstHalfPerfs.length;
          const avgSecond = secondHalfPerfs.reduce((a, b) => a + b, 0) / secondHalfPerfs.length;
          if ((avgFirst > 1 && avgSecond < -1) || (avgFirst < -1 && avgSecond > 1)) {
            midWeekReversal = true;
          }
        }
      }

      tickers.sort((a, b) => Math.abs(b.weekPerf) - Math.abs(a.weekPerf));

      themeStats.push({
        name: agg.theme,
        weekPerf: Math.round(avgPerf * 100) / 100,
        tickerCount: tickers.length,
        advancing,
        tickers: tickers.slice(0, 5),
        avgRelVol: avgRelVol ? Math.round(avgRelVol * 10) / 10 : null,
        sustainedVol,
        midWeekReversal,
      });
    }

    themeStats.sort((a, b) => b.weekPerf - a.weekPerf);

    const topThemes = themeStats.slice(0, 8);
    const bottomThemes = [...themeStats].sort((a, b) => a.weekPerf - b.weekPerf).slice(0, 8);
    const reversals = themeStats.filter(t => t.midWeekReversal).slice(0, 5);
    const volAnomalies = themeStats.filter(t => t.sustainedVol !== null && Math.abs(t.sustainedVol!) > 20)
      .sort((a, b) => Math.abs(b.sustainedVol!) - Math.abs(a.sustainedVol!))
      .slice(0, 5);

    // 5. Build prompt
    const formatTheme = (t: ThemeStats) => {
      const tickerStr = t.tickers.map(tk => `${tk.symbol}: ${tk.weekPerf >= 0 ? "+" : ""}${tk.weekPerf}%`).join(", ");
      const volStr = t.avgRelVol ? ` | Rel Vol: ${t.avgRelVol}×` : "";
      const susStr = t.sustainedVol !== null ? ` | Sustained: ${t.sustainedVol >= 0 ? "+" : ""}${t.sustainedVol}%` : "";
      return `${t.name} | Week: ${t.weekPerf >= 0 ? "+" : ""}${t.weekPerf}% | Breadth: ${t.advancing}/${t.tickerCount}${volStr}${susStr}${t.midWeekReversal ? " | ⚠ MID-WEEK REVERSAL" : ""}
  Top movers: ${tickerStr}`;
    };

    const userMessage = `Week: ${mondayDate} to ${fridayDate} | ${themeStats.length} themes analyzed

WEEKLY WINNERS (top 8):
${topThemes.map(formatTheme).join("\n\n")}

WEEKLY LOSERS (bottom 8):
${bottomThemes.map(formatTheme).join("\n\n")}

MID-WEEK REVERSALS:
${reversals.length > 0 ? reversals.map(formatTheme).join("\n\n") : "None identified"}

VOLUME ANOMALIES (sustained vol >20% deviation):
${volAnomalies.length > 0 ? volAnomalies.map(formatTheme).join("\n\n") : "None identified"}

Write the weekly recap following your instructions.`;

    console.log("Calling Groq for weekly report...");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq error:", response.status, errText);
      return jsonResponse({ error: `AI error (${response.status})` }, 502);
    }

    const result = await response.json();
    const narrative = result.choices?.[0]?.message?.content || "Unable to generate report.";

    // 6. Save to weekly_reports (upsert)
    const reportRow = {
      week_ending: fridayDate,
      narrative,
      top_themes: topThemes.map(t => ({ name: t.name, weekPerf: t.weekPerf, breadth: `${t.advancing}/${t.tickerCount}` })),
      bottom_themes: bottomThemes.map(t => ({ name: t.name, weekPerf: t.weekPerf, breadth: `${t.advancing}/${t.tickerCount}` })),
      biggest_reversals: reversals.map(t => ({ name: t.name, weekPerf: t.weekPerf })),
      volume_anomalies: volAnomalies.map(t => ({ name: t.name, sustainedVol: t.sustainedVol, weekPerf: t.weekPerf })),
      generated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await sb
      .from("weekly_reports")
      .upsert(reportRow, { onConflict: "week_ending" });

    if (upsertErr) {
      console.error("Upsert error:", upsertErr);
      return jsonResponse({ error: "Report generated but failed to save", narrative }, 500);
    }

    console.log("Weekly report saved for", fridayDate);
    return jsonResponse({ success: true, week_ending: fridayDate, narrative, generated_at: reportRow.generated_at });
  } catch (e) {
    console.error("Unhandled error:", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
