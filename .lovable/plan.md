## Yes — the Yahoo cache can be cut by ~60–70%

Current state: `yahoo_history_cache` holds 6,812 rows / ~27 MB. The breakdown explains why:

| Period | Rows  | OHLC payload |
|--------|-------|--------------|
| 6mo    | 1,583 | 7.1 MB       |
| 3mo    | 1,583 | 3.9 MB       |
| ytd    |   481 | 1.9 MB       |
| 1mo    | 1,583 | 1.7 MB       |
| 5d     | 1,582 | 1.3 MB       |

Every ticker is stored 4–5 times — once per period — even though `6mo` already contains every bar `3mo`, `1mo`, `5d`, and `ytd` need. We can derive the shorter periods from the longest one and drop the duplicates.

## Plan

### 1. Make the cache "longest-period-wins"
- Update `_shared/yahooHistory.ts` so reads for `5d` / `1mo` / `3mo` / `ytd` first check whether a `6mo` row exists for that symbol and slice the OHLC array in memory. Only fall back to a Yahoo network fetch (and a fresh `6mo` insert) if nothing is cached.
- Writes stop creating per-period rows. We persist a single `6mo` row per symbol; `start_price`/`end_price`/`return_pct` for shorter periods are computed on the fly.

### 2. One-shot cleanup migration
- Delete every row where `period <> '6mo'`. Frees ~9 MB immediately.
- Delete `6mo` rows older than 14 days (`fetched_at < now() - interval '14 days'`) — stale snapshots that will be re-fetched on demand.
- Delete rows for symbols not in `theme_tickers` and not equal to `SPY` — orphans from old universes.

### 3. Storage Manager: dedicated Yahoo controls
- Add two buttons on the `yahoo_history_cache` card:
  - **Trim duplicates** — runs a SECURITY DEFINER RPC `trim_yahoo_cache()` that performs the three deletes above and returns `{ removed_rows, freed_bytes }`.
  - **Clear all** — already exists; keep it.
- Show a small inline breakdown (rows per period) under the card so it's obvious where the size comes from.

### 4. Optional, low-risk: shrink the OHLC JSON shape
- Today each bar is `{ ts, open, high, low, close, volume }`. For return/perf math we only read `ts` + `close`. A follow-up could store `{t,c}` only and cut another ~50% off the remaining payload. Out of scope for this pass unless you want it included.

## Expected result
- Cache drops from ~27 MB → ~7 MB right after the trim.
- Steady-state size stays bounded because new fetches only insert `6mo` rows and old ones expire after 14 days.
- Free-tier capacity bar drops from ~6% to ~2% used.

## Technical details
- Files: `supabase/functions/_shared/yahooHistory.ts`, `src/pages/StorageManager.tsx`, new migration adding `trim_yahoo_cache()` RPC (granted to `authenticated` + `service_role`).
- No schema changes to `yahoo_history_cache` — just data deletes and a new RPC.
- Edge functions that call `getHistoricalData(sb, symbol, period, ...)` keep the same signature; the slicing happens inside the helper so callers are unchanged.