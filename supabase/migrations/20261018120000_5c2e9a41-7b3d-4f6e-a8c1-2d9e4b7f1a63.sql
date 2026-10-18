-- ─────────────────────────────────────────────────────────────
-- Signal log — the app's own point-in-time track record.
-- Each stage scan's finalize step logs one row per stock per week
-- (stage, base, regime at that time) and later fills in what the stock
-- and SPY actually did 4, 8 and 13 weeks afterwards. Stocks that leave
-- the list are still resolved (survivorship-free going forward).
-- Written only by the stage-scan edge function (service role).
-- ~1.5k short rows per week.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.signal_log (
  symbol        text NOT NULL,
  week          date NOT NULL,              -- week ending (Friday) of the scan
  close         numeric,
  stage         smallint,
  substage      text,
  confidence    smallint,
  event_kind    text,
  tt            boolean,                    -- Minervini Trend Template (7 price rules)
  rs_pct        smallint,                   -- 26-week return percentile across the list
  mrs52         numeric,
  base_score    smallint,
  base_state    text,
  base_label    text,
  base_labels   text[],
  base_tight    boolean,                    -- contracting on daily swings
  pivot         numeric,
  trigger_rvol  numeric,
  regime        text,                       -- green | yellow | red
  p50           numeric,                    -- % of the list above its 10-week MA
  p200          numeric,                    -- % above the 40-week MA
  hl            numeric,                    -- High–Low index
  spy_close     numeric,
  fwd4          numeric,                    -- stock % change 4 / 8 / 13 weeks later
  fwd8          numeric,
  fwd13         numeric,
  spy4          numeric,                    -- SPY % change over the same weeks
  spy8          numeric,
  spy13         numeric,
  gone          boolean,                    -- no price data any more (delisted / renamed)
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, week)
);

-- 1. Privileges: the app reads; only the edge function (service role) writes.
GRANT SELECT ON public.signal_log TO anon, authenticated;
GRANT ALL ON public.signal_log TO service_role;

-- 2. Row level security
ALTER TABLE public.signal_log ENABLE ROW LEVEL SECURITY;

-- 3. Policies: read-only for the app.
DROP POLICY IF EXISTS "Read signal log" ON public.signal_log;
CREATE POLICY "Read signal log" ON public.signal_log FOR SELECT USING (true);

-- 4. Index
CREATE INDEX IF NOT EXISTS signal_log_week_idx ON public.signal_log (week);
