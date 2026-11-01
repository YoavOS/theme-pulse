DROP POLICY IF EXISTS "Public delete superperformance" ON public.superperformance_stocks;
DROP POLICY IF EXISTS "Public update superperformance" ON public.superperformance_stocks;
DROP POLICY IF EXISTS "Public write superperformance" ON public.superperformance_stocks;
CREATE POLICY "Signed-in users delete superperformance" ON public.superperformance_stocks FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Signed-in users update superperformance" ON public.superperformance_stocks FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Signed-in users insert superperformance" ON public.superperformance_stocks FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.superperformance_stocks TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.superperformance_stocks FROM anon;