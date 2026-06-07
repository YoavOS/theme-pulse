CREATE OR REPLACE FUNCTION public.get_storage_stats()
 RETURNS TABLE(table_name text, row_count bigint, size_bytes bigint, last_updated timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'qualified_rs_universe','qualified_rs_universe_staging','stock_scan_queue',
    'rs_scan_progress','stock_fundamentals','fundamentals_scan_queue',
    'fundamentals_scan_progress','fundamentals_cache','full_update_progress',
    'themes','theme_tickers','ticker_performance','ticker_volume_cache',
    'yahoo_history_cache'
  ];
  ts_cols text[] := ARRAY['last_updated','updated_at','last_scanned','qualified_at',
                          'rs_calculated_at','enqueued_at','fetched_at','created_at'];
  v_count bigint;
  v_size bigint;
  v_ts timestamptz;
  col text;
  has_col boolean;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    v_count := 0;
    v_size := 0;
    v_ts := NULL;

    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO v_count;
    EXCEPTION WHEN OTHERS THEN v_count := 0; END;

    BEGIN
      EXECUTE format('SELECT pg_total_relation_size(%L::regclass)', 'public.'||tbl) INTO v_size;
    EXCEPTION WHEN OTHERS THEN v_size := 0; END;

    FOREACH col IN ARRAY ts_cols LOOP
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = tbl AND c.column_name = col
        ) INTO has_col;
        IF has_col THEN
          EXECUTE format('SELECT max(%I)::timestamptz FROM public.%I', col, tbl) INTO v_ts;
          EXIT WHEN v_ts IS NOT NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

    table_name := tbl;
    row_count := v_count;
    size_bytes := v_size;
    last_updated := v_ts;
    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_storage_stats() TO anon, authenticated, service_role;