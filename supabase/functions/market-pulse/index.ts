// market-pulse — the fast-moving inputs of the Stages "Momentum gauge".
//
// Everything here changes during the day, so it is fetched live (cached 5 minutes per warm
// instance): index trend and drawdown, volatility (VIX, VIX/VIX3M, realised volatility), index
// futures (the pre-market read), the index's move today, and known event days.
// The slower inputs (momentum's own results, breadth, leadership stretch) are computed in the
// app from data it already has.
//
// POST {} → { ok, asOf, session, indexes: { SPY, QQQ }, vix, futures, events }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 5 * 60_000;
let cache: { at: number; body: unknown } | null = null;

const r2 = (x: number) => Math.round(x * 100) / 100;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Chart { closes: number[]; price: number | null; prevClose: number | null; time: number | null }

async function chart(symbol: string, range: string): Promise<Chart | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { headers: { "User-Agent": UA } });
      if (!r.ok) { await r.body?.cancel(); continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const closes = ((res?.indicators?.quote?.[0]?.close ?? []) as (number | null)[]).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
      const m = res?.meta ?? {};
      const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : closes[closes.length - 1] ?? null;
      const time = typeof m.regularMarketTime === "number" ? m.regularMarketTime : null;
      // Previous session's close: the daily bar before the bar that holds regularMarketTime.
      let prevClose: number | null = typeof m.previousClose === "number" ? m.previousClose : null;
      const ts: number[] = res?.timestamp ?? [];
      if (prevClose === null && ts.length >= 2) {
        const all = (res?.indicators?.quote?.[0]?.close ?? []) as (number | null)[];
        const lastDay = time ? new Date(time * 1000).toISOString().slice(0, 10) : null;
        const lastBarDay = new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10);
        const k = lastDay && lastDay === lastBarDay ? ts.length - 2 : ts.length - 1;
        for (let i = k; i >= 0; i--) if (typeof all[i] === "number") { prevClose = all[i] as number; break; }
      }
      return { closes, price, prevClose, time };
    } catch { /* retry */ }
  }
  return null;
}

function indexStats(c: Chart | null) {
  if (!c || c.closes.length < 260 || c.price === null) return null;
  const closes = [...c.closes];
  const last = c.price;
  const sma = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const hi = Math.max(...closes.slice(-252), last);
  const rets = closes.slice(1).map((x, i) => Math.log(x / closes[i]));
  const vol = (end: number) => {
    const w = rets.slice(Math.max(0, end - 20), end);
    if (w.length < 15) return null;
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1)) * Math.sqrt(252) * 100;
  };
  const rvNow = vol(rets.length);
  const hist: number[] = [];
  for (let e = Math.max(20, rets.length - 504); e < rets.length; e += 5) { const v = vol(e); if (v !== null) hist.push(v); }
  return {
    price: r2(last),
    changePct: c.prevClose ? r2((last / c.prevClose - 1) * 100) : null,
    vs50: r2((last / sma(50) - 1) * 100),
    vs200: r2((last / sma(200) - 1) * 100),
    ret12m: r2((last / closes[closes.length - 252] - 1) * 100),
    fromHigh: r2((last / hi - 1) * 100),
    realizedVol: rvNow === null ? null : r2(rvNow),
    realizedVolPct: rvNow === null || !hist.length ? null : Math.round((hist.filter((v) => v < rvNow).length / hist.length) * 100),
  };
}

/** New York wall-clock parts. */
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";
  const session = weekend ? "closed" : mins < 240 ? "closed" : mins < 570 ? "pre" : mins < 960 ? "regular" : mins < 1200 ? "post" : "closed";
  return { date, session, minutesIntoSession: session === "regular" ? mins - 570 : null };
}

// FOMC decision days (federalreserve.gov schedule) — same list as the app's Market Flag.
const FOMC_DAYS = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];
/** US federal election day: the Tuesday after the first Monday of November, even years. */
function electionDay(year: number): string | null {
  if (year % 2) return null;
  const d = new Date(Date.UTC(year, 10, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const shiftDay = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

// The biggest Nasdaq-100 / S&P weights: their earnings move the whole index.
const MEGA = ["NVDA", "MSFT", "AAPL", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "NFLX", "COST", "AMD", "PLTR", "ORCL", "MU"];

async function megaEarnings(today: string): Promise<{ symbol: string; date: string; hour: string | null }[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const from = shiftDay(today, -3), to = today;
    const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    if (!r.ok) { await r.body?.cancel(); return []; }
    const j = await r.json();
    // deno-lint-ignore no-explicit-any
    return ((j?.earningsCalendar ?? []) as any[])
      .filter((e) => MEGA.includes(String(e.symbol).toUpperCase()))
      .map((e) => ({ symbol: String(e.symbol).toUpperCase(), date: String(e.date), hour: e.hour ? String(e.hour) : null }))
      // Reports that move today's open: yesterday (or the last weekday) after the close, or today before the open.
      .filter((e) => (e.date === today && e.hour !== "amc") || (e.date < today && e.hour === "amc" && e.date >= shiftDay(today, -3)));
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (cache && Date.now() - cache.at < TTL) return json(cache.body);
    const ny = nyNow();
    const [spy, qqq, vix, vix3m, es, nq, mega] = await Promise.all([
      chart("SPY", "2y"), chart("QQQ", "2y"), chart("^VIX", "5d"), chart("^VIX3M", "5d"), chart("ES=F", "5d"), chart("NQ=F", "5d"), megaEarnings(ny.date),
    ]);
    const chg = (c: Chart | null) => (c?.price && c.prevClose ? r2((c.price / c.prevClose - 1) * 100) : null);
    const events: { kind: string; label: string }[] = [];
    if (FOMC_DAYS.includes(ny.date)) events.push({ kind: "fomc", label: "Fed decision today" });
    const ed = electionDay(Number(ny.date.slice(0, 4)));
    if (ed && (ny.date === ed || ny.date === shiftDay(ed, 1) || ny.date === shiftDay(ed, 2))) events.push({ kind: "election", label: ny.date === ed ? "US election day" : "Days after the US election — results can move whole sectors" });
    if (mega.length) events.push({ kind: "earnings", label: `Mega-cap earnings: ${mega.map((m) => m.symbol).join(", ")}` });
    const body = {
      ok: true,
      asOf: new Date().toISOString(),
      day: ny.date,
      session: ny.session,
      minutesIntoSession: ny.minutesIntoSession,
      indexes: { SPY: indexStats(spy), QQQ: indexStats(qqq) },
      vix: vix?.price ? {
        level: r2(vix.price), prevClose: vix.prevClose ? r2(vix.prevClose) : null, changePct: chg(vix),
        vix3m: vix3m?.price ? r2(vix3m.price) : null, ratio: vix3m?.price ? r2(vix.price / vix3m.price) : null,
      } : null,
      futures: { ES: chg(es), NQ: chg(nq) },
      events,
    };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (e) {
    console.error("market-pulse error", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
