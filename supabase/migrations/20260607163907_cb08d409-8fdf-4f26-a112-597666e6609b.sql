
ALTER TABLE public.qualified_rs_universe
  ADD COLUMN IF NOT EXISTS rs_nh_20d boolean,
  ADD COLUMN IF NOT EXISTS rs_nh_20d_days_ago smallint,
  ADD COLUMN IF NOT EXISTS rs_nh_6m boolean,
  ADD COLUMN IF NOT EXISTS rs_nh_6m_days_ago smallint;

ALTER TABLE public.qualified_rs_universe_staging
  ADD COLUMN IF NOT EXISTS rs_nh_20d boolean,
  ADD COLUMN IF NOT EXISTS rs_nh_20d_days_ago smallint,
  ADD COLUMN IF NOT EXISTS rs_nh_6m boolean,
  ADD COLUMN IF NOT EXISTS rs_nh_6m_days_ago smallint;

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
