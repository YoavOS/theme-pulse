-- Atomic batch claim using CTE + FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_scan_batch(p_limit integer)
RETURNS TABLE(symbol text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cte AS (
    SELECT q.symbol
    FROM public.stock_scan_queue q
    WHERE q.status = 'pending'
    ORDER BY q.enqueued_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.stock_scan_queue sq
  SET status = 'processing'
  FROM cte
  WHERE sq.symbol = cte.symbol
  RETURNING sq.symbol;
END;
$$;

-- Recompute progress counters from authoritative DB state
CREATE OR REPLACE FUNCTION public.recompute_rs_scan_progress()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_pending integer;
  v_processing integer;
  v_done integer;
  v_skipped integer;
  v_failed integer;
  v_qualified integer;
  v_status text;
  v_current_status text;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'processing'),
    count(*) FILTER (WHERE status = 'done'),
    count(*) FILTER (WHERE status = 'skipped'),
    count(*) FILTER (WHERE status = 'failed')
  INTO v_total, v_pending, v_processing, v_done, v_skipped, v_failed
  FROM public.stock_scan_queue;

  SELECT count(*) INTO v_qualified FROM public.qualified_rs_universe_staging;

  SELECT status INTO v_current_status FROM public.rs_scan_progress WHERE id = 1;

  IF v_current_status = 'paused' THEN
    v_status := 'paused';
  ELSIF v_total = 0 THEN
    v_status := 'idle';
  ELSIF v_pending = 0 AND v_processing = 0 THEN
    v_status := 'complete';
  ELSE
    v_status := 'running';
  END IF;

  UPDATE public.rs_scan_progress
  SET
    total_queued = v_total,
    processed = v_done + v_skipped + v_failed,
    qualified = v_qualified,
    failed = v_failed,
    status = v_status,
    last_updated = now()
  WHERE id = 1;
END;
$$;

-- Per-tick advisory lock so overlapping cron invocations don't double-process
CREATE OR REPLACE FUNCTION public.try_universe_scan_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(91271453);
$$;

CREATE OR REPLACE FUNCTION public.release_universe_scan_lock()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(91271453); SELECT;
$$;
