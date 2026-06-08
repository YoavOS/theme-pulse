# Setup Analyzer (RS Alpha)

A new ad-hoc tool inside the RS Alpha tab. The user pastes a list of tickers they have setups on, and it returns a ranked table — strongest setups at the top — so they focus on names inside leading themes with confirming RS, fresh RS new highs, and active catalysts.

**Zero new storage.** Pure on-demand computation, reuses data already cached for other features. No new tables, no new cron, no new rows persisted.

---

## UI

New button in RS Alpha header: **"Analyze Setup List"** → opens modal.

**Modal**
- Textarea: paste tickers (comma / newline / space separated, ~up to 100).
- "Analyze" button → runs entirely client-side against already-loaded data; AI catalyst step calls one edge function.
- Results table sorted by composite score desc:

| Rank | Ticker | Score | Theme | Theme RS | Stock RS | RS NH | Catalyst | Notes |
|------|--------|-------|-------|----------|----------|-------|----------|-------|

- Each sub-score is a small bar/chip so the user sees *why* it ranked where it did.
- Tickers not in the qualified universe → shown in a separate "Not qualified" section (with reason: below filter / no data) so nothing is silently dropped.
- Export button: copy ranked list to clipboard.

---

## Composite Score (0–100)

Weighted blend of four sub-scores, each normalized 0–100:

| Sub-score | Weight | Source |
|---|---|---|
| Theme Strength | 30% | Theme's 1W & 1M return rank vs all themes (from `themes` + `theme_tickers` + qualified RS) |
| Stock RS | 35% | `rs_overall` percentile within qualified universe + bonus for positive `rs_1w` momentum |
| RS New High Before Price | 15% | `rs_nh_20d` → +full points, `rs_nh_6m` → +partial, days_ago decay |
| Catalyst | 20% | News sentiment (last 7d) + analyst upgrades + earnings within 14d |

All inputs already exist in DB — no new fetches except catalyst news for tickers not already cached.

---

## Data sources (all reused, no new caches)

- `qualified_rs_universe` — stock RS, returns, RS NH flags. Already loaded by `useRsAlpha`.
- `themes` + `theme_tickers` — map each ticker → its themes, compute that theme's avg RS / return.
- News & catalysts — reuse the existing `fetch-theme-news` / news cache pattern. For tickers without cached news, one batched edge call (`analyze-setup-catalysts`) fetches headlines + runs Groq sentiment, cached 4h in memory only (no DB write).
- Earnings proximity — reuse `earnings-calendar` data (already fetched on Earnings page) via a lightweight shared cache hook.

---

## Files touched

**New**
1. `src/components/rs/SetupAnalyzerModal.tsx` — paste input, run, results table.
2. `src/hooks/useSetupAnalyzer.ts` — orchestrates: parse → lookup in `useQualifiedRsMap` + theme map → call catalyst edge function → compute composite.
3. `supabase/functions/analyze-setup-catalysts/index.ts` — accepts `{ symbols: string[] }`, returns `{ symbol, sentiment, upgradeCount, earningsInDays }[]`. Pure read + AI, **no DB writes**.

**Edited**
4. `src/pages/RsAlpha.tsx` — add "Analyze Setup List" button + modal mount.
5. `supabase/config.toml` — register new edge function with `verify_jwt = false`.

**Not touched**
- No migration. No new tables. No new columns. No new cron.

---

## Technical notes

- All ranking math runs in the browser — the qualified universe is already loaded.
- Edge function only does the catalyst lookup (news + upgrades + earnings proximity) since news isn't fully client-cached.
- Catalyst results held in React state for the session; nothing persisted.
- Component reuses existing badge / RS rating / theme tooltip components for visual consistency with the rest of RS Alpha.

## Out of scope (future, opt-in)

- Saving named watchlists (would require a `user_watchlists` table).
- Daily snapshots of how a list's ranking evolved.
- Chart drilldown per ticker inside the analyzer.
