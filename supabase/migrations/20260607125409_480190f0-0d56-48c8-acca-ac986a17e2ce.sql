
-- Drop unused tables from removed features
DROP TABLE IF EXISTS public.alert_history CASCADE;
DROP TABLE IF EXISTS public.eod_prices CASCADE;
DROP TABLE IF EXISTS public.eod_save_sessions CASCADE;
DROP TABLE IF EXISTS public.last_scan_cache CASCADE;
DROP TABLE IF EXISTS public.theme_breadth_history CASCADE;
DROP TABLE IF EXISTS public.weekly_reports CASCADE;
DROP TABLE IF EXISTS public.ticker_performance CASCADE;
DROP TABLE IF EXISTS public.volume_history CASCADE;
DROP TABLE IF EXISTS public.news_cache CASCADE;

-- Drop obsolete EOD function
DROP FUNCTION IF EXISTS public.get_eod_baselines(text[], date, date, date, date) CASCADE;

-- Wipe stale snapshot caches (no historical retention)
TRUNCATE TABLE public.qualified_rs_universe_staging;
TRUNCATE TABLE public.yahoo_history_cache;
TRUNCATE TABLE public.ticker_volume_cache;

-- (Re)create helper used by process-universe-queue after atomic swap
CREATE OR REPLACE FUNCTION public.truncate_qualified_rs_staging()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE public.qualified_rs_universe_staging;
END;
$$;
