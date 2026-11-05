-- Theme stories (the "i" panel): one plain-language narrative per group, refreshed weekly.
CREATE TABLE IF NOT EXISTS public.theme_narratives (
  key text PRIMARY KEY,                 -- "<mode>:<lower-case name>"
  name text NOT NULL,
  mode text NOT NULL,
  story jsonb NOT NULL,
  sources jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.theme_narratives TO anon, authenticated;
GRANT ALL ON public.theme_narratives TO service_role;
ALTER TABLE public.theme_narratives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read theme narratives" ON public.theme_narratives;
CREATE POLICY "Anyone can read theme narratives" ON public.theme_narratives FOR SELECT USING (true);
