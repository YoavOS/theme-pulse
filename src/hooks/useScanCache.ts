import { ThemeData } from "@/data/themeData";

// Lightweight local-only scan cache.
// No Supabase persistence — we deliberately do NOT save theme/RS performance
// in the background. Data exists only for the current session + a 24h
// localStorage fallback so a reload doesn't clear the dashboard.

const LOCAL_CACHE_KEY = "last_scan_data";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedScan {
  themes: ThemeData[];
  scannedAt: string;
  timeframe: string;
  symbolsFetched: number;
}

export function saveLocalScanCache(data: CachedScan) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
  } catch {}
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

export async function saveScanCache(
  themes: ThemeData[],
  timeframe: string,
  symbolsFetched: number,
) {
  saveLocalScanCache({
    themes,
    scannedAt: new Date().toISOString(),
    timeframe,
    symbolsFetched,
  });
}

export async function loadScanCache(): Promise<(CachedScan & { isStale: boolean }) | null> {
  const local = loadLocalScanCache();
  if (!local) return null;
  const age = Date.now() - new Date(local.scannedAt).getTime();
  return { ...local, isStale: age > CACHE_MAX_AGE_MS };
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
