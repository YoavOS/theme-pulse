-- Fundamentals Lens phase 2: Aswath Damodaran's industry averages (NYU Stern, January data).
-- Loaded once a year by the damodaran-benchmarks edge function (its pg_cron job is set up separately).

CREATE TABLE IF NOT EXISTS public.damodaran_benchmarks (
  source_year   integer NOT NULL,
  industry      text NOT NULL,
  metric        text NOT NULL,
  value         double precision NOT NULL,
  unit          text NOT NULL,
  n_firms       integer,
  source_file   text NOT NULL,
  source_column text,
  as_of         text,
  loaded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_year, industry, metric)
);

CREATE TABLE IF NOT EXISTS public.damodaran_tickers (
  symbol       text PRIMARY KEY,
  industry     text NOT NULL,
  company      text,
  source_year  integer NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.damodaran_loads (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  source_year  integer,
  ok           boolean NOT NULL DEFAULT false,
  report       jsonb
);

GRANT ALL ON public.damodaran_benchmarks, public.damodaran_tickers, public.damodaran_loads TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.damodaran_loads_id_seq TO service_role;
GRANT SELECT ON public.damodaran_benchmarks TO anon, authenticated;

ALTER TABLE public.damodaran_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damodaran_tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damodaran_loads ENABLE ROW LEVEL SECURITY;

-- Industry averages are public data; reading them is fine. Writes: service role only (no policy).
DROP POLICY IF EXISTS "Read damodaran benchmarks" ON public.damodaran_benchmarks;
CREATE POLICY "Read damodaran benchmarks" ON public.damodaran_benchmarks FOR SELECT USING (true);
