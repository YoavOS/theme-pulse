CREATE OR REPLACE FUNCTION public.release_universe_scan_lock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_unlock(91271453);
END;
$$;
