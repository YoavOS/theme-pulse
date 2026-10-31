-- Price-history cache housekeeping.
-- 1) The orphan rule now also keeps stocks in the RS stock list (the 52-week-high, tightness and
--    inside-candle scans use the cache for the whole list, not only theme tickers).
-- 2) New: drop a 6-month row when the same stock has a 1-year row from the last 2 days
--    (the 1-year row already contains those bars; readers now slice it).
-- 3) Runs every Sunday instead of only from the Storage page.
CREATE OR REPLACE FUNCTION public.trim_yahoo_cache()
 RETURNS TABLE(removed_rows bigint, freed_bytes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_removed bigint := 0;
  v_bytes bigint := 0;
  v_r bigint;
  v_b bigint;
BEGIN
  -- 1. Periods nothing reads any more (anything other than 3mo / 6mo / 1y).
  WITH d AS (
    DELETE FROM public.yahoo_history_cache
      WHERE period NOT IN ('3mo', '6mo', '1y')
      RETURNING pg_column_size(ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r; v_bytes := v_bytes + v_b;

  -- 2. Stale snapshots older than 14 days.
  WITH d AS (
    DELETE FROM public.yahoo_history_cache
      WHERE fetched_at < now() - interval '14 days'
      RETURNING pg_column_size(ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r; v_bytes := v_bytes + v_b;

  -- 3. Shorter copies of a fresh 1-year history.
  WITH d AS (
    DELETE FROM public.yahoo_history_cache s
      WHERE s.period IN ('3mo', '6mo')
        AND EXISTS (
          SELECT 1 FROM public.yahoo_history_cache y
           WHERE y.symbol = s.symbol AND y.period = '1y' AND y.fetched_at > now() - interval '2 days'
        )
      RETURNING pg_column_size(s.ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r; v_bytes := v_bytes + v_b;

  -- 4. Tickers in no theme and not in the stock list (and not a benchmark).
  WITH d AS (
    DELETE FROM public.yahoo_history_cache yhc
      WHERE yhc.symbol NOT IN ('SPY', 'QQQ')
        AND NOT EXISTS (SELECT 1 FROM public.theme_tickers tt WHERE upper(tt.ticker_symbol) = yhc.symbol)
        AND NOT EXISTS (SELECT 1 FROM public.qualified_rs_universe q WHERE q.symbol = yhc.symbol)
      RETURNING pg_column_size(yhc.ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r; v_bytes := v_bytes + v_b;

  removed_rows := v_removed;
  freed_bytes := v_bytes;
  RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trim_yahoo_cache() FROM anon, PUBLIC;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'trim-yahoo-cache-weekly';
END $$;

SELECT cron.schedule('trim-yahoo-cache-weekly', '30 6 * * 0', $$SELECT public.trim_yahoo_cache()$$);
