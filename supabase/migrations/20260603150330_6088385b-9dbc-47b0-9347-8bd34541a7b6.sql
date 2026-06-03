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

  -- Refuse to publish an empty staging set (safety: never wipe live universe)
  IF v_count = 0 THEN
    RAISE EXCEPTION 'qualified_rs_universe_staging is empty — refusing to swap';
  END IF;

  -- Atomic swap inside one transaction. Use explicit column names so schema
  -- column-order drift between live and staging cannot corrupt or block publish.
  DELETE FROM public.qualified_rs_universe;

  INSERT INTO public.qualified_rs_universe (
    symbol,
    company_name,
    sector,
    market_cap,
    current_price,
    avg_dollar_volume,
    adr_percent,
    adr_source,
    return_1d,
    return_1w,
    return_1m,
    return_3m,
    return_6m,
    spy_return_1d,
    spy_return_1w,
    spy_return_1m,
    spy_return_3m,
    spy_return_6m,
    rs_1d,
    rs_1w,
    rs_1m,
    rs_3m,
    rs_6m,
    rs_overall,
    rs_calculated_at,
    qualified_at
  )
  SELECT
    symbol,
    company_name,
    sector,
    market_cap,
    current_price,
    avg_dollar_volume,
    adr_percent,
    adr_source,
    return_1d,
    return_1w,
    return_1m,
    return_3m,
    return_6m,
    spy_return_1d,
    spy_return_1w,
    spy_return_1m,
    spy_return_3m,
    spy_return_6m,
    rs_1d,
    rs_1w,
    rs_1m,
    rs_3m,
    rs_6m,
    rs_overall,
    rs_calculated_at,
    qualified_at
  FROM public.qualified_rs_universe_staging;

  DELETE FROM public.qualified_rs_universe_staging;

  UPDATE public.rs_scan_progress
  SET qualified = v_count,
      processed = GREATEST(processed, total_queued),
      status = 'complete',
      last_updated = now()
  WHERE id = 1;

  RETURN v_count;
END;
$function$;