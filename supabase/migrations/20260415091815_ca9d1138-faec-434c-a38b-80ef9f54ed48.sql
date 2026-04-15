
-- Table to store the expanded RS stock universe (qualified stocks from broader Finnhub scan)
CREATE TABLE public.rs_stock_universe (
  symbol TEXT PRIMARY KEY,
  company_name TEXT,
  market_cap NUMERIC,
  avg_dollar_volume NUMERIC,
  avg_daily_range NUMERIC,
  current_price NUMERIC,
  sector TEXT,
  qualified BOOLEAN DEFAULT true,
  last_scanned TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rs_stock_universe ENABLE ROW LEVEL SECURITY;

-- Public read, public write (same pattern as other tables)
CREATE POLICY "Anyone can read rs_stock_universe" ON public.rs_stock_universe FOR SELECT USING (true);
CREATE POLICY "Anyone can insert rs_stock_universe" ON public.rs_stock_universe FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update rs_stock_universe" ON public.rs_stock_universe FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete rs_stock_universe" ON public.rs_stock_universe FOR DELETE USING (true);

-- Cache table for Yahoo Finance historical data
CREATE TABLE public.yahoo_history_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  period TEXT NOT NULL, -- '1mo', '3mo', '6mo'
  start_price NUMERIC,
  end_price NUMERIC,
  return_pct NUMERIC,
  data_points INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(symbol, period)
);

ALTER TABLE public.yahoo_history_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read yahoo_history_cache" ON public.yahoo_history_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert yahoo_history_cache" ON public.yahoo_history_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update yahoo_history_cache" ON public.yahoo_history_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete yahoo_history_cache" ON public.yahoo_history_cache FOR DELETE USING (true);

-- Index for efficient lookups
CREATE INDEX idx_yahoo_history_symbol_period ON public.yahoo_history_cache(symbol, period);
CREATE INDEX idx_rs_universe_qualified ON public.rs_stock_universe(qualified) WHERE qualified = true;
