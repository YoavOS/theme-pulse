CREATE TABLE public.superperformance_stocks (
  symbol TEXT PRIMARY KEY,
  minervini_score INTEGER NOT NULL,
  last_scanned TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.superperformance_stocks TO anon, authenticated;
GRANT ALL ON public.superperformance_stocks TO service_role;

ALTER TABLE public.superperformance_stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read superperformance"
  ON public.superperformance_stocks FOR SELECT
  USING (true);

CREATE POLICY "Service role manages superperformance"
  ON public.superperformance_stocks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_superperformance_score ON public.superperformance_stocks (minervini_score DESC);