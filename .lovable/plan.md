## Part 1 — Speed up scans (cache-first + parallel refresh)

**Pattern:** Every scan-bound hook (Theme Performance, Full Scan / Dashboard, Volume, Theme Intelligence) will:
1. On mount, **instantly hydrate** from the most recent DB snapshot (`ticker_performance`, `themes`/`theme_tickers`, `ticker_volume_cache`, `yahoo_history_cache`) — no spinner, data on screen in <500ms.
2. Show a small "Refreshing…" pill in the header.
3. Kick off a background refresh that fans out **25 concurrent Yahoo requests** (instead of sequential 1100ms-delayed Finnhub loop). Finnhub stays as fallback only.
4. When refresh resolves, swap the cached snapshot for fresh data and update the "Last updated" timestamp.

**Edge function changes:**
- `full-scan`: replace the sequential ticker loop with `Promise.all` batches of 25, Yahoo-first (already added), Finnhub fallback only on Yahoo failure. Skip tickers whose `ticker_performance.last_scanned` is <15 min old unless `?force=true`.
- `fetch-themes`: same parallelization — batch theme tickers in groups of 25, Yahoo-first. Add `?maxAgeMinutes=15` short-circuit that returns cached `themes` rows if fresh.
- `useFullScan`, `useThemeIntelligence`, `useVolumeData`, `useLiveThemeData`: read cached rows immediately, then call edge function with `force=false` by default; a "Force refresh" toggle in the Storage tab can force re-fetch.

**Expected result:** Theme/Dashboard scans feel as instant as RS Scores on warm cache, and full cold refresh drops from ~5–10 min to ~30–60s thanks to 25× parallelism.

## Part 2 — Storage Manager tab

**Route:** new top-level nav entry `/storage` → `src/pages/StorageManager.tsx`, added to `App.tsx` routes and to the nav bar (alongside RS Alpha, Intelligence, etc.).

**Layout:** one accordion section per app area. Each section header shows total row count + total size. Inside, one card per backing table:

```text
RS Alpha
├─ qualified_rs_universe           1,446 rows · Updated 2h ago · Medium
├─ qualified_rs_universe_staging       0 rows · empty           · Small
├─ stock_scan_queue                1,446 rows · Updated 2h ago · Medium
├─ rs_scan_progress                    1 row  · Updated 2h ago · Small
└─ stock_fundamentals              1,220 rows · Updated 1d ago · Large  ⚠
   [Clear cache] [Re-scan]

Theme Intelligence
├─ themes / theme_tickers
├─ ticker_performance
├─ ticker_volume_cache
└─ theme news cache (yahoo_history_cache filtered)

Live Execution / Market Drivers / Morning Brief / Earnings
└─ fundamentals_cache, stock drivers cache, etc.
```

**Per-card data shown:**
- Table label + plain-English description ("Cached theme performance snapshots")
- Row count (from `count(*)`)
- Last updated (max `updated_at` / `last_scanned`)
- Size badge: Small (<100 rows), Medium (<5k), Large (≥5k)
- Warning icon when row count or staleness crosses a threshold
- Action buttons with simple confirm dialog:
  - **Clear cache** (truncates that table; staging tables only — never touches live `qualified_rs_universe` without typed confirm)
  - **Re-scan** (deep-links to the page where the scan lives)

**Global action bar (top of page):**
- Clear Old Universes — wipes `qualified_rs_universe_staging` + old `stock_scan_queue` rows
- Clear News & Temporary Data — wipes news caches
- Clear All Yahoo Cache — truncates `yahoo_history_cache`
- **Full Memory Reset** — typed confirmation ("type RESET") that wipes all caches but keeps live universe + fundamentals

**Backend:** one new edge function `storage-stats` returning `{ table, rowCount, lastUpdated, sizeBytes }` for the curated table list (uses `pg_total_relation_size` + `count(*)`). One new edge function `storage-clear` that accepts `{ table }` and runs the corresponding `TRUNCATE` via SECURITY DEFINER RPCs (one RPC per allowed table, no dynamic SQL). All clear RPCs require an authenticated user.

## Files touched

**New:**
- `src/pages/StorageManager.tsx`
- `src/hooks/useStorageStats.ts`
- `supabase/functions/storage-stats/index.ts`
- `supabase/functions/storage-clear/index.ts`
- Migration: SECURITY DEFINER `truncate_*` RPCs for each clearable table

**Edited:**
- `src/App.tsx` (route)
- `src/components/NavLink.tsx` or wherever the top nav lives (add link)
- `supabase/functions/full-scan/index.ts` (parallel batches + 15-min cache short-circuit)
- `supabase/functions/fetch-themes/index.ts` (parallel batches + cache short-circuit)
- `src/hooks/useFullScan.ts`, `useThemeIntelligence.ts`, `useVolumeData.ts`, `useLiveThemeData.ts` (cache-first hydration + background refresh)

## Out of scope

- Re-architecting the EOD pipeline
- Adding paid Yahoo/Finnhub tiers
- Per-user storage quotas
