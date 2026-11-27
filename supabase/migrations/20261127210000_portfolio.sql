-- Portfolio tab: positions typed in by hand (the same trade_positions rows the AI journal reads),
-- a small settings table, a cache for earnings/news per symbol, and two read functions that give
-- the tab everything the app already knows about a holding (RS, stage, industry, themes, daily bars).

-- 1. Positions: the stop and a target are optional; a short "setup" label next to the notes.
ALTER TABLE public.trade_positions ALTER COLUMN initial_stop DROP NOT NULL;
ALTER TABLE public.trade_positions ADD COLUMN IF NOT EXISTS target numeric;
ALTER TABLE public.trade_positions ADD COLUMN IF NOT EXISTS setup text;
ALTER TABLE public.trade_positions ADD COLUMN IF NOT EXISTS exit_note text;

-- 2. Settings (account size, earnings warning window). Same access rule as the positions.
CREATE TABLE IF NOT EXISTS public.portfolio_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portfolio_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_settings TO authenticated;
GRANT ALL ON public.portfolio_settings TO service_role;
DROP POLICY IF EXISTS "Portfolio settings: all" ON public.portfolio_settings;
CREATE POLICY "Portfolio settings: all" ON public.portfolio_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Earnings / news per symbol, written only by the portfolio-live backend function.
CREATE TABLE IF NOT EXISTS public.portfolio_cache (
  symbol     text NOT NULL,
  kind       text NOT NULL,          -- earnings | news
  data       jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, kind)
);
ALTER TABLE public.portfolio_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.portfolio_cache TO service_role;

-- 4. What the app knows about each symbol: company, industry, RS rating (1–99 across the universe,
--    as on RS Alpha), returns, RS-line highs, stage, themes.
CREATE OR REPLACE FUNCTION public.portfolio_context(syms text[])
RETURNS TABLE(symbol text, company text, sector text, industry text, market_cap numeric, adr_percent numeric,
              rs_overall numeric, rs_rating int, return_1w numeric, return_1m numeric, return_3m numeric,
              rs_nh_20d boolean, rs_nh_6m boolean, stage int, substage text, weeks_in_stage int, themes text[])
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH u AS (
    SELECT q.symbol, q.rs_overall,
           greatest(1, least(99, round(cume_dist() OVER (ORDER BY q.rs_overall) * 99)))::int AS rating
    FROM public.qualified_rs_universe q WHERE q.rs_overall IS NOT NULL
  ), s AS (SELECT DISTINCT upper(x) AS symbol FROM unnest(syms) x)
  SELECT s.symbol,
         coalesce(q.company_name, c.company_name),
         coalesce(c.sector, q.sector),
         c.industry,
         q.market_cap::numeric, q.adr_percent::numeric,
         q.rs_overall::numeric, u.rating,
         q.return_1w::numeric, q.return_1m::numeric, q.return_3m::numeric,
         q.rs_nh_20d, q.rs_nh_6m,
         st.stage::int, st.substage, st.weeks_in_stage::int,
         (SELECT array_agg(DISTINCT t.name ORDER BY t.name) FROM public.theme_tickers tt JOIN public.themes t ON t.id = tt.theme_id
           WHERE upper(tt.ticker_symbol) = s.symbol)
  FROM s
  LEFT JOIN public.qualified_rs_universe q ON q.symbol = s.symbol
  LEFT JOIN u ON u.symbol = s.symbol
  LEFT JOIN public.ticker_classification c ON c.symbol = s.symbol
  LEFT JOIN public.stock_stages st ON st.symbol = s.symbol;
$$;
GRANT EXECUTE ON FUNCTION public.portfolio_context(text[]) TO anon, authenticated;

-- 5. The last n daily bars per symbol as arrays (one row per symbol — no row limits in the way).
CREATE OR REPLACE FUNCTION public.portfolio_bars(syms text[], n int DEFAULT 260)
RETURNS TABLE(symbol text, d date[], o real[], h real[], l real[], c real[], v bigint[])
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH r AS (
    SELECT b.*, row_number() OVER (PARTITION BY b.symbol ORDER BY b.d DESC) AS rn
    FROM public.daily_bars b WHERE b.symbol = ANY(syms)
  )
  SELECT r.symbol, array_agg(r.d ORDER BY r.d), array_agg(r.o ORDER BY r.d), array_agg(r.h ORDER BY r.d),
         array_agg(r.l ORDER BY r.d), array_agg(r.c ORDER BY r.d), array_agg(r.v ORDER BY r.d)
  FROM r WHERE r.rn <= greatest(20, least(n, 1300)) GROUP BY r.symbol;
$$;
GRANT EXECUTE ON FUNCTION public.portfolio_bars(text[], int) TO anon, authenticated;

-- 6. Nightly daily-bar downloads also cover what you hold (even outside the universe and themes).
CREATE OR REPLACE VIEW public.daily_bars_targets AS
  SELECT symbol FROM public.qualified_rs_universe
  UNION SELECT upper(ticker_symbol) FROM public.theme_tickers
  UNION SELECT upper(symbol) FROM public.trade_positions WHERE status = 'open'
  UNION SELECT unnest(ARRAY['SPY','QQQ','IWM','DIA','SMH','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC']);
