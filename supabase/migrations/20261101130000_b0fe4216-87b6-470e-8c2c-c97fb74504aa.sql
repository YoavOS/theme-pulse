-- Lower Lovable Cloud usage: run every scheduled job in one short window after the US close,
-- so the backend is idle (and can auto-pause) the rest of the day.
--   rs-history-daily          22:15 UTC weekdays (unchanged)
--   superperf-refresh         every 20 min, 22:00–23:40 UTC weekdays only (was every 20 min, 24/7)
--   trim-yahoo-cache-weekly   Fridays 23:50 UTC (was Sundays 06:30)

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'superperf-refresh-every-20-min';
END $$;

SELECT cron.schedule(
  'superperf-refresh-every-20-min',
  '*/20 22-23 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://hhdvcqidyntxvwhyygxx.supabase.co/functions/v1/superperf-refresh',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZHZjcWlkeW50eHZ3aHl5Z3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0ODk3NzQsImV4cCI6MjA4ODA2NTc3NH0.UgTXXp8fXLGH-j96NnqevuommYZHa25UNAQNyQP3PFg"}'::jsonb,
    body := '{"trigger": "cron"}'::jsonb
  );
  $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trim-yahoo-cache-weekly') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'trim-yahoo-cache-weekly';
    PERFORM cron.schedule('trim-yahoo-cache-weekly', '50 23 * * 5', 'SELECT public.trim_yahoo_cache()');
  END IF;
END $$;
