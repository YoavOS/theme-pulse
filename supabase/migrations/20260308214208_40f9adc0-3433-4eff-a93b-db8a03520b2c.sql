CREATE TABLE IF NOT EXISTS public.news_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT,
  category TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  source TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  ai_summary TEXT,
  ai_summary_theme TEXT,
  ai_summary_generated_at TIMESTAMPTZ,
  UNIQUE(url)
);

ALTER TABLE public.news_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read news_cache" ON public.news_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can insert news_cache" ON public.news_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update news_cache" ON public.news_cache FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete news_cache" ON public.news_cache FOR DELETE USING (true);