-- Local AI: saved reports, and a safe read-only query door for the AI analyst.

CREATE TABLE IF NOT EXISTS public.ai_reports (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                 -- 'nightly' | 'stock' | 'focus' | 'chat'
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  lang text NOT NULL DEFAULT 'en',
  subject text,                       -- ticker for 'stock'
  title text,
  content text NOT NULL,
  data jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reports_kind_day ON public.ai_reports (kind, day DESC, lang);
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_reports readable" ON public.ai_reports;
CREATE POLICY "ai_reports readable" ON public.ai_reports FOR SELECT USING (true);

-- Runs one SELECT for the AI analyst and returns the rows as JSON. Anything the query might change
-- is undone: the work happens inside a block that is always rolled back.
CREATE OR REPLACE FUNCTION public.ai_readonly_query(q text, max_rows int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb;
  clean text := btrim(coalesce(q, ''), E' \n\t\r;');
BEGIN
  IF clean !~* '^(select|with)\s' THEN RAISE EXCEPTION 'Only SELECT (or WITH … SELECT) queries are allowed'; END IF;
  IF position(';' IN clean) > 0 THEN RAISE EXCEPTION 'One statement only'; END IF;
  IF clean ~* '\m(pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir|copy)\M' THEN RAISE EXCEPTION 'That function is not allowed here'; END IF;
  PERFORM set_config('statement_timeout', '20000', true);
  BEGIN
    EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) AS q LIMIT %s) AS t', clean, greatest(1, least(max_rows, 500))) INTO r;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__ai_rollback__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ai_rollback__' THEN RAISE; END IF;
  END;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ai_readonly_query(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_readonly_query(text, int) TO service_role;
