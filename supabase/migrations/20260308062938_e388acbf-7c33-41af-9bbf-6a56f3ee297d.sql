
CREATE TABLE public.ticker_performance (
  symbol text PRIMARY KEY,
  perf_1d double precision DEFAULT 0,
  perf_1w double precision DEFAULT 0,
  perf_1m double precision DEFAULT 0,
  perf_3m double precision DEFAULT 0,
  perf_ytd double precision DEFAULT 0,
  price double precision DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  last_scanned timestamp with time zone DEFAULT now()
);

ALTER TABLE public.ticker_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ticker_performance" ON public.ticker_performance FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ticker_performance" ON public.ticker_performance FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ticker_performance" ON public.ticker_performance FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete ticker_performance" ON public.ticker_performance FOR DELETE USING (true);
