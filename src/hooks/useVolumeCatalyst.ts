import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface VolumeCatalystResult {
  catalyst: string;
  reason: string;
  generatedAt: string;
}

const CACHE_PREFIX = "volCatalyst:v1:";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface Stored {
  result: VolumeCatalystResult;
  fetchedAt: number;
}

function readCache(themeId: string): VolumeCatalystResult | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + themeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed.result;
  } catch { return null; }
}
function writeCache(themeId: string, result: VolumeCatalystResult) {
  try {
    localStorage.setItem(CACHE_PREFIX + themeId, JSON.stringify({ result, fetchedAt: Date.now() } satisfies Stored));
  } catch { /* quota */ }
}

interface Params {
  enabled: boolean;
  themeId: string | null;
  themeName: string | null;
  symbols: string[];
  avgPerf1d?: number | null;
  avgRelVol?: number | null;
  sustained?: number | null;
  trendPct?: number | null;
}

export function useVolumeCatalyst(p: Params) {
  const [data, setData] = useState<VolumeCatalystResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (!p.themeId || !p.themeName || p.symbols.length === 0) return;
    if (!force) {
      const cached = readCache(p.themeId);
      if (cached) { setData(cached); return; }
    }
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: invErr } = await supabase.functions.invoke("volume-catalyst", {
        body: {
          themeId: p.themeId,
          themeName: p.themeName,
          symbols: p.symbols.slice(0, 15),
          avgPerf1d: p.avgPerf1d ?? null,
          avgRelVol: p.avgRelVol ?? null,
          sustained: p.sustained ?? null,
          trendPct: p.trendPct ?? null,
        },
      });
      if (invErr) throw new Error(invErr.message);
      if (res?.error) throw new Error(res.error);
      const out: VolumeCatalystResult = {
        catalyst: res.catalyst,
        reason: res.reason || "",
        generatedAt: res.generatedAt || new Date().toISOString(),
      };
      writeCache(p.themeId, out);
      setData(out);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.themeId, p.themeName, p.symbols.join(","), p.avgPerf1d, p.avgRelVol, p.sustained, p.trendPct]);

  useEffect(() => {
    if (!p.enabled || !p.themeId) { setData(null); return; }
    const cached = readCache(p.themeId);
    if (cached) { setData(cached); return; }
    refresh(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.enabled, p.themeId]);

  return { data, loading, error, refresh };
}
