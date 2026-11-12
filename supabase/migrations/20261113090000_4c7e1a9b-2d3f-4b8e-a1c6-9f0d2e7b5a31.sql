-- Fundamentals Lens caches (written and read only by the fundamentals-lens edge function,
-- which uses the service role). RLS on with no policies = no access from the browser.

CREATE TABLE IF NOT EXISTS public.lens_cache (
  symbol      text PRIMARY KEY,
  payload     jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lens_explanations (
  symbol         text NOT NULL,
  concept_id     text NOT NULL,
  facts_hash     text NOT NULL,
  prompt_version smallint NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, concept_id, facts_hash, prompt_version)
);

GRANT ALL ON public.lens_cache, public.lens_explanations TO service_role;
ALTER TABLE public.lens_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lens_explanations ENABLE ROW LEVEL SECURITY;
