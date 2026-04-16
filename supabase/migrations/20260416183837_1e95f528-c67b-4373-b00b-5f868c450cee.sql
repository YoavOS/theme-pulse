-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop old tables
DROP TABLE IF EXISTS public.rs_stock_universe CASCADE;
DROP TABLE IF EXISTS public.yahoo_history_cache CASCADE;

-- Queue of symbols to scan
CREATE TABLE public.stock_scan_queue (
  symbol TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX idx_stock_scan_queue_status ON public.stock_scan_queue(status);

ALTER TABLE public.stock_scan_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scan queue" ON public.stock_scan_queue FOR SELECT USING (true);
CREATE POLICY "Anyone can insert scan queue" ON public.stock_scan_queue FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update scan queue" ON public.stock_scan_queue FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete scan queue" ON public.stock_scan_queue FOR DELETE USING (true);

-- Qualified universe (stocks that passed all 4 filters)
CREATE TABLE public.qualified_rs_universe (
  symbol TEXT PRIMARY KEY,
  company_name TEXT,
  sector TEXT,
  market_cap NUMERIC,            -- in millions (Finnhub units)
  current_price NUMERIC,
  avg_dollar_volume NUMERIC,     -- 30d avg, in dollars
  adr_percent NUMERIC,           -- 14d Average Daily Range %
  adr_source TEXT,               -- 'ohlc' or 'approximated'
  -- RS scores (filled by calculate-rs-scores)
  return_1d NUMERIC,
  return_1m NUMERIC,
  return_3m NUMERIC,
  return_6m NUMERIC,
  spy_return_1d NUMERIC,
  spy_return_1m NUMERIC,
  spy_return_3m NUMERIC,
  spy_return_6m NUMERIC,
  rs_1d NUMERIC,
  rs_1m NUMERIC,
  rs_3m NUMERIC,
  rs_6m NUMERIC,
  rs_overall NUMERIC,
  rs_calculated_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qualified_rs_overall ON public.qualified_rs_universe(rs_overall DESC NULLS LAST);

ALTER TABLE public.qualified_rs_universe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read qualified universe" ON public.qualified_rs_universe FOR SELECT USING (true);
CREATE POLICY "Anyone can insert qualified universe" ON public.qualified_rs_universe FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update qualified universe" ON public.qualified_rs_universe FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete qualified universe" ON public.qualified_rs_universe FOR DELETE USING (true);

-- Progress tracker (single row)
CREATE TABLE public.rs_scan_progress (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_queued INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle', -- idle | running | complete
  started_at TIMESTAMPTZ,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO public.rs_scan_progress (id) VALUES (1);

ALTER TABLE public.rs_scan_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scan progress" ON public.rs_scan_progress FOR SELECT USING (true);
CREATE POLICY "Anyone can update scan progress" ON public.rs_scan_progress FOR UPDATE USING (true);
CREATE POLICY "Anyone can insert scan progress" ON public.rs_scan_progress FOR INSERT WITH CHECK (true);

-- Recreate yahoo_history_cache with OHLC support
CREATE TABLE public.yahoo_history_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,           -- '1mo' | '3mo' | '6mo'
  start_price NUMERIC,
  end_price NUMERIC,
  return_pct NUMERIC,
  data_points INTEGER,
  ohlc JSONB,                     -- optional array of {h,l,c} for ADR%
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(symbol, period)
);
CREATE INDEX idx_yahoo_cache_symbol_period ON public.yahoo_history_cache(symbol, period);

ALTER TABLE public.yahoo_history_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read yahoo cache" ON public.yahoo_history_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert yahoo cache" ON public.yahoo_history_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update yahoo cache" ON public.yahoo_history_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete yahoo cache" ON public.yahoo_history_cache FOR DELETE USING (true);

-- Schedule the worker every minute
SELECT cron.schedule(
  'process-universe-queue-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhdvcqidyntxvwhyygxx.supabase.co/functions/v1/process-universe-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoZHZjcWlkeW50eHZ3aHl5Z3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0ODk3NzQsImV4cCI6MjA4ODA2NTc3NH0.UgTXXp8fXLGH-j96NnqevuommYZHa25UNAQNyQP3PFg"}'::jsonb,
    body := '{"trigger": "cron"}'::jsonb
  );
  $$
);