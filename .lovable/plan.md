## Goal

In the Live Execution tab, the right column currently ends at Fundamentals while Theme Tickers continues down the left side, leaving a large empty gap. Options Activity and "RS vs SPY Across Timeframes" sit as full-width sections below, forcing extra scroll. Move both into the right column under Fundamentals so the whole tab reads in roughly one view.

## New layout

```text
┌──────────────────────────────┬──────────────────────────────┐
│                              │  Fundamentals                │
│                              ├──────────────────────────────┤
│  Theme Tickers               │  Options Activity            │
│  (tall left column)          ├──────────────────────────────┤
│                              │  RS vs SPY Across Timeframes │
└──────────────────────────────┴──────────────────────────────┘
```

## Changes (frontend only, `src/pages/LiveExecution.tsx`)

1. Keep the existing `section` grid `lg:grid-cols-[1.15fr_1fr]`. Wrap the right column in a vertical flex/`space-y-5` container so Fundamentals, Options Activity, and RS-vs-Benchmark stack inside it.
2. Move the existing Options Activity block (currently the standalone `section` at ~L1828–1937) into that right column, directly under Fundamentals. Preserve all its internal markup and behavior.
3. Move the existing "RS vs {benchmark} Across Timeframes" block (currently the standalone `section` at ~L1939–end of that group) into the right column, under Options Activity. Preserve internal markup.
4. Compact the moved sections for the narrower column:
   - Reduce outer padding from `p-6` to `p-5` to match Fundamentals.
   - Options Activity: switch the 3-tile metrics grid from `sm:grid-cols-3` to `grid-cols-1 md:grid-cols-3` so it still wraps cleanly in the narrower column on mid widths.
   - RS-vs-Benchmark: let its internal grid stay responsive; no logic changes.
5. Update the layout comment block above the section to reflect the new structure (left = Theme Tickers; right = Fundamentals → Options → RS Timeframes).
6. Remove the now-duplicate standalone Options Activity and RS-vs-Benchmark sections that used to sit below.

## Out of scope

- No changes to data fetching, scoring, hooks, or edge functions.
- No changes to Theme Tickers content or to the Options/RS internals beyond the small grid/padding tweaks above.
- No storage or backend changes.
