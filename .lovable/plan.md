## Plan: Scanner Profiles + EMA Pullback Metrics (9D / 21D / 9W)

### 1. New edge function: `ema-distances`
Replace/extend the existing `ema9w-distance` function with a unified `ema-distances` function that returns 9D, 21D, and 9W EMA distances in a single call.

- Fetch from Yahoo: `range=6mo&interval=1d` (gives ~125 daily bars — enough for 9D + 21D EMAs, plus enables weekly resampling for 9W EMA).
- Compute:
  - `ema9d` from daily closes
  - `ema21d` from daily closes
  - `ema9w` from weekly-resampled closes (group daily bars by ISO week, take last close of each week)
- Return per symbol: `{ symbol, price, ema9d, ema21d, ema9w, dist9d, dist21d, dist9w }`
- Concurrency 14, max 2500 symbols, deadline 125s, same throttling pattern.
- Keep `ema9w-distance` as a thin wrapper (or deprecate it inside `CustomListAnalyzerModal` by switching to the new function). Since `ema9w-distance` is only consumed by the analyzer modal, we can safely switch the analyzer to the new function and remove the old one — but for safety, leave `ema9w-distance` in place and just add `ema-distances`.

### 2. RS Alpha main lists: 9D / 21D / 9W EMA columns + sorting
In `src/pages/RsAlpha.tsx`:
- Add `emaDistances` state: `Map<string, { dist9d, dist21d, dist9w }>`.
- Add an "EMA distances" loader (button + auto-load like `coilScores`) that posts the active universe symbols to `ema-distances` and stores results.
- Add three new columns to the main list table(s): **To 9D EMA**, **To 21D EMA**, **To 9W EMA**.
  - Color: green when |dist| ≤ 2%, neutral otherwise; subtle red if dist < -8% (extended below).
- Add new sort options: "Closest to 9D EMA", "Closest to 21D EMA", "Closest to 9W EMA" (sort by `Math.abs(dist)` ascending; missing values pushed to bottom).

### 3. Custom TradingView List modal (`CustomTradingViewListModal.tsx`)
- Accept new prop: `emaDistances?: Map<string, { dist9d, dist21d, dist9w }>`.
- Add filters for max |distance| to 9D / 21D / 9W EMA (sliders, default off).
- Add sort options: "Closest to 9D EMA", "Closest to 21D EMA", "Closest to 9W EMA".
- Show columns in the preview table.

### 4. Custom List Analyzer modal (`CustomListAnalyzerModal.tsx`)
- Switch internal call from `ema9w-distance` → `ema-distances`.
- Add the same 9D / 21D filters and sort options alongside existing 9W controls.
- Add columns "To 9D EMA" and "To 21D EMA" next to existing "9W EMA Δ".

### 5. Scanner Profiles ("Saved Setups") in Custom TradingView List modal
A profile is a named bundle of filter + sort settings.

**Storage**: localStorage key `rs_alpha_scanner_profiles_v1` — `Array<{ id, name, isBuiltIn, criteria }>` where `criteria` mirrors the modal's filter/sort state shape.

**Built-in profiles** (always present, can be cloned to user list):
- **Red Day Leaders / Market Defiers**: `minRsRating: 75`, `minRelStrengthVsQqq: 0` (today's stock %change minus QQQ %change ≥ 0; positive means defying the market), `growthFilter: any`, `sort: rsRating desc`.
- **Coiled Leaders**: `minRsRating: 80`, `coilFilterOn: true`, `maxCoil: 0.70`, `sort: coil asc`.
- **9W EMA Pullbacks**: `minRsRating: 75`, `max9wDist: 3`, `sort: closest9w`.
- **High RS + Tight Range**: `minRsRating: 85`, `coilFilterOn: true`, `maxCoil: 0.80`.

**UI** (top of the modal, above existing filters):
- "Scanner Profiles" section with a dropdown (built-in + user-saved profiles) + Apply button.
- "Save current as profile…" button → prompt for name → persists current settings to localStorage.
- "Manage profiles" small popover: rename / delete user profiles (built-ins are not deletable).

**Relative-strength-vs-QQQ filter (new)**:
- Requires today's QQQ % change. Already loadable from existing live snapshot data — read from a parent prop `qqqPctChange?: number | null` passed by `RsAlpha.tsx` (which already consumes live snapshot via `useLiveSnapshot`).
- For each row, compute `relVsQqq = stockPctChange - qqqPctChange`. Filter `relVsQqq >= minRelStrengthVsQqq`.
- Add sort option: "Strongest vs QQQ".

### Files

**New / edited edge functions**
- `supabase/functions/ema-distances/index.ts` — new, returns 9D + 21D + 9W in one call.
- `supabase/config.toml` — register `[functions.ema-distances]` with `verify_jwt = false`.

**Frontend**
- `src/pages/RsAlpha.tsx` — load EMA distances, pass to children, add columns + sort options to main lists, pass `qqqPctChange` to modals.
- `src/components/rs/CustomTradingViewListModal.tsx` — new EMA filters/sorts/columns, Scanner Profiles section, Rel-vs-QQQ filter & sort.
- `src/components/rs/CustomListAnalyzerModal.tsx` — switch to `ema-distances`, add 9D + 21D filters/sorts/columns.

### Out of scope
- No DB schema changes (profiles live in localStorage; cross-device sync can be a follow-up).
- No changes to existing `ema9w-distance` function (kept for backward compatibility; analyzer switches to new function).

### Verification
1. Deploy `ema-distances`; curl-test it with a 5-symbol payload — confirm `dist9d`, `dist21d`, `dist9w` values are sensible.
2. Open RS Alpha → verify the three new columns render and sorting by "Closest to 9D EMA" works.
3. Open Custom TradingView List → verify Scanner Profiles dropdown shows "Red Day Leaders" and applying it sets RS ≥ 75 + Rel-vs-QQQ ≥ 0.
4. Open Import & Analyze List → confirm 9D / 21D columns show up next to 9W.
