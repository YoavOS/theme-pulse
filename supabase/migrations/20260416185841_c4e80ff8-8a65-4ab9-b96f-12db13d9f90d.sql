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

  -- cron.alter_job is the supported API; UPDATE on cron.job is restricted.
  PERFORM cron.alter_job(job_id := v_jobid, active := p_active);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_universe_cron_active(boolean) TO service_role, authenticated, anon;