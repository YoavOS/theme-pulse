-- Superperformance list: store every profile score, a small breakdown, and report dates,
-- so the list can be refreshed in the background after each company reports.
ALTER TABLE public.superperformance_stocks
  ADD COLUMN IF NOT EXISTS profile_scores jsonb,
  ADD COLUMN IF NOT EXISTS breakdown jsonb,
  ADD COLUMN IF NOT EXISTS last_report date,
  ADD COLUMN IF NOT EXISTS next_report date;

-- Background refresh: every 20 minutes the worker rescores a small batch of stocks that are due
-- (reported since their last score, never scored, or not scored in 30 days). It exits quickly
-- when nothing is due.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'superperf-refresh-every-20-min';
END $$;

SELECT cron.schedule(
  'superperf-refresh-every-20-min',
  '*/20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhdvcqidyntxvwhyygxx.supabase.co/functions/v1/superperf-refresh',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZHZjcWlkeW50eHZ3aHl5Z3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0ODk3NzQsImV4cCI6MjA4ODA2NTc3NH0.UgTXXp8fXLGH-j96NnqevuommYZHa25UNAQNyQP3PFg"}'::jsonb,
    body := '{"trigger": "cron"}'::jsonb
  );
  $$
);

-- Pause / resume / status for the background refresh. Called only by the superperf-refresh
-- function (service role), like the other cron switches.
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
