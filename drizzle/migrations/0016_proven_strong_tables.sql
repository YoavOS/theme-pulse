-- Proven-Strong (phase 1): multi-year record of returns on capital vs the industry's cost of capital.
-- Filled by the proven-strength edge function (nightly batch; its pg_cron job is set up separately).

CREATE TABLE IF NOT EXISTS public.proven_strength (
  symbol            text PRIMARY KEY,
  cik               integer,
  status            text NOT NULL,              -- ok | not_sec_filer | no_annual_filings | error
  error             text,
  as_of             date,                       -- latest fiscal year-end used
  last_10k_filed    text,
  track             text,                       -- standard | cyclical | financial | capital_light | young
  label             text,                       -- elite | proven | proven_caveat | fading | provisional | emerging | emerging_early | was_strong | not_proven | insufficient
  sentence          text,
  why               text,
  years_valid       smallint,
  years_above       smallint,
  median_spread     double precision,           -- recency-weighted, pp
  min_pooled_spread double precision,
  cum_ep            double precision,
  spread_slope      double precision,           -- pp per year, last 5 years
  hurdle            double precision,
  hurdle_source     text,
  industry          text,                       -- Damodaran industry
  archetype         text,
  archetypes        text[],
  flags             text[],
  checks            jsonb,
  gates             jsonb,
  series            jsonb,                      -- [{end, spread, primary, margin, turnover}] oldest → newest
  score             smallint,
  calc_version      smallint NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proven_strength_label_idx ON public.proven_strength (label);
CREATE INDEX IF NOT EXISTS proven_strength_computed_idx ON public.proven_strength (computed_at);

CREATE TABLE IF NOT EXISTS public.company_year_metrics (
  symbol        text NOT NULL,
  fy_end        date NOT NULL,
  filed         text,
  revenue       double precision,
  nopat         double precision,
  invested_capital double precision,
  roic          double precision,
  roic_rd       double precision,
  roic_ex_gw    double precision,
  primary_roic  double precision,
  hurdle        double precision,
  spread        double precision,
  economic_profit double precision,
  pooled3       double precision,
  margin        double precision,
  turnover      double precision,
  gross_margin  double precision,
  op_margin     double precision,
  fcf           double precision,
  rnd_rev       double precision,
  sbc_rev       double precision,
  reinvest      double precision,
  coverage      double precision,
  nd_ebitda     double precision,
  roe           double precision,
  rev_growth    double precision,
  shares        double precision,
  calc_version  smallint NOT NULL,
  PRIMARY KEY (symbol, fy_end)
);

GRANT ALL ON public.proven_strength, public.company_year_metrics TO service_role;
GRANT SELECT ON public.proven_strength, public.company_year_metrics TO anon, authenticated;

ALTER TABLE public.proven_strength ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_year_metrics ENABLE ROW LEVEL SECURITY;

-- Computed from public SEC filings; reading is fine. Writes: service role only (no policy).
DROP POLICY IF EXISTS "Read proven strength" ON public.proven_strength;
CREATE POLICY "Read proven strength" ON public.proven_strength FOR SELECT USING (true);
DROP POLICY IF EXISTS "Read company year metrics" ON public.company_year_metrics;
CREATE POLICY "Read company year metrics" ON public.company_year_metrics FOR SELECT USING (true);
