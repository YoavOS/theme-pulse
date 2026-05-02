import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CuratedTheme {
  id: string;
  name: string;
  symbols: string[]; // upper-case
}

export function useCuratedThemes() {
  const [themes, setThemes] = useState<CuratedTheme[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [themesRes, tickersRes] = await Promise.all([
        supabase.from("themes").select("id, name"),
        supabase.from("theme_tickers").select("theme_id, ticker_symbol"),
      ]);
      const tickersByTheme = new Map<string, string[]>();
      for (const r of tickersRes.data ?? []) {
        const arr = tickersByTheme.get(r.theme_id) ?? [];
        arr.push(String(r.ticker_symbol).toUpperCase());
        tickersByTheme.set(r.theme_id, arr);
      }
      const out: CuratedTheme[] = (themesRes.data ?? []).map(t => ({
        id: t.id,
        name: t.name,
        symbols: tickersByTheme.get(t.id) ?? [],
      }));
      out.sort((a, b) => a.name.localeCompare(b.name));
      setThemes(out);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { themes, loading, reload };
}
