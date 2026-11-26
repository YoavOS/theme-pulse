export const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export async function lensMarketFallback(symbol: string, needs: { price: boolean; cap: boolean; multiples: boolean }) {
  const key = Deno.env.get("FINNHUB_API_KEY");
  const get = async (path: string, needed: boolean) => {
    if (!key || !needed) return null;
    try {
      const url = new URL("https://finnhub.io/api/v1/" + path);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("token", key);
      if (path === "stock/metric") url.searchParams.set("metric", "all");
      const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (response.ok) return await response.json();
      await response.body?.cancel();
    } catch { /* The existing cache remains available when the provider cannot respond. */ }
    return null;
  };
  const [quote, profile, stats] = await Promise.all([
    get("quote", needs.price), get("stock/profile2", needs.cap), get("stock/metric", needs.multiples),
  ]);
  const pulledAt = new Date().toISOString();
  const hasPrice = positive(quote?.c) && positive(quote?.t) && quote.t * 1000 <= Date.now();
  const metric = stats?.metric;
  const pe = [metric?.peTTM, metric?.peBasicExclExtraTTM].find(positive) ?? null;
  const ps = positive(metric?.psTTM) ? metric.psTTM : null;
  const pb = [metric?.pbQuarterly, metric?.pbAnnual].find(positive) ?? null;
  return {
    price: hasPrice ? quote.c as number : null,
    priceDate: hasPrice ? new Date(quote.t * 1000).toISOString() : null,
    cap: profile?.currency === "USD" && positive(profile?.marketCapitalization) ? profile.marketCapitalization * 1e6 : null,
    capDate: pulledAt,
    pe, ps, pb, multiplesDate: [pe, ps, pb].some(value => value !== null) ? pulledAt : null,
  };
}

