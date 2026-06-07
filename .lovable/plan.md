## Goal

Add **"RS New High Before Price"** as a leading-indicator filter (no need for a column) in RS Alpha, with zero new cached history (reuse the 6mo bars already in `yahoo_history_cache`).

## What gets detected

For each qualified stock, build the **RS line** = `stock_close / SPY_close` per trading day from the existing 6mo OHLC cache, then evaluate two windows:

- **Short window — 20 trading days** (always available from 6mo data)
- **Long window — 6 months** (full cached series, used as the "52-week-style" proxy; true 52w would require doubling cache to 1y and is **not** worth the storage cost — noted as a future opt-in)

A row qualifies as **RS NH Before Price** when, in the chosen window:

- RS line's max occurs on (or within the last few bars of) the most recent bar, **AND**
- Price's max does **not** occur in that same recent slice.

We also store `**rs_nh_days_ago**` = trading days between today's bar and the bar that set the RS-line max.

## Storage-sensitive design (the important part)

- **No new tables, no new cache rows.** All inputs come from `yahoo_history_cache` (6mo) which the universe scan already populates.
- **4 tiny columns** added to `qualified_rs_universe` (+ staging twin). All `smallint` / `boolean` — well under 10 bytes per row → ~30 KB total for the whole universe.
  - `rs_nh_20d` boolean
  - `rs_nh_20d_days_ago` smallint
  - `rs_nh_6m` boolean
  - `rs_nh_6m_days_ago` smallint
- Computed **inline inside `calculate-rs-scores**` (already loads each symbol's 6mo bars + SPY's 6mo bars). Zero extra Yahoo calls, zero extra cache writes.
- Benchmark is **SPY only** for v1 (matches existing RS pipeline). QQQ toggle deferred — would require caching QQQ history; out of scope to keep storage flat.

## UI changes (RS Alpha tab)

- New compact column **"RS NH"** in the main RS Alpha table.
  - If `rs_nh_20d && !price_nh_20d` → green badge `RS NH +Nd` (N = `rs_nh_20d_days_ago`).
  - If only `rs_nh_6m && !price_nh_6m` → softer outline badge `RS NH 6M +Nd`.
  - Otherwise blank.
- New **filter chip** in the existing RS Alpha filter row: *"RS New High Before Price"* with two sub-options (20D / 6M). Multi-selectable, integrates with the current filter state.
- Sortable: click header sorts by `rs_nh_20d_days_ago` ascending (freshest signals first).
- Tooltip on the column header explains the meaning in one line.

## Files touched

1. **Migration** — add 4 columns to `qualified_rs_universe` + `qualified_rs_universe_staging`; update `swap_qualified_rs_universe()` to copy them.
2. `**supabase/functions/calculate-rs-scores/index.ts**` — after loading 6mo bars (already done), compute the 4 values per symbol from in-memory OHLC + SPY OHLC and include them in the upsert. No extra fetches.
3. `**src/hooks/useRsAlpha.ts**` — extend `RsStock` with the 4 fields, map from row.
4. `**src/pages/RsAlpha.tsx**` — new column, badge, filter chip, sort handler.
5. `**src/integrations/supabase/types.ts**` — auto-regenerates after migration.

## Why this is the cheapest possible version

- Reuses the cache trim already done in the previous task (6mo-only rows).
- All math runs during the existing RS recalc loop — no new edge function, no new cron, no new table.
- 4 numeric/boolean columns on ~2–3k rows ≈ negligible (< 50 KB).
- If you ever want true 52-week, the only added cost would be switching SPY (one symbol) to a `1y` cached row; individual stocks could keep 6mo because most names that matter won't have 52w highs that 6mo misses for this signal.

## Out of scope (can add later, flagged in code comments)

- QQQ benchmark toggle.
- True 52-week window (needs 1y SPY cache row).
- Historical chart of the RS line in the drilldown.