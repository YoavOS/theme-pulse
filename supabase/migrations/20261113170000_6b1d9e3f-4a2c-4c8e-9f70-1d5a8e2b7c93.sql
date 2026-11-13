-- Proven-Strong: store the Damodaran life-cycle stage used for each verdict (same rule as the Lens).
ALTER TABLE public.proven_strength ADD COLUMN IF NOT EXISTS life_stage text;
