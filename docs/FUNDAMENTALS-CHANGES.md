# Fundamentals implementation and validation — 2026-11-22

Implemented in the installed app; rollback sources are under `local/fundamentals-backup-20261122`. No Git commit or remote synchronization was performed.


## Current direction: education through companies
The user rejected the thesis form and requested a prominent company story, more horizontal layout, growth overlays and Deepvue-inspired colors. `CompanyOverview.tsx` now leads with a deterministic financial narrative and latest-quarter card, then three amount/growth charts, income flow with industry context, and expandable deeper education. `QuarterlyChart.tsx` uses existing up/down/warn palette; dual axes explicitly distinguish amount and percentage growth. QoQ/YoY toggles, quarter buttons and exact data tables are accessible. `quarterly.ts` validates comparable periods and positive percentage-growth bases; acceleration is the change in YoY revenue growth, in percentage points.

The income flow no longer disappears just because net profit exceeds operating profit: PLTR displays a net additions branch. Losses and missing values retain a signed fallback. Main layout uses available width; prior thesis form is no longer rendered. Existing browser notes are not deleted. Company/section changes return the content scroll to the top. Banks replace the primary cash chart with share-count context.

Validated on 2026-11-22: TypeScript, production build, quarterly/story tests plus previous fundamentals regressions. Browser: NVDA QoQ/YoY values; PLTR flow with net additions; three equal-width charts at 1600px; no document overflow at 390px; Hebrew JPM and bank-specific chart. Native SVG adds no chart library or AI requests. This is the current implementation; original implementation notes below retain the calculation audit history.

## Data and calculation integrity
- `fundamentals_integrity` migration converts universe cap millions to dollars before comparison with SEC figures. Invalid stable-growth solutions are suppressed, with model status displayed. The model still uses equity market value as a proxy and explicitly discloses this limitation.
- Shared parsed SEC cache is service-role-only with RLS. Lens and Proven use the same filing snapshot. SEC SIC supplies missing bank classification; JPM now uses ROE/cost-of-equity evidence.
- Proven recomputes with current benchmarks; Lens checks its benchmark profile before serving cached payloads.
- Scenarios represent current, industry and stronger economics; industry is not falsely presented as an ordered optimistic case. No permanent excess-return premium is hidden in defaults.
- Missing cash/debt/positive EV prevent valuation. Undated/stale market values require explicit illustration acknowledgment. Sensitivity, terminal contribution and ten-year cash-flow path are inspectable.
- R&D expense uses TTM, or the adjustment is withheld. Annual amortization/research-asset cohorts remain an explicitly disclosed approximation.
- Explanation validation preserves numeric units. Lens explanations now use deterministic fact summaries, eliminating model-generated numerical interpretation and token/GPU use on this page. Other manual AI features remain.

## Visuals and usability
Overview, Statements, Valuation, Evidence and Learn separate tasks. Native SVG income flow includes proportional expense branches, clickable learning steps, quarter/TTM selection and per-$100 normalization. Losses/missing totals use signed bars instead of an invalid positive Sankey. Statements add reconciliation, cash conversion and six quarterly trends. Bank cash-flow valuation is excluded. Segment revenue is unavailable in the source and not invented.

Comparison bars have zero baselines. Keyboard glossary activation works; nested glossary controls removed from expandable headings. New views use explicit Hebrew copy; Hebrew story summary derives from metric IDs. Legacy lesson translations still contain some source English.

Originally local notes saved ten dated snapshots; that form was removed from the company UI at the user’s request. Cached requests and stale-response guards prevent cross-company results. Hidden Ideas does not mount on initial load; heavy new views are lazy-loaded. Resource caps restored after backend launch.

## Verification
- `node local/test-fundamentals.cjs`: scenario direction, DCF round trip, invalid EV, TTM completeness, missing values, losses, unit-aware explanations, R&D period alignment.
- TypeScript and production build passed. Existing CSS-order/large-chunk warnings remain.
- Local endpoints NVDA/JPM/RIVN: HTTP 200, 13 statement periods each; warmed calls 45–87ms. This is not a cold-start or whole-PC lag benchmark.
- Database: corrected cap scale; out-of-bounds growth NULL with status; cache RLS enabled and anonymous INSERT denied.
- Browser: NVDA quarter/per-$100 changes, valuation stale-date gate, sensitivity keyboard input, Hebrew, glossary Enter; JPM bank classification/valuation exclusion and supported ten-year record; RIVN signed losses and cash bridge. Narrow and desktop views inspected.
- During rebuild, an already-open tab briefly referenced an obsolete chunk; reload recovered. Final build is served locally.

## Limits
No invented segment split or live quote timestamp. R&D amortization uses annual cohorts. Simplified valuation remains conditional on its assumptions; historical labels are not scenario probabilities. Legacy learning content and global bundle optimization can be refined further.
