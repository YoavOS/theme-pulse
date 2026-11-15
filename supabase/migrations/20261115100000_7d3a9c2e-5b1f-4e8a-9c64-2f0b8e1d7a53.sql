-- Cloud efficiency + fresh earnings.
--
-- 1) sec-filings-watch now records every listed company's 10-Q / 10-K / 20-F / 40-F (not only the
--    universe on the night they were filed), so stocks added to the universe later still have their
--    latest report on record. Days read by the old version are read once more (version < 2).
ALTER TABLE public.sec_index_days ADD COLUMN IF NOT EXISTS version smallint NOT NULL DEFAULT 1;

-- 2) pg_cron keeps a row per job run forever (cron.job_run_details). Old minute-interval jobs left
--    ~24k rows. Keep three days; the purge is scheduled nightly inside the after-close window
--    (the job itself is set up separately from this migration).
CREATE OR REPLACE FUNCTION public.purge_cron_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_cron_history() FROM PUBLIC, anon, authenticated;
