import { lazy, type ComponentType } from "react";

const KEY = "chunk_reload_at";

/**
 * After each Publish the old page files are deleted. A tab that was open before the Publish
 * (or a cached copy of the app) then fails to download the page you open, and the whole app
 * turns white. When that happens, reload once to pick up the new version.
 */
export function reloadForNewVersion(): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return false; // already tried: don't loop
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk|error loading dynamically/i.test(msg);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e) => {
      if (isChunkError(e) && reloadForNewVersion()) return new Promise<never>(() => undefined); // page is reloading
      throw e;
    }),
  );
}
