import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { ProvenRow } from "@/lib/proven/types";

const SUMMARY_COLS = "symbol, status, label, track, sentence, years_valid, years_above, median_spread, archetype, computed_at";
let mapCache: { at: number; m: Map<string, ProvenRow> } | null = null;

/** Proven-Strong summary for every scored company (one paged read, cached 10 min). */
export function useProvenMap(enabled = true) {
  const [map, setMap] = useState<Map<string, ProvenRow>>(() => mapCache?.m ?? new Map());
  useEffect(() => {
    if (!enabled) return;
    if (mapCache && Date.now() - mapCache.at < 600_000) { setMap(mapCache.m); return; }
    let alive = true;
    (async () => {
      const m = new Map<string, ProvenRow>();
      for (let from = 0; ; from += 1000) {
        // the table is newer than the generated DB types, so read it through the untyped client
        const { data, error } = await (supabase as unknown as SupabaseClient)
          .from("proven_strength").select(SUMMARY_COLS).eq("status", "ok").range(from, from + 999) as { data: ProvenRow[] | null; error: unknown };
        if (error || !data) break;
        for (const r of data) m.set(r.symbol.toUpperCase(), r);
        if (data.length < 1000) break;
      }
      mapCache = { at: Date.now(), m };
      if (alive) setMap(m);
    })();
    return () => { alive = false; };
  }, [enabled]);
  return map;
}

/** Full Proven-Strong record for one company — computed on demand if it isn't stored yet. */
export function useProvenOne(symbol: string | null, version = "") {
  const [row, setRow] = useState<ProvenRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!symbol) { setRow(null); return; }
    let alive = true;
    setLoading(true); setRow(null); setError(null);
    supabase.functions.invoke("proven-strength", { body: { symbol } })
      .then(({ data, error }) => { if (!alive) return; if (error || data?.error) { setError("Track record could not be loaded."); return; } setRow(data as ProvenRow); })
      .catch(() => { if (alive) setError("Track record could not be loaded."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, version, attempt]);
  return { row, loading, error, retry: () => setAttempt(x => x + 1) };
}
