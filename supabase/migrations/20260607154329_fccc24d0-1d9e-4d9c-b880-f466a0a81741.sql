-- get_storage_stats: returns row count, size in bytes, and best-effort last-updated
-- timestamp for every table managed by the Storage Manager UI.
CREATE OR REPLACE FUNCTION public.get_storage_stats()
RETURNS TABLE(
  table_name text,
  row_count bigint,
  size_bytes bigint,
  last_updated timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'qualified_rs_universe',
    'qualified_rs_universe_staging',
    'stock_scan_queue',
    'rs_scan_progress',
    'stock_fundamentals',
    'fundamentals_scan_queue',
    'fundamentals_scan_progress',
    'fundamentals_cache',
    'full_update_progress',
    'themes',
    'theme_tickers',
    'ticker_performance',
    'ticker_volume_cache',
    'yahoo_history_cache'
  ];
  ts_cols text[] := ARRAY[
    'last_updated','updated_at','last_scanned','qualified_at',
    'rs_calculated_at','enqueued_at','fetched_at','created_at'
  ];
  v_count bigint;
  v_size bigint;
  v_ts timestamptz;
  col text;
  has_col boolean;
  q text;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO v_count;
      EXECUTE format('SELECT pg_total_relation_size(''public.%I''::regclass)', tbl) INTO v_size;

      v_ts := NULL;
      FOREACH col IN ARRAY ts_cols LOOP
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = tbl AND column_name = col
        ) INTO has_col;
        IF has_col THEN
          q := format('SELECT max(%I) FROM public.%I', col, tbl);
          EXECUTE q INTO v_ts;
          EXIT WHEN v_ts IS NOT NULL;
        END IF;
      END LOOP;

      table_name := tbl;
      row_count := v_count;
      size_bytes := v_size;
      last_updated := v_ts;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      table_name := tbl;
      row_count := 0;
      size_bytes := 0;
      last_updated := NULL;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storage_stats() TO anon, authenticated, service_role;

-- truncate_storage_table: clears a single allow-listed table. Live data tables
-- (qualified_rs_universe, themes, theme_tickers, stock_fundamentals) require
-- the p_force flag — typed-confirmation on the client.
CREATE OR REPLACE FUNCTION public.truncate_storage_table(p_table text, p_force boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_tables text[] := ARRAY[
    'qualified_rs_universe_staging',
    'stock_scan_queue',
    'fundamentals_scan_queue',
    'ticker_performance',
    'ticker_volume_cache',
    'yahoo_history_cache',
    'fundamentals_cache',
    'full_update_progress'
  ];
  protected_tables text[] := ARRAY[
    'qualified_rs_universe',
    'stock_fundamentals',
    'themes',
    'theme_tickers',
    'rs_scan_progress',
    'fundamentals_scan_progress'
  ];
  before_count bigint;
BEGIN
  IF p_table = ANY(safe_tables) OR (p_force AND p_table = ANY(protected_tables)) THEN
    EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO before_count;
    EXECUTE format('TRUNCATE TABLE public.%I', p_table);
    RETURN before_count;
  ELSE
    RAISE EXCEPTION 'Table % is not allowed to be truncated', p_table;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.truncate_storage_table(text, boolean) TO authenticated, service_role;
