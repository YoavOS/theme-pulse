import { useEffect, useState, useCallback } from "react";
import { loadThemeCatalog } from "@/lib/themeCatalog";

export interface CuratedTheme {
  id: string;
  name: string;
  symbols: string[]; // upper-case
}

export function useCuratedThemes() {
  const [themes, setThemes] = useState<CuratedTheme[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (force = false) => {
    setLoading(true);
    try {
      // One shared copy for every screen and modal (see lib/themeCatalog).
      const { themes: themeRows, tickers } = await loadThemeCatalog(force);
      const tickersByTheme = new Map<string, string[]>();
      for (const r of tickers) {
        const arr = tickersByTheme.get(r.theme_id) ?? [];
        arr.push(String(r.ticker_symbol).toUpperCase());
        tickersByTheme.set(r.theme_id, arr);
      }
      const out: CuratedTheme[] = themeRows.map(t => ({
        id: t.id,
        name: t.name,
        symbols: tickersByTheme.get(t.id) ?? [],
      }));
      out.sort((a, b) => a.name.localeCompare(b.name));
      setThemes(out);
    } catch {
      /* keep the previous list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { themes, loading, reload };
}
