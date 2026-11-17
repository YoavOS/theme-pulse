-- Theme Pulse on your own PC: scheduled jobs pointed at the local backend.
-- Run by Start-ThemePulse.ps1 after every start (safe to run again and again).
-- The Lovable-era jobs called the old cloud project at fixed times; here one "tick" every 5 minutes
-- works through the nightly list in order, so a night the PC was off is caught up the next time it's on.

CREATE TABLE IF NOT EXISTS public.local_settings (key text PRIMARY KEY, value text NOT NULL);
REVOKE ALL ON public.local_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.local_runs (step text PRIMARY KEY, last_done timestamptz NOT NULL, note text);
REVOKE ALL ON public.local_runs FROM anon, authenticated;

-- Call one backend function (asynchronously, through pg_net) with the local key.
CREATE OR REPLACE FUNCTION public.local_call(fn text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE base text; k text;
BEGIN
  SELECT value INTO base FROM public.local_settings WHERE key = 'functions_url';
  SELECT value INTO k FROM public.local_settings WHERE key = 'anon_key';
  IF base IS NULL OR k IS NULL THEN RAISE NOTICE 'local_settings not filled yet'; RETURN NULL; END IF;
  RETURN net.http_post(
    url := base || '/' || fn,
    body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || k, 'apikey', k),
    timeout_milliseconds := 900000
  );
END $$;
REVOKE ALL ON FUNCTION public.local_call(text, jsonb) FROM anon, authenticated, PUBLIC;

-- The most recent time (UTC) at or before now that falls on one of `dows` (0 = Sunday) at hh:mm.
CREATE OR REPLACE FUNCTION public.local_last_slot(dows int[], hh int, mm int)
RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE d date := (now() AT TIME ZONE 'UTC')::date; t timestamptz;
BEGIN
  FOR i IN 0..8 LOOP
    t := ((d - i)::timestamp + make_interval(hours => hh, mins => mm)) AT TIME ZONE 'UTC';
    IF extract(dow FROM d - i)::int = ANY (dows) AND t <= now() THEN RETURN t; END IF;
  END LOOP;
  RETURN '-infinity';
END $$;

