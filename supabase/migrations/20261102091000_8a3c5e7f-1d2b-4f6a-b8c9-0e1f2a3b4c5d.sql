-- Market breadth for Stage Analysis: the S&P 1500 (S&P 500 + 400 + 600), classified weekly
-- with the same stage engine as the stock list (light rows: weekly bars only).
CREATE TABLE IF NOT EXISTS public.market_universe (
  symbol text PRIMARY KEY,
  name text,
  gics_sector text,
  gics_sub text,
  idx text,                             -- '500' | '400' | '600'
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.market_stages (
  symbol text PRIMARY KEY,
  stage smallint NOT NULL,
  substage text,
  confidence smallint,
  quality text,
  event text,
  event_kind text,
  event_weeks_ago integer,
  weeks_in_stage integer,
  history text,
  features jsonb,
  as_of date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_universe TO anon, authenticated;
GRANT ALL ON public.market_universe TO service_role;
GRANT SELECT ON public.market_stages TO anon, authenticated;
GRANT ALL ON public.market_stages TO service_role;
ALTER TABLE public.market_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read market universe" ON public.market_universe;
CREATE POLICY "Anyone can read market universe" ON public.market_universe FOR SELECT USING (true);
DROP POLICY IF EXISTS "Anyone can read market stages" ON public.market_stages;
CREATE POLICY "Anyone can read market stages" ON public.market_stages FOR SELECT USING (true);
