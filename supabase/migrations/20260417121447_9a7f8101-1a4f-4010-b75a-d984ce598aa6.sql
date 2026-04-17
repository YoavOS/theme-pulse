ALTER TABLE public.qualified_rs_universe
  ADD COLUMN IF NOT EXISTS return_1w numeric,
  ADD COLUMN IF NOT EXISTS spy_return_1w numeric,
  ADD COLUMN IF NOT EXISTS rs_1w numeric;