// First-30-minute regular-session volume strength for one symbol.
// POST { symbol: string }
// Returns: {
//   symbol, todayFirst30:number|null, avgFirst30:number|null, ratio:number|null,
//   sessions: { date:string, vol:number, ratio:number|null }[],   // chronological, oldest -> newest
//   isToday: boolean,
// }
//
// Strategy: pull ~14 days of 5m bars (regular hours only) from Yahoo, group by
// session date, sum volume of the first 6 bars (30 min). Compare today to the
// average of the prior 10 sessions.

import { corsHeaders } from "../_shared/cors.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FIRST_BARS = 6; // 6 × 5m = 30 min
const HISTORY_DAYS = 10;

type Bar = { ts: number; vol: number };

async function fetchSeries(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1mo&interval=5m&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r) return null;
  const ts: number[] = r.timestamp ?? [];
  const vols: (number | null)[] = r.indicators?.quote?.[0]?.volume ?? [];
  const tz: string = r.meta?.exchangeTimezoneName ?? "America/New_York";
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = vols[i];
    if (v == null || v <= 0) continue;
    out.push({ ts: ts[i], vol: v });
  }
  return { bars: out, tz };
}

function dateKey(tsSec: number, tz: string): string {
  // YYYY-MM-DD in exchange timezone
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsSec * 1000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = String(body.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fetched = await fetchSeries(symbol);
    if (!fetched || fetched.bars.length === 0) {
      return new Response(
        JSON.stringify({
          symbol,
          todayFirst30: null,
          avgFirst30: null,
          ratio: null,
          sessions: [],
          isToday: false,
          error: "no_intraday_data",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { bars, tz } = fetched;
    // Group bars by session date (exchange tz).
    const byDay = new Map<string, Bar[]>();
    for (const b of bars) {
      const k = dateKey(b.ts, tz);
      const arr = byDay.get(k) ?? [];
      arr.push(b);
      byDay.set(k, arr);
    }
    // For each session sum first N bars in chronological order.
    const sortedDays = [...byDay.keys()].sort();
    const sessions = sortedDays.map((d) => {
      const arr = byDay.get(d)!.sort((a, b) => a.ts - b.ts);
      const slice = arr.slice(0, FIRST_BARS);
      const vol = slice.reduce((s, x) => s + x.vol, 0);
      return { date: d, vol, barCount: slice.length };
    });

    const todayKey = dateKey(Math.floor(Date.now() / 1000), tz);
    const todaySession = sessions.find((s) => s.date === todayKey);
    const isToday = !!todaySession && todaySession.barCount >= 1;

    // Average of prior sessions (exclude today), use most recent HISTORY_DAYS,
    // require full 6-bar windows.
    const prior = sessions.filter((s) => s.date !== todayKey && s.barCount === FIRST_BARS);
    const tail = prior.slice(-HISTORY_DAYS);
    const avgFirst30 =
      tail.length > 0 ? Math.round(tail.reduce((a, b) => a + b.vol, 0) / tail.length) : null;

    const todayFirst30 = isToday ? todaySession!.vol : null;
    const ratio = todayFirst30 != null && avgFirst30 ? todayFirst30 / avgFirst30 : null;

    // Per-day ratio for sparkline (each day's first-30 vol vs avg of previous 10).
    const sparkSessions = tail.map((s, i, arr) => {
      const baseSet = arr.slice(Math.max(0, i - HISTORY_DAYS), i);
      const base = baseSet.length > 0 ? baseSet.reduce((a, b) => a + b.vol, 0) / baseSet.length : null;
      return { date: s.date, vol: s.vol, ratio: base ? s.vol / base : null };
    });
    if (isToday && avgFirst30) {
      sparkSessions.push({ date: todayKey, vol: todayFirst30!, ratio });
    }

    return new Response(
      JSON.stringify({
        symbol,
        todayFirst30,
        avgFirst30,
        ratio,
        sessions: sparkSessions,
        isToday,
        sampleSize: tail.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
