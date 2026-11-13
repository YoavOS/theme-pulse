import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Explanation, LensPayload } from "@/lib/lens/types";

/** Loads the Fundamentals Lens payload for a symbol (cached server-side for 12h). */
export function useFundamentalsLens(symbol: string | null) {
  const [data, setData] = useState<LensPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (sym: string, refresh = false) => {
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const { data: d, error: e } = await supabase.functions.invoke("fundamentals-lens", { body: { symbol: sym, refresh } });
      if (id !== reqId.current) return;
      if (e) throw e;
      if (d?.error) throw new Error(d.error);
      setData(d as LensPayload);
    } catch (err) {
      if (id !== reqId.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : "Couldn't load fundamentals");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { if (symbol) void load(symbol); else { setData(null); setError(null); } }, [symbol, load]);
  return { data, loading, error, refresh: () => symbol && load(symbol, true) };
}

const explainCache = new Map<string, Explanation>();

/** Grounded explanation for one concept card ("story" = the whole company), loaded on demand. */
export function useLensExplanation(symbol: string, conceptId: string) {
  const key = `${symbol}:${conceptId}`;
  const [exp, setExp] = useState<Explanation | null>(() => explainCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setExp(explainCache.get(key) ?? null); }, [key]);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("fundamentals-lens", { body: { action: "explain", symbol, conceptId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      explainCache.set(key, data as Explanation);
      setExp(data as Explanation);
    } catch (e) {
      setExp({ sentences: [], missing: [], source: "template", error: e instanceof Error ? e.message : "Couldn't get an explanation" });
    } finally { setLoading(false); }
  }, [symbol, conceptId, key]);
  return { exp, loading, run };
}
