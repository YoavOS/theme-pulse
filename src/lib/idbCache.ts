/**
 * Tiny key → value cache in IndexedDB, for big data sets (stage and base rows).
 *
 * Why not localStorage: it is capped at ~5 million characters per site (shared by every
 * cache in the app), it stores strings only (so every read re-parses megabytes of JSON),
 * and reads block the page. IndexedDB has room for far more, stores objects directly and
 * is asynchronous. Every call fails soft: no IndexedDB (private window, blocked storage)
 * just means no cache.
 */
const DB_NAME = "theme-pulse-cache";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb()
    .then((db) => new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    }))
    .catch(() => undefined);
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return run("readwrite", (s) => s.put(value, key)).then(() => undefined);
}

export function idbDel(key: string): Promise<void> {
  return run("readwrite", (s) => s.delete(key)).then(() => undefined);
}
