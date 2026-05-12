// Computes 9-week EMA from weekly closes and the % distance of the latest price to that EMA.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CONCURRENCY = 14;
const MAX_SYMBOLS = 2500;
const DEADLINE_MS = 125_000;
const EMA_LEN = 9;

interface Row {
  symbol: string;
  ema9w: number | null;
  price: number | null;
  distancePct: number | null;
  weeklyCloses: number;
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
  // Seed with SMA of first `length` values.
  let ema = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? ema : null;
}

async function fetchWeeklyCloses(symbol: string): Promise<{ closes: number[]; last: number | null } | null> {
  // 1y of weekly bars is plenty for a 9-week EMA.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1wk&includePrePost=false`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const closesRaw: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const meta = result?.meta ?? {};
    const closes = closesRaw.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    const last =
      typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : closes[closes.length - 1] ?? null;
    return { closes, last };
  } catch {
    return null;
  }
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
        const data = await fetchWeeklyCloses(symbol);
        if (!data || data.closes.length < EMA_LEN) {
          rows.set(symbol, {
            symbol,
            ema9w: null,
            price: data?.last ?? null,
            distancePct: null,
            weeklyCloses: data?.closes.length ?? 0,
            error: "insufficient_history",
          });
          continue;
        }
        // Use only completed closes for EMA seed; include current week close (last bar).
        const ema = computeEma(data.closes, EMA_LEN);
        const price = data.last ?? data.closes[data.closes.length - 1];
        const distancePct = ema && price ? Math.round(((price - ema) / ema) * 10000) / 100 : null;
        rows.set(symbol, {
          symbol,
          ema9w: ema ? Math.round(ema * 1000) / 1000 : null,
          price: price ? Math.round(price * 1000) / 1000 : null,
          distancePct,
          weeklyCloses: data.closes.length,
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
          ema9w: null,
          price: null,
          distancePct: null,
          weeklyCloses: 0,
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
    console.error("ema9w-distance error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e), rows: [] }, 500);
  }
});
