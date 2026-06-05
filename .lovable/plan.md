## Goal
Strip the app down to its core momentum tools and reduce DB load by removing tabs, history persistence, and view modes that the user no longer wants.

## Features to Remove (UI + routes + components + hooks)

1. **Watchlist** — delete `src/pages/Watchlist.tsx`, `src/components/AddThemeModal.tsx`, `src/hooks/useWatchlistContext.tsx`, remove `WatchlistProvider` from `App.tsx`, remove `/watchlist` route, drop the pin/bell UI from `ThemeCard` and `Index.tsx`.
2. **Alerts** — delete `src/pages/AlertCenter.tsx`, `src/hooks/useAlertHistory.ts`, `src/hooks/useBreadthAlerts.ts`, `src/hooks/useUnreadAlertCount.ts`, remove `/alerts` route and nav entry.
3. **EOD Scan / EOD Routine / EOD History** — delete `src/pages/EodHistory.tsx`, `src/components/EodRoutineButton.tsx`, `src/hooks/useEodRoutine.ts`, `useEodSave.ts`, `useEodPerformance.ts`, `useEodChartData.ts`, `useSaveEodFromScan.ts`, edge function `save-eod`, remove `/eod-history` route and any EOD buttons in `Index.tsx` / `ThemeIntelligence`.
4. **Enhanced view toggle** — remove `enhancedView` state + toggle from `Index.tsx` (and any branches it gates).
5. **Dispersion metric** — remove the top header pill and `useDispersion` hook usage.
6. **Light Mode** — delete `src/components/ThemeToggle.tsx`, remove it from `App.tsx`, hard-set dark theme in `index.html` / `index.css`.
7. **Bar chart & card grid views** — remove `BarChartView` and the `"cards"` dashboard view; default to `"heatmap"`. Delete `BarChartView.tsx` and unused `ThemeCard.tsx` if no longer referenced. Keep heatmap, plus list/bubble if still desired — confirming below.

## Data Storage Changes

1. **No prior universes saved** — `process-universe-queue` already does an atomic swap into `qualified_stocks`. Add a step that truncates the prior snapshot table(s) and deletes `rs_scan_progress` rows once a scan completes. Drop any "previous universe" persistence.
2. **No background theme performance storage** — stop writing to `theme_performance` / `ticker_performance` outside of an explicit user-initiated scan. Remove cron-like calls and EOD writes. Theme RS/volume becomes session-only (in-memory from `useLiveThemeData` / `useFullScan`).
3. **Drop unused tables** via migration: `eod_snapshots`, `eod_routine_runs`, `alert_history`, `breadth_alerts`, `watchlist_*`, `theme_performance_history`, and any "previous_universe" tables. (Final list will be confirmed against the live schema before the migration runs — destructive, requires approval.)

## Files / Routes Summary

```text
DELETE pages:        Watchlist, AlertCenter, EodHistory
DELETE components:   ThemeToggle, EodRoutineButton, AddThemeModal, BarChartView,
                     (likely) ThemeCard if unused after Index cleanup
DELETE hooks:        useWatchlistContext, useAlertHistory, useBreadthAlerts,
                     useUnreadAlertCount, useEodRoutine, useEodSave,
                     useEodPerformance, useEodChartData, useSaveEodFromScan,
                     useDispersion
DELETE edge fns:     save-eod  (keep RS scan + intelligence fns)
EDIT:                App.tsx, Index.tsx, ThemeIntelligence.tsx, index.html, index.css,
                     useFullScan.ts, useRsAlpha.ts, process-universe-queue,
                     seed-universe-queue
MIGRATION:           DROP TABLE for EOD/alerts/watchlist/history tables
```

## Confirmations Needed

1. **Bubble + List views** — you said "keep only the current heatmap/grid view". Should I also remove the **Bubble** and **Ranked List** dashboard views, leaving only Heatmap? (I'll remove both unless you say otherwise.)
2. **ThemeCard** — used by Watchlist and the "cards" view. After removing both, OK to delete it entirely?
3. **Destructive DB drop** — OK to permanently drop the EOD/alerts/watchlist/historical tables in a migration? Data is unrecoverable after.
4. **News + AI panels** — keep as-is (they're session-fetched, not historical), correct?

Once you confirm, I'll execute in this order: (1) frontend removals, (2) edge function cleanup, (3) destructive migration.
