-- Damodaran, the remaining pieces: how rare a proven track record is (calibration), how often an edge
-- lasts (fade rates), look-alikes with honest base rates, and what each industry is priced for.
-- All built from company_year_metrics (≈10 annual 10-K years per company) and proven_strength.
-- Honest limit everywhere: only companies listed today are in the data, so failed companies are missing
-- and every "kept its edge" rate here is somewhat too optimistic (survivorship bias).

-- 1. Fade rates: of company-years with a given record, how many still earned above their cost of capital later.
CREATE TABLE IF NOT EXISTS public.fade_rates (
  above5     smallint NOT NULL,   -- years above the cost of capital in the 5 years up to then (0..5)
  level      text NOT NULL,       -- median spread of the last 3 years: below | 0-5 | 5-15 | 15+
  n3 int, kept3 real,             -- still above 3 years later (% of n3)
  n5 int, kept5 real,             -- still above 5 years later
  most5 real,                     -- above in at least 4 of the next 5 years (% of n5)
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (above5, level)
);
ALTER TABLE public.fade_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fade_rates read" ON public.fade_rates;
CREATE POLICY "fade_rates read" ON public.fade_rates FOR SELECT USING (true);
GRANT SELECT ON public.fade_rates TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_fade_rates() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.fade_rates;
  WITH y AS (
    SELECT symbol, fy_end, spread FROM public.company_year_metrics WHERE spread IS NOT NULL
  ), prof AS (
    SELECT symbol,
      sum((spread > 0)::int) OVER w5 AS above5, count(*) OVER w5 AS have5,
      -- median of 3 = sum − max − min
      CASE WHEN count(*) OVER w3 = 3 THEN sum(spread) OVER w3 - max(spread) OVER w3 - min(spread) OVER w3 END AS med3,
      lead(spread, 3) OVER o AS s3, lead(spread, 5) OVER o AS s5,
      sum((spread > 0)::int) OVER nx AS next_above, count(*) OVER nx AS next_have
    FROM y
    WINDOW o AS (PARTITION BY symbol ORDER BY fy_end),
      w5 AS (o ROWS BETWEEN 4 PRECEDING AND CURRENT ROW),
      w3 AS (o ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
      nx AS (o ROWS BETWEEN 1 FOLLOWING AND 5 FOLLOWING)
  ), b AS (
    SELECT above5::smallint above5,
      CASE WHEN med3 < 0 THEN 'below' WHEN med3 < 5 THEN '0-5' WHEN med3 < 15 THEN '5-15' ELSE '15+' END AS level, s3, s5, next_above, next_have
    FROM prof WHERE have5 = 5
  )
  INSERT INTO public.fade_rates(above5, level, n3, kept3, n5, kept5, most5)
  SELECT above5, level,
    count(s3), round((100.0 * count(*) FILTER (WHERE s3 > 0) / nullif(count(s3), 0))::numeric, 1),
    count(s5), round((100.0 * count(*) FILTER (WHERE s5 > 0) / nullif(count(s5), 0))::numeric, 1),
    round((100.0 * count(*) FILTER (WHERE next_have = 5 AND next_above >= 4) / nullif(count(*) FILTER (WHERE next_have = 5), 0))::numeric, 1)
  FROM b GROUP BY 1, 2;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.refresh_fade_rates() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_fade_rates() TO service_role;

-- 2. Calibration: how rare each label is, overall and by industry.
CREATE OR REPLACE VIEW public.proven_calibration AS
SELECT coalesce(industry, '(all)') AS industry, label, count(*)::int AS n,
  round((100.0 * count(*) / sum(count(*)) OVER (PARTITION BY coalesce(industry, '(all)')))::numeric, 1) AS pct
FROM public.proven_strength WHERE status = 'ok'
GROUP BY GROUPING SETS ((label), (industry, label));
GRANT SELECT ON public.proven_calibration TO anon, authenticated;

-- "7 of 10" — the open question from the plan: of companies with 8+ valid years, how many beat their cost of capital in ≥ 70% of them.
CREATE OR REPLACE VIEW public.proven_rarity AS
SELECT count(*)::int AS companies,
  count(*) FILTER (WHERE years_above::numeric / nullif(years_valid, 0) >= 0.7)::int AS above_70pct,
  round((100.0 * count(*) FILTER (WHERE years_above::numeric / nullif(years_valid, 0) >= 0.7) / nullif(count(*), 0))::numeric, 1) AS pct_above_70pct,
  round((100.0 * count(*) FILTER (WHERE years_above = years_valid) / nullif(count(*), 0))::numeric, 1) AS pct_every_year,
  round((100.0 * count(*) FILTER (WHERE years_above = 0) / nullif(count(*), 0))::numeric, 1) AS pct_never
FROM public.proven_strength WHERE status = 'ok' AND years_valid >= 8;
GRANT SELECT ON public.proven_rarity TO anon, authenticated;

-- 3. What each industry is priced for (Damodaran's "big market delusion" check, at the industry level).
-- Using the latest 10-K year of every member in the universe: total after-tax operating profit (NOPAT),
-- total capital, total market value. The growth the whole industry must deliver forever to justify its
-- price solves  value = NOPAT × (1 − g / ROIC) / (cost of capital − g).
-- Simplifications: market cap stands in for enterprise value (debt and cash ignored), and only the
-- liquid US-listed members are counted.
CREATE OR REPLACE VIEW public.industry_reality AS
WITH latest AS (
  SELECT DISTINCT ON (m.symbol) m.symbol, m.nopat, m.invested_capital, m.revenue, m.rev_growth
  FROM public.company_year_metrics m ORDER BY m.symbol, m.fy_end DESC
), g AS (
  SELECT p.industry, count(*) AS n,
    sum(u.market_cap) AS cap, sum(l.nopat) AS nopat, sum(l.invested_capital) AS capital, sum(l.revenue) AS revenue,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rev_growth) AS med_growth,
    avg(p.hurdle) AS hurdle
  FROM public.proven_strength p
  JOIN latest l USING (symbol)
  JOIN public.qualified_rs_universe u USING (symbol)
  WHERE p.status = 'ok' AND p.industry IS NOT NULL AND u.market_cap > 0 AND l.invested_capital > 0
  GROUP BY p.industry HAVING count(*) >= 4
)
SELECT industry, n::int, round((cap / 1e9)::numeric, 1) AS cap_b, round((nopat / 1e9)::numeric, 2) AS nopat_b,
  round((100 * nopat / nullif(capital, 0))::numeric, 1) AS roic,
  round((hurdle)::numeric, 1) AS cost_of_capital,
  round((100 * nopat / nullif(cap, 0))::numeric, 2) AS earnings_yield,
  round(med_growth::numeric, 1) AS median_revenue_growth,
  CASE WHEN nopat > 0 AND capital > 0 THEN
    round((100 * (nopat - cap * hurdle / 100) / nullif(nopat / (nopat / capital) - cap, 0))::numeric, 1)
  END AS implied_growth
FROM g;
GRANT SELECT ON public.industry_reality TO anon, authenticated;

-- 4. Look-alikes (computed nightly by proven-lookalikes).
CREATE TABLE IF NOT EXISTS public.lookalikes (
  symbol     text NOT NULL,
  mode       text NOT NULL,      -- now: like a proven company today | before: like a proven company looked years ago
  rank       smallint NOT NULL,
  peer       text NOT NULL,
  peer_year  date,
  distance   real,
  peer_label text,
  shared     jsonb,              -- the traits that match most closely
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, mode, rank)
);
CREATE TABLE IF NOT EXISTS public.lookalike_base (
  symbol       text PRIMARY KEY,
  as_of        date,
  k            int,              -- most similar past company-years with a known 5-year outcome
  kept_pct     real,             -- of those, % above the cost of capital in ≥ 4 of the next 5 years
  strong_pct   real,             -- % with a median spread of 10+ points over the next 5 years
  all_kept_pct real,             -- the same for every past company-year (the unconditional rate)
  computed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lookalikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lookalike_base ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lookalikes read" ON public.lookalikes;
CREATE POLICY "lookalikes read" ON public.lookalikes FOR SELECT USING (true);
DROP POLICY IF EXISTS "lookalike_base read" ON public.lookalike_base;
CREATE POLICY "lookalike_base read" ON public.lookalike_base FOR SELECT USING (true);
GRANT SELECT ON public.lookalikes, public.lookalike_base TO anon, authenticated;
GRANT ALL ON public.lookalikes, public.lookalike_base TO service_role;
