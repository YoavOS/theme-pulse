CREATE TABLE IF NOT EXISTS public.ticker_performance (
  symbol text PRIMARY KEY,
  perf_1d numeric NOT NULL DEFAULT 0,
  perf_1w numeric NOT NULL DEFAULT 0,
  perf_1m numeric NOT NULL DEFAULT 0,
  perf_3m numeric NOT NULL DEFAULT 0,
  perf_ytd numeric NOT NULL DEFAULT 0,
  price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  last_scanned timestamptz
);

GRANT SELECT ON public.ticker_performance TO anon, authenticated;
GRANT ALL ON public.ticker_performance TO service_role;

ALTER TABLE public.ticker_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read ticker_performance"
  ON public.ticker_performance FOR SELECT
  USING (true);
