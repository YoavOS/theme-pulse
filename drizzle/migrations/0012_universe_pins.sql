-- Pinned universe stocks: tickers added from an imported list (List analyzer) that don't pass the
-- universe filters. A universe rebuild (swap_qualified_rs_universe) replaces the live table with
-- the new scan; pinned stocks that the scan didn't qualify are now carried over (with their last
-- row) instead of disappearing.

CREATE TABLE IF NOT EXISTS public.universe_pins (
  symbol    text PRIMARY KEY,
  source    text NOT NULL DEFAULT 'list',
  added_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.universe_pins TO anon, authenticated;
GRANT ALL ON public.universe_pins TO service_role;
ALTER TABLE public.universe_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read universe pins" ON public.universe_pins;
CREATE POLICY "Read universe pins" ON public.universe_pins FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.swap_qualified_rs_universe()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.qualified_rs_universe_staging;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'qualified_rs_universe_staging is empty — refusing to swap';
  END IF;

  -- Pinned stocks the new scan didn't qualify: keep their current live rows.
  DROP TABLE IF EXISTS pg_temp._pinned_universe;
  CREATE TEMP TABLE _pinned_universe ON COMMIT DROP AS
    SELECT u.* FROM public.qualified_rs_universe u
    WHERE u.symbol IN (SELECT symbol FROM public.universe_pins)
      AND u.symbol NOT IN (SELECT symbol FROM public.qualified_rs_universe_staging);

  TRUNCATE TABLE public.qualified_rs_universe;

  INSERT INTO public.qualified_rs_universe (
    symbol, company_name, sector, market_cap, current_price,
    avg_dollar_volume, adr_percent, adr_source,
    return_1d, return_1w, return_1m, return_3m, return_6m,
    spy_return_1d, spy_return_1w, spy_return_1m, spy_return_3m, spy_return_6m,
    rs_1d, rs_1w, rs_1m, rs_3m, rs_6m, rs_overall,
    rs_calculated_at, qualified_at,
    rs_nh_20d, rs_nh_20d_days_ago, rs_nh_6m, rs_nh_6m_days_ago
  )
  SELECT
    symbol, company_name, sector, market_cap, current_price,
    avg_dollar_volume, adr_percent, adr_source,
    return_1d, return_1w, return_1m, return_3m, return_6m,
    spy_return_1d, spy_return_1w, spy_return_1m, spy_return_3m, spy_return_6m,
    rs_1d, rs_1w, rs_1m, rs_3m, rs_6m, rs_overall,
    rs_calculated_at, qualified_at,
    rs_nh_20d, rs_nh_20d_days_ago, rs_nh_6m, rs_nh_6m_days_ago
  FROM public.qualified_rs_universe_staging;

  INSERT INTO public.qualified_rs_universe SELECT * FROM _pinned_universe
  ON CONFLICT (symbol) DO NOTHING;

  TRUNCATE TABLE public.qualified_rs_universe_staging;

  UPDATE public.rs_scan_progress
  SET qualified = v_count,
      processed = GREATEST(processed, total_queued),
      status = 'complete',
      last_updated = now()
  WHERE id = 1;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.swap_qualified_rs_universe() FROM anon, authenticated, PUBLIC;