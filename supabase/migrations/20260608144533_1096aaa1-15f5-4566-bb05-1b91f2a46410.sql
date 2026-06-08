
-- Drop overly permissive write policies on data tables (writes only happen from edge functions using service_role which bypasses RLS)
DROP POLICY IF EXISTS "Anyone can delete progress" ON public.full_update_progress;
DROP POLICY IF EXISTS "Anyone can insert progress" ON public.full_update_progress;
DROP POLICY IF EXISTS "Anyone can update progress" ON public.full_update_progress;

DROP POLICY IF EXISTS "Anyone can delete fundamentals_cache" ON public.fundamentals_cache;
DROP POLICY IF EXISTS "Anyone can insert fundamentals_cache" ON public.fundamentals_cache;
DROP POLICY IF EXISTS "Anyone can update fundamentals_cache" ON public.fundamentals_cache;

DROP POLICY IF EXISTS "Anyone can insert fund_scan_progress" ON public.fundamentals_scan_progress;
DROP POLICY IF EXISTS "Anyone can update fund_scan_progress" ON public.fundamentals_scan_progress;

DROP POLICY IF EXISTS "Anyone can delete fund_scan_queue" ON public.fundamentals_scan_queue;
DROP POLICY IF EXISTS "Anyone can insert fund_scan_queue" ON public.fundamentals_scan_queue;
DROP POLICY IF EXISTS "Anyone can update fund_scan_queue" ON public.fundamentals_scan_queue;

DROP POLICY IF EXISTS "Anyone can delete qualified universe" ON public.qualified_rs_universe;
DROP POLICY IF EXISTS "Anyone can insert qualified universe" ON public.qualified_rs_universe;
DROP POLICY IF EXISTS "Anyone can update qualified universe" ON public.qualified_rs_universe;

DROP POLICY IF EXISTS "Anyone can delete qualified universe staging" ON public.qualified_rs_universe_staging;
DROP POLICY IF EXISTS "Anyone can insert qualified universe staging" ON public.qualified_rs_universe_staging;
DROP POLICY IF EXISTS "Anyone can update qualified universe staging" ON public.qualified_rs_universe_staging;

DROP POLICY IF EXISTS "Anyone can insert scan progress" ON public.rs_scan_progress;
DROP POLICY IF EXISTS "Anyone can update scan progress" ON public.rs_scan_progress;

DROP POLICY IF EXISTS "Anyone can delete stock_fundamentals" ON public.stock_fundamentals;
DROP POLICY IF EXISTS "Anyone can insert stock_fundamentals" ON public.stock_fundamentals;
DROP POLICY IF EXISTS "Anyone can update stock_fundamentals" ON public.stock_fundamentals;

DROP POLICY IF EXISTS "Anyone can delete scan queue" ON public.stock_scan_queue;
DROP POLICY IF EXISTS "Anyone can insert scan queue" ON public.stock_scan_queue;
DROP POLICY IF EXISTS "Anyone can update scan queue" ON public.stock_scan_queue;

DROP POLICY IF EXISTS "Anyone can delete ticker_volume_cache" ON public.ticker_volume_cache;
DROP POLICY IF EXISTS "Anyone can insert ticker_volume_cache" ON public.ticker_volume_cache;
DROP POLICY IF EXISTS "Anyone can update ticker_volume_cache" ON public.ticker_volume_cache;

DROP POLICY IF EXISTS "Anyone can delete yahoo cache" ON public.yahoo_history_cache;
DROP POLICY IF EXISTS "Anyone can insert yahoo cache" ON public.yahoo_history_cache;
DROP POLICY IF EXISTS "Anyone can update yahoo cache" ON public.yahoo_history_cache;

-- Lock down SECURITY DEFINER functions: revoke from anon/authenticated where appropriate
-- Storage stats: require authentication
REVOKE EXECUTE ON FUNCTION public.get_storage_stats() FROM anon, PUBLIC;

-- Admin/back-office functions: only callable by service_role
REVOKE EXECUTE ON FUNCTION public.truncate_qualified_rs_staging() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.try_universe_scan_lock() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_universe_scan_lock() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_scan_batch(integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_universe_cron_active(boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_fundamentals_cron_active(boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_rs_scan_progress() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.swap_qualified_rs_universe() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_yahoo_cache_breakdown() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trim_yahoo_cache() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.truncate_storage_table(text, boolean) FROM anon, PUBLIC;
