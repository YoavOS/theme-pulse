import { supabase } from "@/integrations/supabase/client";
import { ThemeData } from "@/data/themeData";

const LOCAL_CACHE_KEY = "last_scan_data";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedScan {
  themes: ThemeData[];
  scannedAt: string;
  timeframe: string;
  symbolsFetched: number;
}

// ── localStorage (instant fallback) ──

export function saveLocalScanCache(data: CachedScan) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

export function loadLocalScanCache(): CachedScan | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedScan;
  } catch {
    return null;
  }
}

export function clearLocalScanCache() {
  localStorage.removeItem(LOCAL_CACHE_KEY);
}

// ── Supabase (durable, survives tab suspension) ──

export async function saveSupabaseScanCache(data: CachedScan): Promise<void> {
  try {
    await supabase.from("last_scan_cache").upsert({
      id: 1,
      themes_data: data.themes as any,
      scanned_at: data.scannedAt,
      timeframe: data.timeframe,
      symbols_fetched: data.symbolsFetched,
    });
  } catch (e) {
    console.error("Failed to save scan cache to Supabase:", e);
  }
}

export async function loadSupabaseScanCache(): Promise<CachedScan | null> {
  try {
    const { data, error } = await supabase
      .from("last_scan_cache")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !data || !data.themes_data) return null;

    // Type assertion: themes_data is stored as JSONB
    const themes = data.themes_data as unknown as ThemeData[];
    if (!Array.isArray(themes) || themes.length === 0) return null;

    return {
      themes,
      scannedAt: data.scanned_at,
      timeframe: data.timeframe,
      symbolsFetched: data.symbols_fetched ?? 0,
    };
  } catch (e) {
    console.error("Failed to load scan cache from Supabase:", e);
    return null;
  }
}

// ── Unified save (both layers) ──

export async function saveScanCache(themes: ThemeData[], timeframe: string, symbolsFetched: number) {
  const data: CachedScan = {
    themes,
    scannedAt: new Date().toISOString(),
    timeframe,
    symbolsFetched,
  };
  saveLocalScanCache(data);
  await saveSupabaseScanCache(data);
}

// ── Unified load: localStorage first, then Supabase ──

export async function loadScanCache(): Promise<(CachedScan & { isStale: boolean }) | null> {
  // Try localStorage first (instant)
  const local = loadLocalScanCache();
  if (local) {
    const age = Date.now() - new Date(local.scannedAt).getTime();
    return { ...local, isStale: age > CACHE_MAX_AGE_MS };
  }

  // Fallback to Supabase (survives tab suspension / browser restart)
  const remote = await loadSupabaseScanCache();
  if (remote) {
    // Repopulate localStorage for next time
    saveLocalScanCache(remote);
    const age = Date.now() - new Date(remote.scannedAt).getTime();
    return { ...remote, isStale: age > CACHE_MAX_AGE_MS };
  }

  return null;
}

export function getCacheAge(scannedAt: string): string {
  const ms = Date.now() - new Date(scannedAt).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "less than an hour ago";
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
