/**
 * Keeps an in-memory cache from growing without limit inside a warm edge function.
 * A Map keeps insertion order, so the first keys are the oldest: drop those first.
 * (A scan of 1,500 stocks through one warm instance used to keep every payload.)
 */
// deno-lint-ignore no-explicit-any
export function capMap(m: Map<any, any>, max: number): void {
  if (m.size <= max) return;
  let extra = m.size - max;
  for (const k of m.keys()) {
    m.delete(k);
    if (--extra <= 0) break;
  }
}
