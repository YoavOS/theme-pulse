
CREATE TABLE public.ticker_volume_cache (
  symbol TEXT NOT NULL PRIMARY KEY,
  today_vol BIGINT DEFAULT 0,
  avg_20d BIGINT DEFAULT 0,
  avg_10d BIGINT DEFAULT 0,
  avg_3m BIGINT DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.ticker_volume_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ticker_volume_cache" ON public.ticker_volume_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ticker_volume_cache" ON public.ticker_volume_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ticker_volume_cache" ON public.ticker_volume_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete ticker_volume_cache" ON public.ticker_volume_cache FOR DELETE USING (true);
