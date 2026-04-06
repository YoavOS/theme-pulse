CREATE TABLE IF NOT EXISTS public.alert_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  triggered_at TIMESTAMPTZ DEFAULT now(),
  date DATE NOT NULL,
  theme_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  value_before NUMERIC,
  value_after NUMERIC,
  threshold NUMERIC,
  ticker_symbol TEXT,
  metadata JSONB
);

ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read alert_history" ON public.alert_history FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert alert_history" ON public.alert_history FOR INSERT TO public WITH CHECK (true);

CREATE INDEX idx_alert_history_date ON public.alert_history (date DESC);
CREATE INDEX idx_alert_history_type ON public.alert_history (alert_type);
CREATE INDEX idx_alert_history_theme ON public.alert_history (theme_name);
CREATE INDEX idx_alert_history_triggered ON public.alert_history (triggered_at DESC);