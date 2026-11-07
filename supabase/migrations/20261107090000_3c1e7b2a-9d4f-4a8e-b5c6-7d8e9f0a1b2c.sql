-- Honest track record (Stages / Bases):
-- 1) signal_log rows are written once (insert-only) and remember the day and price the base
--    state was computed on, so base-state outcomes are measured from that point, not from an
--    earlier Friday close. Delisted/renamed stocks are closed at their last known price.
-- 2) base_breakouts: one row per breakout (pivot, day, status), failures kept, for an honest
--    breakout failure rate.
ALTER TABLE public.signal_log
  ADD COLUMN IF NOT EXISTS signal_date date,
  ADD COLUMN IF NOT EXISTS signal_close numeric,
  ADD COLUMN IF NOT EXISTS bfwd4 numeric,
  ADD COLUMN IF NOT EXISTS bfwd8 numeric,
  ADD COLUMN IF NOT EXISTS bfwd13 numeric,
  ADD COLUMN IF NOT EXISTS tries smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exit_last boolean;

CREATE TABLE IF NOT EXISTS public.base_breakouts (
  symbol        text NOT NULL,
  breakout_date date NOT NULL,
  pivot         numeric NOT NULL,
  label         text,
  rvol          numeric,
  status        text NOT NULL,             -- triggered | extended | failed
  failed_date   date,
  last_close    numeric,
  last_date     date,
  ext_pct       numeric,                   -- latest close vs pivot (%)
  max_ext_pct   numeric,                   -- best close vs pivot since the breakout (%)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, breakout_date)
);
GRANT SELECT ON public.base_breakouts TO anon, authenticated;
GRANT ALL ON public.base_breakouts TO service_role;
ALTER TABLE public.base_breakouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read base breakouts" ON public.base_breakouts;
CREATE POLICY "Read base breakouts" ON public.base_breakouts FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS base_breakouts_date_idx ON public.base_breakouts (breakout_date);
