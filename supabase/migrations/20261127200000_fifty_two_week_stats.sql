-- 52-week highs and lows straight from the daily prices kept on the PC (daily_bars), so the
-- New Highs / New Lows panel no longer downloads a year of Yahoo history per stock each time.
-- One row per symbol with at least 20 bars in the last 366 days. Dates are final daily bars only;
-- the app adds today's session from Yahoo for stocks close to a high or low.
CREATE OR REPLACE FUNCTION public.fifty_two_week_stats(syms text[])
RETURNS TABLE(symbol text, high52w real, low52w real, latest_close real, last_high_d date, last_low_d date, as_of date, fresh boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH b AS (
    SELECT db.symbol, db.d, db.h, db.l, db.c
    FROM public.daily_bars db
    WHERE db.symbol = ANY(syms) AND db.d >= current_date - 366 AND db.h > 0
  ), w AS (
    SELECT b.*,
           max(b.h) OVER s AS hi,
           min(b.l) FILTER (WHERE b.l > 0) OVER s AS lo,
           count(*) OVER s AS n,
           row_number() OVER (PARTITION BY b.symbol ORDER BY b.d DESC) AS rn
    FROM b WINDOW s AS (PARTITION BY b.symbol)
  )
  SELECT w.symbol,
         max(w.hi),
         max(w.lo),
         max(w.c) FILTER (WHERE w.rn = 1),
         max(w.d) FILTER (WHERE w.h >= w.hi * 0.9995),
         max(w.d) FILTER (WHERE w.l > 0 AND w.l <= w.lo * 1.0005),
         max(w.d),
         max(w.d) >= public.last_closed_session()
  FROM w
  WHERE w.n >= 20
  GROUP BY w.symbol;
$$;

GRANT EXECUTE ON FUNCTION public.fifty_two_week_stats(text[]) TO anon, authenticated;
