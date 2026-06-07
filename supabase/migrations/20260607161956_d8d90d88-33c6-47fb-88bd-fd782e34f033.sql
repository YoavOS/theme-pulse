CREATE OR REPLACE FUNCTION public.trim_yahoo_cache()
 RETURNS TABLE(removed_rows bigint, freed_bytes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before_rows bigint;
  v_before_bytes bigint;
  v_after_rows bigint;
  v_after_bytes bigint;
BEGIN
  SELECT count(*), pg_total_relation_size('public.yahoo_history_cache'::regclass)
    INTO v_before_rows, v_before_bytes
    FROM public.yahoo_history_cache;

  -- 1. Remove all non-canonical period rows (5d, 1mo, 3mo, ytd are derivable from 6mo).
  DELETE FROM public.yahoo_history_cache
    WHERE period NOT IN ('6mo', '1y');

  -- 2. Remove canonical rows older than 14 days — will be lazily re-fetched.
  DELETE FROM public.yahoo_history_cache
    WHERE fetched_at < now() - interval '14 days';

  -- 3. Remove rows for symbols that are no longer in any theme (and aren't SPY).
  DELETE FROM public.yahoo_history_cache yhc
    WHERE yhc.symbol <> 'SPY'
      AND NOT EXISTS (
        SELECT 1 FROM public.theme_tickers tt WHERE tt.ticker_symbol = yhc.symbol
      );

  -- pg_total_relation_size only updates after VACUUM, so reclaim space inline.
  EXECUTE 'VACUUM (FULL) public.yahoo_history_cache';

  SELECT count(*), pg_total_relation_size('public.yahoo_history_cache'::regclass)
    INTO v_after_rows, v_after_bytes
    FROM public.yahoo_history_cache;

  removed_rows := GREATEST(0, v_before_rows - v_after_rows);
  freed_bytes := GREATEST(0, v_before_bytes - v_after_bytes);
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.trim_yahoo_cache() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_yahoo_cache_breakdown()
 RETURNS TABLE(period text, row_count bigint, payload_bytes bigint, oldest timestamptz, newest timestamptz)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    period,
    count(*)::bigint,
    coalesce(sum(pg_column_size(ohlc))::bigint, 0),
    min(fetched_at),
    max(fetched_at)
  FROM public.yahoo_history_cache
  GROUP BY period
  ORDER BY sum(pg_column_size(ohlc)) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_yahoo_cache_breakdown() TO anon, authenticated, service_role;