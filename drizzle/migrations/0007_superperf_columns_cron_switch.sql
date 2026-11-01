ALTER TABLE public.superperformance_stocks
  ADD COLUMN IF NOT EXISTS profile_scores jsonb,
  ADD COLUMN IF NOT EXISTS breakdown jsonb,
  ADD COLUMN IF NOT EXISTS last_report date,
  ADD COLUMN IF NOT EXISTS next_report date;

CREATE OR REPLACE FUNCTION public.set_superperf_cron_active(p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $fn$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'superperf-refresh-every-20-min' LIMIT 1;
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'cron job superperf-refresh-every-20-min not found';
    RETURN;
  END IF;
  PERFORM cron.alter_job(job_id := v_jobid, active := p_active);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_superperf_cron_active()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $fn$
  SELECT COALESCE((SELECT active FROM cron.job WHERE jobname = 'superperf-refresh-every-20-min' LIMIT 1), false);
$fn$;

REVOKE EXECUTE ON FUNCTION public.set_superperf_cron_active(boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_superperf_cron_active() FROM anon, authenticated, PUBLIC;