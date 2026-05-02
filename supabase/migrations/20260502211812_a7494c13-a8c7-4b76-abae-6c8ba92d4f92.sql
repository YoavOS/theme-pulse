-- Staging table mirrors the live universe schema
CREATE TABLE IF NOT EXISTS public.qualified_rs_universe_staging (
  LIKE public.qualified_rs_universe INCLUDING ALL
);

ALTER TABLE public.qualified_rs_universe_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read qualified universe staging" ON public.qualified_rs_universe_staging;
DROP POLICY IF EXISTS "Anyone can insert qualified universe staging" ON public.qualified_rs_universe_staging;
DROP POLICY IF EXISTS "Anyone can update qualified universe staging" ON public.qualified_rs_universe_staging;
DROP POLICY IF EXISTS "Anyone can delete qualified universe staging" ON public.qualified_rs_universe_staging;

CREATE POLICY "Anyone can read qualified universe staging" ON public.qualified_rs_universe_staging FOR SELECT USING (true);
CREATE POLICY "Anyone can insert qualified universe staging" ON public.qualified_rs_universe_staging FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update qualified universe staging" ON public.qualified_rs_universe_staging FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete qualified universe staging" ON public.qualified_rs_universe_staging FOR DELETE USING (true);

-- Atomic swap: live <- staging, then truncate staging
CREATE OR REPLACE FUNCTION public.swap_qualified_rs_universe()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.qualified_rs_universe_staging;

  -- Refuse to publish an empty staging set (safety: never wipe live universe)
  IF v_count = 0 THEN
    RAISE EXCEPTION 'qualified_rs_universe_staging is empty — refusing to swap';
  END IF;

  -- Atomic swap inside one transaction
  DELETE FROM public.qualified_rs_universe;
  INSERT INTO public.qualified_rs_universe
    SELECT * FROM public.qualified_rs_universe_staging;
  DELETE FROM public.qualified_rs_universe_staging;

  RETURN v_count;
END;
$$;