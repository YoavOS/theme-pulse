CREATE TABLE IF NOT EXISTS public.theme_breadth_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  theme_name TEXT NOT NULL,
  date DATE NOT NULL,
  advancing INT,
  declining INT,
  total INT,
  breadth_pct NUMERIC,
  UNIQUE(theme_name, date)
);

ALTER TABLE public.theme_breadth_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read theme_breadth_history" ON public.theme_breadth_history FOR SELECT USING (true);
CREATE POLICY "Anyone can insert theme_breadth_history" ON public.theme_breadth_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update theme_breadth_history" ON public.theme_breadth_history FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete theme_breadth_history" ON public.theme_breadth_history FOR DELETE USING (true);