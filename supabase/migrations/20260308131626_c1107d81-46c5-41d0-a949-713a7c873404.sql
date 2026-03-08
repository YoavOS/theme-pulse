CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_ending DATE NOT NULL UNIQUE,
  narrative TEXT NOT NULL,
  top_themes JSONB,
  bottom_themes JSONB,
  biggest_reversals JSONB,
  volume_anomalies JSONB,
  generated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read weekly_reports" ON public.weekly_reports FOR SELECT USING (true);
CREATE POLICY "Anyone can insert weekly_reports" ON public.weekly_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update weekly_reports" ON public.weekly_reports FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete weekly_reports" ON public.weekly_reports FOR DELETE USING (true);