
CREATE TABLE IF NOT EXISTS public.last_scan_cache (
  id integer PRIMARY KEY DEFAULT 1,
  themes_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  timeframe text NOT NULL DEFAULT 'Today',
  symbols_fetched integer DEFAULT 0
);

ALTER TABLE public.last_scan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read last_scan_cache" ON public.last_scan_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert last_scan_cache" ON public.last_scan_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update last_scan_cache" ON public.last_scan_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete last_scan_cache" ON public.last_scan_cache FOR DELETE USING (true);

-- Seed with empty row
INSERT INTO public.last_scan_cache (id, themes_data, timeframe) VALUES (1, '[]'::jsonb, 'Today') ON CONFLICT (id) DO NOTHING;
