
DROP POLICY IF EXISTS "Authenticated users can create themes" ON public.themes;
DROP POLICY IF EXISTS "Authenticated users can update themes" ON public.themes;
DROP POLICY IF EXISTS "Authenticated users can delete themes" ON public.themes;

CREATE POLICY "Authenticated users can create themes" ON public.themes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update themes" ON public.themes
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete themes" ON public.themes
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can create tickers" ON public.theme_tickers;
DROP POLICY IF EXISTS "Authenticated users can update tickers" ON public.theme_tickers;
DROP POLICY IF EXISTS "Authenticated users can delete tickers" ON public.theme_tickers;

CREATE POLICY "Authenticated users can create tickers" ON public.theme_tickers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update tickers" ON public.theme_tickers
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete tickers" ON public.theme_tickers
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
