GRANT INSERT, UPDATE, DELETE ON public.superperformance_stocks TO anon, authenticated;

CREATE POLICY "Public write superperformance"
  ON public.superperformance_stocks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update superperformance"
  ON public.superperformance_stocks FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "Public delete superperformance"
  ON public.superperformance_stocks FOR DELETE
  USING (true);