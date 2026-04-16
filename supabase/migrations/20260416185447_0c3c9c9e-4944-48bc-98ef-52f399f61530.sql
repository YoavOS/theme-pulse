-- Helper function to pause/resume the universe-scan cron job from edge functions.
-- Runs as SECURITY DEFINER so it can touch the cron schema.
CREATE OR REPLACE FUNCTION public.set_universe_cron_active(p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'process-universe-queue-every-minute'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'cron job process-universe-queue-every-minute not found';
    RETURN;
  END IF;

  UPDATE cron.job SET active = p_active WHERE jobid = v_jobid;
END;
$$;

-- Allow the service role (used by edge functions) to call it
GRANT EXECUTE ON FUNCTION public.set_universe_cron_active(boolean) TO service_role, authenticated, anon;