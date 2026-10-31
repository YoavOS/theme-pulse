-- History for the distribution windows (Sector / Theme distribution in RS Alpha).
-- One row per day: every stock in the RS list with its sector, relative-strength values and ADR,
-- in compact column arrays. "live" rows are copies of the list after an RS update; "rebuilt" rows
-- are past weeks recalculated from the stored 1-year price history.
CREATE TABLE IF NOT EXISTS public.rs_history_snapshots (
  day date PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('live', 'rebuilt')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rs_history_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read rs history" ON public.rs_history_snapshots;
CREATE POLICY "Anyone can read rs history" ON public.rs_history_snapshots FOR SELECT USING (true);
GRANT SELECT ON public.rs_history_snapshots TO anon, authenticated;
GRANT ALL ON public.rs_history_snapshots TO service_role;

-- Every weekday after the US close: save today's list (if RS was updated) and fill missing past weeks.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rs-history-daily';
END $$;

SELECT cron.schedule(
  'rs-history-daily',
  '15 22 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://hhdvcqidyntxvwhyygxx.supabase.co/functions/v1/rs-history',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZHZjcWlkeW50eHZ3aHl5Z3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0ODk3NzQsImV4cCI6MjA4ODA2NTc3NH0.UgTXXp8fXLGH-j96NnqevuommYZHa25UNAQNyQP3PFg"}'::jsonb,
    body := '{"action": "daily"}'::jsonb
  );
  $$
);
