# Plan

Two distinct workstreams. I'll do them in this order so each milestone is independently verifiable.

## Workstream 1 — Custom List Analyzer cleanup + EMA OR/AND logic

### 1.1 Fix `CustomListAnalyzerModal.tsx`
- Migrate fully from `ema9w-distance` → `ema-distances` response shape (`{ dist9d, dist21d, dist9w }`).
- Replace single `ema9wDist` map with `emaDist` map of the new shape.
- Add columns: **To 9D EMA**, **To 21D EMA** (alongside existing 9W column), with same color rules (green ≤2%, red < -8%).
- Add filters: max |dist9d|, max |dist21d| (alongside max |dist9w|).
- Add sort options: "Closest to 9D EMA", "Closest to 21D EMA" (already have 9W).
- Re-verify file upload (.txt + drag-drop) still works after refactor.
- Clear all TS errors.

### 1.2 EMA OR/AND logic
- New piece of state `emaFilterMode: "AND" | "OR"` (default `"OR"`) in:
  - `CustomListAnalyzerModal.tsx`
  - `CustomTradingViewListModal.tsx`
  - `RsAlpha.tsx` (main lists, controlling main-list EMA filters if any are active there — currently sorts only; we'll add the same toggle next to any EMA filter UI).
- Toggle UI: small segmented control labeled "EMA filters: [Match ANY (OR)] [Match ALL (AND)]", visible only when ≥2 EMA distance filters are active.
- Filter evaluation:
  - AND: row must satisfy every active EMA distance filter (current behavior).
  - OR: row passes if it satisfies at least one active EMA distance filter; non-EMA filters still AND'd.
- Built-in **9W EMA Pullbacks** profile remains; add a new built-in profile **"Pullback Buys (9W or 21D)"**: `min RS 75`, `max |9W| ≤ 3`, `max |21D| ≤ 3`, `emaFilterMode: "OR"`, sort "Closest to 9W EMA".

### Files (Workstream 1)
- `src/components/rs/CustomListAnalyzerModal.tsx` — refactor + 9D/21D + OR toggle.
- `src/components/rs/CustomTradingViewListModal.tsx` — OR toggle + new built-in profile.
- `src/pages/RsAlpha.tsx` — pass through, OR toggle for main-list EMA filters if filters exist there.

## Workstream 2 — Market Drivers

### 2.1 Data approach
The app has SPY/QQQ price history (`eod_prices` with `__BENCHMARK__`) but does **not** currently store index constituent weights. To compute "weighted contribution" we need: per-ticker index weight × today's % change.

Approach: new edge function `index-drivers` that:
- Maintains a hard-coded weight table for **QQQ top 50** and **SPY top 50** (sourced from public Invesco/SPDR holdings as of build date) — good enough for "top contributors" view; documented as approximate.
- Fetches today's quotes for those ~100 symbols via Yahoo (`?symbols=...`) in one batched call per index.
- Returns per index: `{ indexPct, indexPoints, rows: [{ symbol, name, weight, pctChange, weightedContribution, cumulative }], top10ContributionPct, breadth: { advancers, decliners } }`.
- Timeframe param: `today | 1w | 1m`. For 1w/1m, pull EOD perf from `eod_prices` for the same symbols.

A follow-up could fetch live weights from an API; out of scope for v1.

### 2.2 New page `MarketDrivers.tsx` at `/market-drivers`
- Top: SPY + QQQ tile (% change, points), concentration score, breadth summary.
- Tabs: **QQQ Drivers** / **SPY Drivers**.
- Table: Rank · Ticker · Name · Weight % · % Change · Weighted Contribution · Cumulative. Sort by weighted contribution desc by default.
- Bar chart (Recharts) — top positive / negative contributors.
- Groq insight box: call existing AI gateway via a small edge function `market-drivers-insight` that takes the rows and returns a one-paragraph commentary. (Use Lovable AI Gateway, model `google/gemini-3-flash-preview`.)
- Simulator: row-level "If X was flat" — pure client math: `indexPct − weight × pctChange`.
- Timeframe selector (Today / 1W / 1M).
- Theme contribution: aggregate weighted contribution by theme using existing theme→ticker mapping.
- Export top contributors → TradingView (reuse existing TV export util).

### 2.3 Live Execution widget
- New component `MarketDriversWidget.tsx` rendered near top of `LiveExecution.tsx`, collapsible.
- Shows: SPY & QQQ % change, top 5 QQQ contributors, "Top 5 explain X%" with color coding (>60% red, 40-60% orange, <40% green).
- Calls same `index-drivers` edge function with `index=QQQ&timeframe=today`.
- Button "Open Full Market Drivers" → `navigate('/market-drivers')`.

### 2.4 Navigation
- Add `/market-drivers` route in `App.tsx`.
- Add nav link in main navigation (wherever other top-level tabs live — likely `Index.tsx` header or `NavLink.tsx` consumers).

### Files (Workstream 2)
- **New** `supabase/functions/index-drivers/index.ts`
- **New** `supabase/functions/market-drivers-insight/index.ts`
- **New** `src/pages/MarketDrivers.tsx`
- **New** `src/components/live/MarketDriversWidget.tsx`
- **Edit** `src/App.tsx` (route)
- **Edit** `src/pages/LiveExecution.tsx` (mount widget)
- **Edit** main nav (TBD which file — will inspect)
- **Edit** `supabase/config.toml` (register new functions)

## Out of scope
- Live (sub-daily) index constituent weight refresh — using a maintained static weight table for v1.
- Bottom-50 constituents of SPY/QQQ — top 50 each is sufficient for "drivers".
- Weight table admin UI.

## Verification
1. Analyzer modal: upload a TradingView .txt, see 9D/21D/9W columns, toggle OR mode with 9W ≤ 3 and 21D ≤ 3 active, verify row count expands vs AND.
2. RS Alpha main list: same OR toggle visible when ≥2 EMA filters are active.
3. `/market-drivers`: QQQ tab loads with top contributors and concentration score; flipping NVDA % to 0 in simulator updates the projected QQQ %.
4. Live Execution: widget visible at top, "Open Full Market Drivers" navigates to the new tab.
