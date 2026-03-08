CREATE TABLE IF NOT EXISTS public.fundamentals_cache (
  symbol TEXT PRIMARY KEY,
  revenue_growth_1y NUMERIC,
  revenue_growth_3y NUMERIC,
  eps_growth_1y NUMERIC,
  eps_growth_3y NUMERIC,
  gross_margin NUMERIC,
  net_margin NUMERIC,
  roe NUMERIC,
  roa NUMERIC,
  debt_to_equity NUMERIC,
  current_ratio NUMERIC,
  cash_per_share NUMERIC,
  free_cash_flow NUMERIC,
  target_high NUMERIC,
  target_low NUMERIC,
  target_mean NUMERIC,
  analyst_rating TEXT,
  market_cap NUMERIC,
  sector TEXT,
  stock_type TEXT,
  fundamental_score NUMERIC,
  ai_summary TEXT,
  last_updated TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.fundamentals_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read fundamentals_cache" ON public.fundamentals_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert fundamentals_cache" ON public.fundamentals_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update fundamentals_cache" ON public.fundamentals_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete fundamentals_cache" ON public.fundamentals_cache FOR DELETE USING (true);