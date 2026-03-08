
-- Core historical price store
CREATE TABLE IF NOT EXISTS eod_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  theme_name TEXT NOT NULL,
  date DATE NOT NULL,
  close_price NUMERIC(12,4) NOT NULL,
  open_price NUMERIC(12,4),
  high_price NUMERIC(12,4),
  low_price NUMERIC(12,4),
  volume BIGINT,
  source TEXT DEFAULT 'finnhub_quote',
  is_backfill BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_eod_symbol_date ON eod_prices(symbol, date DESC);
CREATE INDEX IF NOT EXISTS idx_eod_date ON eod_prices(date DESC);
CREATE INDEX IF NOT EXISTS idx_eod_theme ON eod_prices(theme_name, date DESC);

-- Track EOD save sessions
CREATE TABLE IF NOT EXISTS eod_save_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_tickers INT,
  saved_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  failed_symbols TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'in_progress',
  UNIQUE(date)
);

-- RLS policies for eod_prices (public read/write for now)
ALTER TABLE eod_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read eod_prices" ON eod_prices FOR SELECT USING (true);
CREATE POLICY "Anyone can insert eod_prices" ON eod_prices FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update eod_prices" ON eod_prices FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete eod_prices" ON eod_prices FOR DELETE USING (true);

-- RLS policies for eod_save_sessions
ALTER TABLE eod_save_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read eod_save_sessions" ON eod_save_sessions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert eod_save_sessions" ON eod_save_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update eod_save_sessions" ON eod_save_sessions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete eod_save_sessions" ON eod_save_sessions FOR DELETE USING (true);

-- RPC function for bulk timeframe performance calculation
-- Given today's date and symbols, returns the closest baseline close_price for each timeframe
CREATE OR REPLACE FUNCTION get_eod_baselines(
  p_symbols TEXT[],
  p_date_1w DATE,
  p_date_1m DATE,
  p_date_3m DATE,
  p_date_ytd DATE
)
RETURNS TABLE(
  symbol TEXT,
  timeframe TEXT,
  baseline_date DATE,
  close_price NUMERIC(12,4)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 1W baselines: closest date on or before p_date_1w
  (
    SELECT DISTINCT ON (e.symbol)
      e.symbol, '1W'::text as timeframe, e.date as baseline_date, e.close_price
    FROM eod_prices e
    WHERE e.symbol = ANY(p_symbols)
      AND e.date <= p_date_1w
    ORDER BY e.symbol, e.date DESC
  )
  UNION ALL
  -- 1M baselines
  (
    SELECT DISTINCT ON (e.symbol)
      e.symbol, '1M'::text as timeframe, e.date as baseline_date, e.close_price
    FROM eod_prices e
    WHERE e.symbol = ANY(p_symbols)
      AND e.date <= p_date_1m
    ORDER BY e.symbol, e.date DESC
  )
  UNION ALL
  -- 3M baselines
  (
    SELECT DISTINCT ON (e.symbol)
      e.symbol, '3M'::text as timeframe, e.date as baseline_date, e.close_price
    FROM eod_prices e
    WHERE e.symbol = ANY(p_symbols)
      AND e.date <= p_date_3m
    ORDER BY e.symbol, e.date DESC
  )
  UNION ALL
  -- YTD baselines
  (
    SELECT DISTINCT ON (e.symbol)
      e.symbol, 'YTD'::text as timeframe, e.date as baseline_date, e.close_price
    FROM eod_prices e
    WHERE e.symbol = ANY(p_symbols)
      AND e.date <= p_date_ytd
    ORDER BY e.symbol, e.date DESC
  );
$$;
