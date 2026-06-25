
ALTER TABLE public.superperformance_stocks
  ADD COLUMN IF NOT EXISTS oneil_score smallint,
  ADD COLUMN IF NOT EXISTS ryan_score smallint,
  ADD COLUMN IF NOT EXISTS current_score smallint;

ALTER TABLE public.superperformance_stocks
  ALTER COLUMN minervini_score DROP NOT NULL;
