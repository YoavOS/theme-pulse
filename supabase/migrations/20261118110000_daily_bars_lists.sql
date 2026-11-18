-- Daily price history kept on your PC (about 5 years per stock), and the lists built from it every
-- night: 21 EMA pullbacks after a big run, and stocks / groups bought on red market days.

CREATE TABLE IF NOT EXISTS public.daily_bars (
  symbol text NOT NULL,
  d      date NOT NULL,
  o real, h real, l real, c real,
  v bigint,
  PRIMARY KEY (symbol, d)
);
CREATE INDEX IF NOT EXISTS daily_bars_d ON public.daily_bars (d);
ALTER TABLE public.daily_bars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_bars read" ON public.daily_bars;
CREATE POLICY "daily_bars read" ON public.daily_bars FOR SELECT USING (true);
GRANT SELECT ON public.daily_bars TO anon, authenticated;

-- per-symbol fetch bookkeeping
CREATE TABLE IF NOT EXISTS public.daily_bars_state (
  symbol     text PRIMARY KEY,
  first_d    date,
  last_d     date,
  checked_at timestamptz,
  error      text
);
ALTER TABLE public.daily_bars_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "daily_bars_state read" ON public.daily_bars_state;
CREATE POLICY "daily_bars_state read" ON public.daily_bars_state FOR SELECT USING (true);
GRANT SELECT ON public.daily_bars_state TO anon, authenticated;

-- The last US session whose daily bar is final (16:30 New York or later; weekends skipped).
CREATE OR REPLACE FUNCTION public.last_closed_session() RETURNS date LANGUAGE sql STABLE AS $$
  WITH ny AS (SELECT (now() AT TIME ZONE 'America/New_York') AS t),
  base AS (SELECT CASE WHEN t::time >= time '16:30' THEN t::date ELSE t::date - 1 END AS d FROM ny)
  SELECT CASE extract(isodow FROM d)::int WHEN 6 THEN d - 1 WHEN 7 THEN d - 2 ELSE d END FROM base;
$$;

-- Symbols whose history should be fetched: the universe, your theme stocks, the index ETFs.
CREATE OR REPLACE VIEW public.daily_bars_targets AS
  SELECT symbol FROM public.qualified_rs_universe
  UNION SELECT upper(ticker_symbol) FROM public.theme_tickers
  UNION SELECT unnest(ARRAY['SPY','QQQ','IWM','DIA','SMH','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC']);

-- Symbols still missing the last closed session (a holiday or a dead symbol is re-checked after 6 hours).
CREATE OR REPLACE FUNCTION public.daily_bars_due(max_n int DEFAULT 5000)
RETURNS TABLE(symbol text, last_d date) LANGUAGE sql STABLE AS $$
  SELECT t.symbol, s.last_d FROM public.daily_bars_targets t
  LEFT JOIN public.daily_bars_state s USING (symbol)
  WHERE (s.last_d IS NULL OR s.last_d < public.last_closed_session())
    AND (s.checked_at IS NULL OR s.checked_at < now() - interval '6 hours')
  ORDER BY s.last_d NULLS FIRST, t.symbol
  LIMIT max_n;
$$;

-- The lists. One row per stock (or group) per list per day; ai_line / ai_line_he are written by the AI.
CREATE TABLE IF NOT EXISTS public.today_list (
  day        date NOT NULL,
  list       text NOT NULL,          -- ema21 | redday | redday_group
  symbol     text NOT NULL,          -- ticker, or the group's name for redday_group
  rank       int,
  grp        text,
  score      real,
  evidence   jsonb,
  ai_line    text,
  ai_line_he text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, list, symbol)
);
ALTER TABLE public.today_list ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "today_list read" ON public.today_list;
CREATE POLICY "today_list read" ON public.today_list FOR SELECT USING (true);
GRANT SELECT ON public.today_list TO anon, authenticated;

-- How past list entries did afterwards (5 / 10 / 20 sessions later, against SPY): the lists grade themselves.
CREATE OR REPLACE VIEW public.today_list_outcomes AS
WITH x AS (
  SELECT tl.day, tl.list, tl.symbol, b0.c AS c0,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = tl.symbol AND b.d > tl.day ORDER BY b.d OFFSET 4 LIMIT 1) AS c5,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = tl.symbol AND b.d > tl.day ORDER BY b.d OFFSET 9 LIMIT 1) AS c10,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = tl.symbol AND b.d > tl.day ORDER BY b.d OFFSET 19 LIMIT 1) AS c20,
    s0.c AS s0,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = 'SPY' AND b.d > tl.day ORDER BY b.d OFFSET 4 LIMIT 1) AS s5,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = 'SPY' AND b.d > tl.day ORDER BY b.d OFFSET 9 LIMIT 1) AS s10,
    (SELECT b.c FROM public.daily_bars b WHERE b.symbol = 'SPY' AND b.d > tl.day ORDER BY b.d OFFSET 19 LIMIT 1) AS s20
  FROM public.today_list tl
  JOIN public.daily_bars b0 ON b0.symbol = tl.symbol AND b0.d = tl.day
  LEFT JOIN public.daily_bars s0 ON s0.symbol = 'SPY' AND s0.d = tl.day
  WHERE tl.list <> 'redday_group'
)
SELECT day, list, symbol,
  round((100 * (c5 / c0 - 1))::numeric, 2)  AS ret5,  round((100 * (c5 / c0 - s5 / s0))::numeric, 2)  AS vs_spy5,
  round((100 * (c10 / c0 - 1))::numeric, 2) AS ret10, round((100 * (c10 / c0 - s10 / s0))::numeric, 2) AS vs_spy10,
  round((100 * (c20 / c0 - 1))::numeric, 2) AS ret20, round((100 * (c20 / c0 - s20 / s0))::numeric, 2) AS vs_spy20
FROM x;
GRANT SELECT ON public.today_list_outcomes TO anon, authenticated;

-- The last n bars of several symbols as arrays (oldest first) — one row per symbol, for the list builder.
CREATE OR REPLACE FUNCTION public.bars_arrays(syms text[], n int DEFAULT 260)
RETURNS TABLE(symbol text, d date[], h real[], l real[], c real[], v bigint[])
LANGUAGE sql STABLE AS $$
  SELECT x.symbol, array_agg(x.d ORDER BY x.d), array_agg(x.h ORDER BY x.d), array_agg(x.l ORDER BY x.d), array_agg(x.c ORDER BY x.d), array_agg(x.v ORDER BY x.d)
  FROM (
    SELECT b.symbol, b.d, b.h, b.l, b.c, b.v, row_number() OVER (PARTITION BY b.symbol ORDER BY b.d DESC) rn
    FROM public.daily_bars b WHERE b.symbol = ANY(syms)
  ) x WHERE x.rn <= n GROUP BY x.symbol;
$$;
GRANT EXECUTE ON FUNCTION public.bars_arrays(text[], int) TO service_role;
