CREATE TABLE IF NOT EXISTS public.rs_history_snapshots (

  day date PRIMARY KEY,

  source text NOT NULL CHECK (source IN ('live', 'rebuilt')),

  data jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()

);

GRANT SELECT ON public.rs_history_snapshots TO anon, authenticated;

GRANT ALL ON public.rs_history_snapshots TO service_role;

ALTER TABLE public.rs_history_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read rs history" ON public.rs_history_snapshots;

CREATE POLICY "Anyone can read rs history" ON public.rs_history_snapshots FOR SELECT USING (true);