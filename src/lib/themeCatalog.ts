/**
 * The theme list (themes + their tickers), loaded once and shared.
 *
 * Before this, every screen and every modal (even closed ones) fetched both tables itself:
 * opening RS Alpha made the same two requests five times. One copy now serves everyone for
 * a few minutes; editing themes in Admin clears it.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ThemeRow { id: string; name: string; description: string | null }
export interface ThemeTickerRow { theme_id: string; ticker_symbol: string }
export interface ThemeCatalog { themes: ThemeRow[]; tickers: ThemeTickerRow[] }

const TTL = 3 * 60_000;
let cache: { at: number; data: ThemeCatalog } | null = null;
let inflight: Promise<ThemeCatalog> | null = null;

async function fetchCatalog(): Promise<ThemeCatalog> {
  const [themesRes, tickers] = await Promise.all([
    supabase.from("themes").select("id, name, description"),
    (async () => {
      // Paged: the API returns at most 1,000 rows per request.
      const out: ThemeTickerRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol").range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as ThemeTickerRow[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);
  if (themesRes.error) throw themesRes.error;
  return { themes: (themesRes.data ?? []) as ThemeRow[], tickers };
}

export function loadThemeCatalog(force = false): Promise<ThemeCatalog> {
  if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = fetchCatalog()
    .then((data) => { cache = { at: Date.now(), data }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Call after adding, renaming or deleting themes or tickers. */
export function invalidateThemeCatalog() { cache = null; }
