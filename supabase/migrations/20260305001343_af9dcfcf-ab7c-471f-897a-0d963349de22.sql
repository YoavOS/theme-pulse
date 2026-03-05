CREATE TABLE public.full_update_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_theme_index integer NOT NULL DEFAULT 0,
  total_themes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle',
  last_updated timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.full_update_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read progress" ON public.full_update_progress FOR SELECT USING (true);
CREATE POLICY "Anyone can insert progress" ON public.full_update_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update progress" ON public.full_update_progress FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete progress" ON public.full_update_progress FOR DELETE USING (true);

-- Seed a single row
INSERT INTO public.full_update_progress (last_theme_index, total_themes, status) VALUES (0, 0, 'idle');