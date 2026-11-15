/**
 * Sleep mode — saves Cloud usage. After a few minutes without any input (mouse, keys, touch,
 * scroll), or while the tab is hidden, the app "sleeps": every automatic refresh checks
 * `isAwake()` and skips, so nothing reaches the backend and the database can go idle.
 * Any input wakes it; listeners registered with `onWake` then refresh what's stale.
 *
 * The delay is per browser (localStorage "app_sleep_minutes"; 0 = never sleep). Default 10 min.
 */

const KEY = "app_sleep_minutes";
export const SLEEP_CHOICES = [5, 10, 15, 30, 0] as const;

export function sleepMinutes(): number {
  try { const v = Number(localStorage.getItem(KEY)); return Number.isFinite(v) && v >= 0 && localStorage.getItem(KEY) !== null ? v : 10; } catch { return 10; }
}
export function setSleepMinutes(m: number) {
  try { localStorage.setItem(KEY, String(m)); } catch { /* ignore */ }
  lastActive = Date.now();
  if (asleep) wake();
  emit();
}

let lastActive = Date.now();
let asleep = false;
let started = false;
const listeners = new Set<() => void>();
const wakeListeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function wake() {
  if (!asleep) return;
  asleep = false;
  emit();
  wakeListeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
}

function onActivity() {
  lastActive = Date.now();
  if (asleep && document.visibilityState === "visible") wake();
}

function check() {
  const m = sleepMinutes();
  if (!m) { if (asleep) wake(); return; }
  if (!asleep && Date.now() - lastActive >= m * 60_000) { asleep = true; emit(); }
}

/** Start watching for activity (idempotent; called once from App). */
export function startSleepWatch() {
  if (started || typeof window === "undefined") return;
  started = true;
  let lastMove = 0;
  const move = () => { const t = Date.now(); if (t - lastMove > 5_000) { lastMove = t; onActivity(); } };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"] as const) window.addEventListener(ev, onActivity, { passive: true });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("focus", onActivity);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onActivity(); });
  window.setInterval(check, 15_000);
}

/** True while someone is using the app and the tab is visible — gate every automatic refresh on it. */
export function isAwake(): boolean {
  return !asleep && (typeof document === "undefined" || document.visibilityState === "visible");
}
export function isAsleep() { return asleep; }

/** Subscribe to sleep/wake changes (for the overlay). Returns an unsubscribe function. */
export function subscribeSleep(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
/** Run `f` when the app wakes from sleep (e.g. refresh data that went stale). */
export function onWake(f: () => void) { wakeListeners.add(f); return () => { wakeListeners.delete(f); }; }
