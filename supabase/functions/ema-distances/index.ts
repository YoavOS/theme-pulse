// Computes 9D, 21D (daily) and 9W (weekly) EMA distances from current price.
// Returns one row per symbol with all three distance percentages.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CONCURRENCY = 12;
const MAX_SYMBOLS = 2500;
const DEADLINE_MS = 125_000;

interface Row {
  symbol: string;
  price: number | null;
  ema9d: number | null;
  ema21d: number | null;
  ema9w: number | null;
  dist9d: number | null;   // % distance current price → 9D EMA
  dist21d: number | null;
  dist9w: number | null;
  dailyBars: number;
  weeklyBars: number;
  error?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw || "").toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function computeEma(values: number[], length: number): number | null {
  if (values.length < length) return null;
  const k = 2 / (length + 1);
  let ema = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : null;
}

// Resample daily timestamps + closes into weekly closes (one close per ISO week, last close).
function dailyToWeekly(timestamps: number[], closes: number[]): number[] {
  if (timestamps.length === 0) return [];
  const buckets = new Map<string, number>(); // weekKey → last close in that week
  const order: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
    const d = new Date(timestamps[i] * 1000);
    // Use UTC year + ISO week number as key
    const day = d.getUTCDay() || 7; // 1..7
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
    const key = monday.toISOString().slice(0, 10);
    if (!buckets.has(key)) order.push(key);
    buckets.set(key, c); // keep the last close encountered for the week
  }
  return order.map((k) => buckets.get(k) as number);
}

async function fetchDaily(symbol: string): Promise<{ timestamps: number[]; closes: number[]; last: number | null } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result?.timestamp ?? [];
    const closesRaw: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const meta = result?.meta ?? {};
    const cleanTs: number[] = [];
    const cleanCloses: number[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closesRaw[i];
      if (typeof c === "number" && Number.isFinite(c) && c > 0) {
        cleanTs.push(ts[i]);
        cleanCloses.push(c);
      }
    }
    const last =
      typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : cleanCloses[cleanCloses.length - 1] ?? null;
    return { timestamps: cleanTs, closes: cleanCloses, last };
  } catch {
    return null;
  }
}

function distancePct(price: number | null, ema: number | null): number | null {
  if (price === null || ema === null || ema <= 0) return null;
  return Math.round(((price - ema) / ema) * 10000) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const symbols = sanitizeSymbols((body as { symbols?: unknown })?.symbols);
    if (symbols.length === 0) return jsonResponse({ error: "symbols[] required", rows: [] }, 400);

    const rows = new Map<string, Row>();
    let idx = 0;
    let processed = 0;

    async function worker() {
      while (idx < symbols.length && Date.now() - startedAt < DEADLINE_MS) {
        const symbol = symbols[idx++];
        const data = await fetchDaily(symbol);
        if (!data || data.closes.length < 9) {
          rows.set(symbol, {
            symbol,
            price: data?.last ?? null,
            ema9d: null, ema21d: null, ema9w: null,
            dist9d: null, dist21d: null, dist9w: null,
            dailyBars: data?.closes.length ?? 0,
            weeklyBars: 0,
            error: "insufficient_history",
          });
          continue;
        }

        const ema9d = computeEma(data.closes, 9);
        const ema21d = data.closes.length >= 21 ? computeEma(data.closes, 21) : null;

        const weeklyCloses = dailyToWeekly(data.timestamps, data.closes);
        const ema9w = weeklyCloses.length >= 9 ? computeEma(weeklyCloses, 9) : null;

        const price = data.last ?? data.closes[data.closes.length - 1];

        rows.set(symbol, {
          symbol,
          price: price ? Math.round(price * 1000) / 1000 : null,
          ema9d: ema9d ? Math.round(ema9d * 1000) / 1000 : null,
          ema21d: ema21d ? Math.round(ema21d * 1000) / 1000 : null,
          ema9w: ema9w ? Math.round(ema9w * 1000) / 1000 : null,
          dist9d: distancePct(price, ema9d),
          dist21d: distancePct(price, ema21d),
          dist9w: distancePct(price, ema9w),
          dailyBars: data.closes.length,
          weeklyBars: weeklyCloses.length,
        });
        processed++;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, Math.max(1, symbols.length)) }, () => worker()),
    );

    const out = symbols.map(
      (s) =>
        rows.get(s) ?? {
          symbol: s,
          price: null,
          ema9d: null, ema21d: null, ema9w: null,
          dist9d: null, dist21d: null, dist9w: null,
          dailyBars: 0, weeklyBars: 0,
          error: "not_processed",
        },
    );

    return jsonResponse({
      total: symbols.length,
      processed,
      partial: out.some((r) => r.error === "not_processed"),
      rows: out,
    });
  } catch (e) {
    console.error("ema-distances error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});
