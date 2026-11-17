-- Labs: experimental features you can switch on and off, with a count of how often each is used,
-- so unused ones can be removed after a trial.
CREATE TABLE IF NOT EXISTS public.app_features (
  id         text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  uses       integer NOT NULL DEFAULT 0,
  first_used timestamptz,
  last_used  timestamptz,
  added_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_features read" ON public.app_features;
CREATE POLICY "app_features read" ON public.app_features FOR SELECT USING (true);
GRANT SELECT ON public.app_features TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lab_touch(fid text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.app_features(id, uses, first_used, last_used) VALUES (left(fid, 60), 1, now(), now())
  ON CONFLICT (id) DO UPDATE SET uses = app_features.uses + 1, last_used = now(),
    first_used = coalesce(app_features.first_used, now());
$$;
CREATE OR REPLACE FUNCTION public.lab_set(fid text, on_ boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.app_features(id, enabled) VALUES (left(fid, 60), on_)
  ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled;
$$;
GRANT EXECUTE ON FUNCTION public.lab_touch(text), public.lab_set(text, boolean) TO anon, authenticated;
