
-- Create themes table
CREATE TABLE public.themes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create theme_tickers table
CREATE TABLE public.theme_tickers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  theme_id UUID NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
  ticker_symbol TEXT NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(theme_id, ticker_symbol)
);

-- Enable RLS
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_tickers ENABLE ROW LEVEL SECURITY;

-- Public read access (dashboard is public)
CREATE POLICY "Anyone can read themes"
ON public.themes FOR SELECT
USING (true);

CREATE POLICY "Anyone can read theme_tickers"
ON public.theme_tickers FOR SELECT
USING (true);

-- Only authenticated users can manage themes
CREATE POLICY "Authenticated users can create themes"
ON public.themes FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update themes"
ON public.themes FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete themes"
ON public.themes FOR DELETE
TO authenticated
USING (true);

-- Only authenticated users can manage tickers
CREATE POLICY "Authenticated users can create tickers"
ON public.theme_tickers FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update tickers"
ON public.theme_tickers FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete tickers"
ON public.theme_tickers FOR DELETE
TO authenticated
USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_themes_updated_at
BEFORE UPDATE ON public.themes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
