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
  -- 1. Per-period duplicates (anything other than 6mo / 1y).
  WITH d AS (
    DELETE FROM public.yahoo_history_cache
      WHERE period NOT IN ('6mo', '1y')
      RETURNING pg_column_size(ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r;
  v_bytes := v_bytes + v_b;

  -- 2. Stale snapshots older than 14 days.
  WITH d AS (
    DELETE FROM public.yahoo_history_cache
      WHERE fetched_at < now() - interval '14 days'
      RETURNING pg_column_size(ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r;
  v_bytes := v_bytes + v_b;

  -- 3. Orphan tickers (no theme membership and not SPY).
  WITH d AS (
    DELETE FROM public.yahoo_history_cache yhc
      WHERE yhc.symbol <> 'SPY'
        AND NOT EXISTS (
          SELECT 1 FROM public.theme_tickers tt WHERE tt.ticker_symbol = yhc.symbol
        )
      RETURNING pg_column_size(yhc.ohlc) AS sz
  )
  SELECT count(*), coalesce(sum(sz),0)::bigint INTO v_r, v_b FROM d;
  v_removed := v_removed + v_r;
  v_bytes := v_bytes + v_b;

  removed_rows := v_removed;
  freed_bytes := v_bytes;
  RETURN NEXT;
END;
$function$;