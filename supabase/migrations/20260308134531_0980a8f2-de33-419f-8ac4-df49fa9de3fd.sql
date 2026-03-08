
CREATE TABLE IF NOT EXISTS public.volume_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  theme_name TEXT NOT NULL,
  week_ending DATE NOT NULL,
  sustained_vol_pct NUMERIC,
  avg_rel_vol NUMERIC,
  UNIQUE(theme_name, week_ending)
);

ALTER TABLE public.volume_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read volume_history" ON public.volume_history FOR SELECT USING (true);
CREATE POLICY "Anyone can insert volume_history" ON public.volume_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update volume_history" ON public.volume_history FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete volume_history" ON public.volume_history FOR DELETE USING (true);
