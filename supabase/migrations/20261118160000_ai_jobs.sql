-- Long AI jobs on the PC model, outside the backend's ~1-minute limit per request.
-- A backend function prepares the prompt and submits it here; the database itself sends it to Ollama
-- (pg_net, up to 15 minutes) and keeps the answer. The function that submitted it then "finishes" the job
-- (stores the report, the lines, …) when the page asks for the result or when the once-a-minute collector runs.
CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id          bigserial PRIMARY KEY,
  fn          text NOT NULL,             -- backend function that finishes it (ai-analyst, company-file, pattern-finder)
  kind        text NOT NULL,             -- what to do with the answer (report, stock, ask, …)
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request     jsonb,                     -- the Ollama /api/chat body
  request_id  bigint,                    -- pg_net request
  status      text NOT NULL DEFAULT 'running',   -- running | answered | done | error
  response    jsonb,                     -- Ollama's reply
  output      jsonb,                     -- what the page gets back
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_jobs_status ON public.ai_jobs (status, created_at);
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ai_jobs TO service_role;
GRANT USAGE ON SEQUENCE public.ai_jobs_id_seq TO service_role;

-- Submit: returns the job id, or null when the PC model isn't set up (the caller then uses the cloud keys).
CREATE OR REPLACE FUNCTION public.ai_job_submit(p_fn text, p_kind text, p_params jsonb, p_request jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE url text; rid bigint; jid bigint;
BEGIN
  SELECT value INTO url FROM public.local_settings WHERE key = 'ollama_url';
  IF url IS NULL OR url = '' THEN RETURN NULL; END IF;
  SELECT net.http_post(url := url || '/api/chat', body := p_request,
                       headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 900000) INTO rid;
  INSERT INTO public.ai_jobs(fn, kind, params, request, request_id) VALUES (p_fn, p_kind, coalesce(p_params, '{}'::jsonb), p_request, rid) RETURNING id INTO jid;
  RETURN jid;
END $$;

-- Claim an answered job for finishing (only one caller wins). Returns the job, or null if not ready.
CREATE OR REPLACE FUNCTION public.ai_job_claim(p_id bigint)
RETURNS SETOF public.ai_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE j public.ai_jobs; r record;
BEGIN
  SELECT * INTO j FROM public.ai_jobs WHERE id = p_id;
  IF NOT FOUND OR j.status <> 'running' THEN RETURN; END IF;
  SELECT status_code, content, timed_out, error_msg INTO r FROM net._http_response WHERE id = j.request_id;
  IF NOT FOUND THEN
    IF j.created_at < now() - interval '16 minutes' THEN
      UPDATE public.ai_jobs SET status = 'error', error = 'no answer from the PC model in 16 minutes', finished_at = now() WHERE id = p_id;
    END IF;
    RETURN;
  END IF;
  IF r.timed_out OR r.status_code IS DISTINCT FROM 200 THEN
    UPDATE public.ai_jobs SET status = 'error', error = coalesce(r.error_msg, 'HTTP ' || r.status_code || ': ' || left(coalesce(r.content, ''), 300)), finished_at = now() WHERE id = p_id;
    RETURN;
  END IF;
  RETURN QUERY UPDATE public.ai_jobs SET status = 'answered', response = r.content::jsonb WHERE id = p_id AND status = 'running' RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.ai_job_submit(text, text, jsonb, jsonb), public.ai_job_claim(bigint) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_job_submit(text, text, jsonb, jsonb), public.ai_job_claim(bigint) TO service_role;