-- One tick: fire the first job step that is due and hasn't run since its slot. Steps of the nightly
-- run are spaced by the 5-minute tick, like the old fixed schedule (≈ 1 hour for the whole night).
CREATE OR REPLACE FUNCTION public.local_tick()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  nightly timestamptz := public.local_last_slot(ARRAY[1,2,3,4,5], 22, 30);  -- weekdays, after the US close
  weekly  timestamptz := public.local_last_slot(ARRAY[5], 23, 50);          -- Fridays
  yearly  timestamptz := make_timestamptz(extract(year FROM now())::int - CASE WHEN now() < make_timestamptz(extract(year FROM now())::int, 1, 20, 6, 30, 0, 'UTC') THEN 1 ELSE 0 END, 1, 20, 6, 30, 0, 'UTC');
  steps jsonb := jsonb_build_array(
    jsonb_build_object('step', 'damodaran', 'slot', yearly, 'fn', 'damodaran-benchmarks', 'body', '{}'::jsonb),
    jsonb_build_object('step', 'rs-history', 'slot', nightly, 'fn', 'rs-history', 'body', '{"action":"daily"}'::jsonb),
    jsonb_build_object('step', 'sec-filings-1', 'slot', nightly, 'fn', 'sec-filings-watch', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'sec-filings-2', 'slot', nightly, 'fn', 'sec-filings-watch', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'sec-filings-3', 'slot', nightly, 'fn', 'sec-filings-watch', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-1', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-2', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-3', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-4', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-5', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'superperf-6', 'slot', nightly, 'fn', 'superperf-refresh', 'body', '{"trigger":"cron"}'::jsonb),
    jsonb_build_object('step', 'proven-1', 'slot', nightly, 'fn', 'proven-strength', 'body', '{"action":"batch"}'::jsonb),
    jsonb_build_object('step', 'proven-2', 'slot', nightly, 'fn', 'proven-strength', 'body', '{"action":"batch"}'::jsonb),
    jsonb_build_object('step', 'proven-3', 'slot', nightly, 'fn', 'proven-strength', 'body', '{"action":"batch"}'::jsonb),
    -- the AI's nightly market report (local model), English then Hebrew
    jsonb_build_object('step', 'ai-report-en', 'slot', nightly, 'fn', 'ai-analyst', 'body', '{"action":"report","lang":"en","fresh":true}'::jsonb),
    jsonb_build_object('step', 'ai-report-he', 'slot', nightly, 'fn', 'ai-analyst', 'body', '{"action":"report","lang":"he"}'::jsonb),
    jsonb_build_object('step', 'trim-cache', 'slot', weekly, 'sql', 'trim')
  );
  s jsonb; last timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.local_settings WHERE key = 'anon_key') THEN RETURN 'not configured'; END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(steps) LOOP
    SELECT last_done INTO last FROM public.local_runs WHERE step = s->>'step';
    -- the yearly Damodaran load also runs whenever its tables are still empty (first start)
    IF s->>'step' = 'damodaran' AND last IS NOT NULL AND EXISTS (SELECT 1 FROM public.damodaran_loads) THEN CONTINUE; END IF;
    IF last IS NOT NULL AND last >= (s->>'slot')::timestamptz THEN CONTINUE; END IF;
    -- the nightly jobs work on the stock universe: wait until the first universe scan has filled it
    IF (s->>'slot')::timestamptz = nightly AND NOT EXISTS (SELECT 1 FROM public.qualified_rs_universe LIMIT 1) THEN
      RETURN 'waiting for the first universe scan';
    END IF;
    IF s ? 'sql' THEN PERFORM public.trim_yahoo_cache();
    ELSE PERFORM public.local_call(s->>'fn', s->'body'); END IF;
    INSERT INTO public.local_runs(step, last_done) VALUES (s->>'step', now())
      ON CONFLICT (step) DO UPDATE SET last_done = excluded.last_done;
    RETURN 'ran ' || (s->>'step');
  END LOOP;
  RETURN 'nothing due';
END $$;
REVOKE ALL ON FUNCTION public.local_tick() FROM anon, authenticated, PUBLIC;

-- Replace every job that called the old cloud project or ran at a fixed time (the tick does those now).
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE command LIKE '%supabase.co/functions%' OR jobname IN (
    'rs-history-daily', 'sec-filings-watch', 'sec-filings-watch-late', 'proven-strength-batch', 'damodaran-benchmarks', 'trim-yahoo-cache-weekly')
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;

-- Jobs the app switches on and off itself (scan queues, superperformance) keep their names so its
-- pause/resume buttons work; created once, so a restart keeps whatever state they were in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-universe-queue-every-minute') THEN
    PERFORM cron.schedule('process-universe-queue-every-minute', '* * * * *', $j$SELECT public.local_call('process-universe-queue', '{"trigger":"cron"}'::jsonb)$j$);
    PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'process-universe-queue-every-minute'), active := false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-fundamentals-queue-every-minute') THEN
    PERFORM cron.schedule('process-fundamentals-queue-every-minute', '* * * * *', $j$SELECT public.local_call('process-fundamentals-queue', '{"trigger":"cron"}'::jsonb)$j$);
    PERFORM cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'process-fundamentals-queue-every-minute'), active := false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'superperf-refresh-every-20-min') THEN
    PERFORM cron.schedule('superperf-refresh-every-20-min', '*/20 22-23 * * 1-5', $j$SELECT public.local_call('superperf-refresh', '{"trigger":"cron"}'::jsonb)$j$);
  END IF;
  PERFORM cron.schedule('local-tick', '*/5 * * * *', 'SELECT public.local_tick()');
END $$;

-- Keep the job log from growing forever (it isn't needed after a week).
CREATE OR REPLACE FUNCTION public.local_cleanup() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
$$;
SELECT cron.schedule('local-cleanup', '17 3 * * *', $$SELECT public.local_cleanup()$$);
