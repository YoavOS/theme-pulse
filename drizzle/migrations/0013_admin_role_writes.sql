DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- themes
DROP POLICY IF EXISTS "Authenticated users can create themes" ON public.themes;
DROP POLICY IF EXISTS "Authenticated users can update themes" ON public.themes;
DROP POLICY IF EXISTS "Authenticated users can delete themes" ON public.themes;
CREATE POLICY "Admins create themes" ON public.themes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update themes" ON public.themes FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete themes" ON public.themes FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- theme_tickers
DROP POLICY IF EXISTS "Authenticated users can create tickers" ON public.theme_tickers;
DROP POLICY IF EXISTS "Authenticated users can update tickers" ON public.theme_tickers;
DROP POLICY IF EXISTS "Authenticated users can delete tickers" ON public.theme_tickers;
CREATE POLICY "Admins create tickers" ON public.theme_tickers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update tickers" ON public.theme_tickers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete tickers" ON public.theme_tickers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- superperformance_stocks (service-role policy left unchanged)
DROP POLICY IF EXISTS "Signed-in users insert superperformance" ON public.superperformance_stocks;
DROP POLICY IF EXISTS "Signed-in users update superperformance" ON public.superperformance_stocks;
DROP POLICY IF EXISTS "Signed-in users delete superperformance" ON public.superperformance_stocks;
CREATE POLICY "Admins insert superperformance" ON public.superperformance_stocks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update superperformance" ON public.superperformance_stocks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete superperformance" ON public.superperformance_stocks FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));