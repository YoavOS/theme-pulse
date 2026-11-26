BEGIN;
CREATE TABLE IF NOT EXISTS public.company_financial_cache (
  symbol text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_financial_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_financial_cache FROM anon, authenticated;
GRANT ALL ON public.company_financial_cache TO service_role;
COMMENT ON TABLE public.company_financial_cache IS 'Compact parsed SEC snapshot shared by Lens and Proven; no credentials or personal data.';
CREATE OR REPLACE VIEW public.industry_reality AS
WITH latest AS (
 SELECT DISTINCT ON(symbol) symbol,nopat,invested_capital,revenue,rev_growth FROM public.company_year_metrics ORDER BY symbol,fy_end DESC
), grouped AS (
 SELECT p.industry,count(*) n,sum(u.market_cap)*1000000.0 cap,sum(l.nopat) nopat,sum(l.invested_capital) capital,
 percentile_cont(0.5) WITHIN GROUP(ORDER BY l.rev_growth) med_growth,avg(p.hurdle) hurdle
 FROM public.proven_strength p JOIN latest l USING(symbol) JOIN public.qualified_rs_universe u USING(symbol)
 WHERE p.status='ok' AND p.track IS DISTINCT FROM 'financial' AND p.industry IS NOT NULL AND u.market_cap>0 AND l.invested_capital>0
 GROUP BY p.industry HAVING count(*)>=4
), g AS (
 SELECT *,100*(nopat-cap*hurdle/100)/nullif(capital-cap,0) solution FROM grouped
)
SELECT industry,n::int,round((cap/1e9)::numeric,1) cap_b,round((nopat/1e9)::numeric,2) nopat_b,
 round((100*nopat/nullif(capital,0))::numeric,1) roic,round(hurdle::numeric,1) cost_of_capital,
 round((100*nopat/nullif(cap,0))::numeric,2) earnings_yield,round(med_growth::numeric,1) median_revenue_growth,
 CASE WHEN nopat>0 AND solution > -100 AND solution < least(hurdle,4.2) AND solution <= 100*nopat/nullif(capital,0)
 THEN round(solution::numeric,1) END implied_growth,
 CASE WHEN nopat<=0 OR solution IS NULL THEN 'insufficient earnings'
 WHEN solution <= -100 OR solution >= least(hurdle,4.2) OR solution > 100*nopat/nullif(capital,0) THEN 'outside stable-growth model'
 ELSE 'within model bounds' END model_status
FROM g;
GRANT SELECT ON public.industry_reality TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
