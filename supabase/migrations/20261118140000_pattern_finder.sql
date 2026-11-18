-- Pattern finder: what did stocks look like before big moves? Code finds and tests, the AI explains.
-- 1. pattern-finder (edge function) turns the daily price history into samples: every 5th session per stock,
--    11 traits (distance from the 21 EMA, run size, RS vs SPY, distance from the high, trend, tightening,
--    volume dry-up, up/down volume, strength on red days, stage-2 trend, industry strength) and what happened next.
-- 2. mine_patterns() bins every trait into fifths (thresholds from the older 70% of dates only), counts big
--    winners for every single trait and every pair of traits on the older period, and checks each on the newer
--    30% it never saw. A pattern counts only if it also held up there.
-- Honest limit: only stocks in today's universe are in the history (no delisted stocks) — results lean optimistic.

CREATE TABLE IF NOT EXISTS public.pattern_samples (
  symbol   text NOT NULL,
  d        date NOT NULL,
  industry text,
  f        real[] NOT NULL,          -- traits 0..9 (trait 10, industry strength, is added by mine_patterns)
  win      boolean,                  -- rose ≥ 30% (best close) within the next 60 sessions; null = too recent to know
  fwd20    real,                     -- return over the next 20 sessions minus SPY's (points)
  PRIMARY KEY (symbol, d)
);
CREATE INDEX IF NOT EXISTS pattern_samples_d ON public.pattern_samples (d);
CREATE TABLE IF NOT EXISTS public.pattern_progress (symbol text PRIMARY KEY, last_bar date, done_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pattern_runs (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  split_date  date,
  thresholds  jsonb,                 -- per trait: the 4 cut points of its fifths
  base_train  real, base_test real, n_train int, n_test int,
  ai_text     text, ai_text_he text, ai_model text
);
CREATE TABLE IF NOT EXISTS public.pattern_rules (
  run_id     bigint NOT NULL REFERENCES public.pattern_runs(id) ON DELETE CASCADE,
  a int, abin int, b int, bbin int,  -- trait index and fifth (1..5); b is null for single-trait rules
  n_train int, rate_train real, n_test int, rate_test real,
  lift_train real, lift_test real, fwd20_test real,
  held boolean
);
CREATE INDEX IF NOT EXISTS pattern_rules_run ON public.pattern_rules (run_id, held, lift_test DESC);
ALTER TABLE public.pattern_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pattern_runs read" ON public.pattern_runs;
CREATE POLICY "pattern_runs read" ON public.pattern_runs FOR SELECT USING (true);
DROP POLICY IF EXISTS "pattern_rules read" ON public.pattern_rules;
CREATE POLICY "pattern_rules read" ON public.pattern_rules FOR SELECT USING (true);
GRANT SELECT ON public.pattern_runs, public.pattern_rules TO anon, authenticated;
GRANT ALL ON public.pattern_samples, public.pattern_progress, public.pattern_runs, public.pattern_rules TO service_role;
GRANT USAGE ON SEQUENCE public.pattern_runs_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.mine_patterns(min_n int DEFAULT 300) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = 0 AS $$
DECLARE
  split date; rid bigint; th jsonb := '[]'::jsonb; k int; cuts real[]; allc real[] := '{}';
  btrain real; btest real; ntr int; nte int;
BEGIN
  SELECT percentile_disc(0.7) WITHIN GROUP (ORDER BY d) INTO split FROM public.pattern_samples WHERE win IS NOT NULL;
  IF split IS NULL THEN RAISE EXCEPTION 'no samples yet'; END IF;

  -- trait 10: industry strength — where the stock's industry ranks that day by median RS (trait 2)
  CREATE TEMP TABLE ps ON COMMIT DROP AS
  WITH ind AS (
    SELECT d, industry, percentile_cont(0.5) WITHIN GROUP (ORDER BY f[3]) AS med
    FROM public.pattern_samples WHERE industry IS NOT NULL GROUP BY d, industry HAVING count(*) >= 3
  ), r AS (SELECT d, industry, percent_rank() OVER (PARTITION BY d ORDER BY med) * 100 AS rk FROM ind)
  SELECT s.symbol, s.d, s.win, s.fwd20, s.f || ARRAY[coalesce(r.rk, 'NaN'::real)::real] AS f, (s.d <= split) AS train
  FROM public.pattern_samples s LEFT JOIN r ON r.d = s.d AND r.industry = s.industry;

  -- fifths from the training period only
  FOR k IN 1..11 LOOP
    SELECT ARRAY[percentile_cont(0.2) WITHIN GROUP (ORDER BY f[k]), percentile_cont(0.4) WITHIN GROUP (ORDER BY f[k]),
                 percentile_cont(0.6) WITHIN GROUP (ORDER BY f[k]), percentile_cont(0.8) WITHIN GROUP (ORDER BY f[k])]::real[]
      INTO cuts FROM ps WHERE train AND win IS NOT NULL AND f[k] <> 'NaN'::real;
    th := th || jsonb_build_array(to_jsonb(cuts));
    allc := allc || cuts;
  END LOOP;

  CREATE TEMP TABLE pb ON COMMIT DROP AS
  SELECT train, win, fwd20,
    ARRAY(SELECT CASE WHEN f[kk] = 'NaN'::real OR f[kk] IS NULL THEN 0
                      ELSE width_bucket(f[kk], allc[(kk - 1) * 4 + 1 : kk * 4]) + 1 END
          FROM generate_series(1, 11) kk) AS b
  FROM ps WHERE win IS NOT NULL;

  SELECT avg(win::int) FILTER (WHERE train), avg(win::int) FILTER (WHERE NOT train), count(*) FILTER (WHERE train), count(*) FILTER (WHERE NOT train)
    INTO btrain, btest, ntr, nte FROM pb;
  INSERT INTO public.pattern_runs(split_date, thresholds, base_train, base_test, n_train, n_test)
    VALUES (split, th, btrain, btest, ntr, nte) RETURNING id INTO rid;

  -- single traits
  INSERT INTO public.pattern_rules(run_id, a, abin, n_train, rate_train, n_test, rate_test, fwd20_test)
  SELECT rid, kk, b[kk], count(*) FILTER (WHERE train), avg(win::int) FILTER (WHERE train),
         count(*) FILTER (WHERE NOT train), avg(win::int) FILTER (WHERE NOT train), avg(fwd20) FILTER (WHERE NOT train)
  FROM pb, generate_series(1, 11) kk WHERE b[kk] > 0 GROUP BY kk, b[kk];
  -- pairs of traits
  INSERT INTO public.pattern_rules(run_id, a, abin, b, bbin, n_train, rate_train, n_test, rate_test, fwd20_test)
  SELECT rid, i, b[i], j, b[j], count(*) FILTER (WHERE train), avg(win::int) FILTER (WHERE train),
         count(*) FILTER (WHERE NOT train), avg(win::int) FILTER (WHERE NOT train), avg(fwd20) FILTER (WHERE NOT train)
  FROM pb, generate_series(1, 10) i, generate_series(2, 11) j WHERE j > i AND b[i] > 0 AND b[j] > 0 GROUP BY i, b[i], j, b[j];

  DELETE FROM public.pattern_rules WHERE run_id = rid AND (n_train < min_n OR n_test < min_n / 3);
  UPDATE public.pattern_rules SET lift_train = rate_train / nullif(btrain, 0), lift_test = rate_test / nullif(btest, 0) WHERE run_id = rid;
  UPDATE public.pattern_rules SET held = (lift_train >= 1.3 AND lift_test >= 1.2) WHERE run_id = rid;
  -- keep only the older runs' summaries small: drop rules of runs before the last 3
  DELETE FROM public.pattern_rules WHERE run_id NOT IN (SELECT id FROM public.pattern_runs ORDER BY id DESC LIMIT 3);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.mine_patterns(int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mine_patterns(int) TO service_role;

-- Today's stocks that match a held-up rule (their latest sample, using that run's fifths).
CREATE OR REPLACE FUNCTION public.pattern_matches(rid bigint, max_rules int DEFAULT 8)
RETURNS TABLE(rule_a int, rule_abin int, rule_b int, rule_bbin int, symbol text, d date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH run AS (SELECT thresholds th FROM public.pattern_runs WHERE id = rid),
  rules AS (SELECT a, abin, b, bbin FROM public.pattern_rules WHERE run_id = rid AND held ORDER BY lift_test DESC LIMIT max_rules),
  latest AS (SELECT DISTINCT ON (symbol) symbol, d, f FROM public.pattern_samples ORDER BY symbol, d DESC),
  binned AS (
    SELECT l.symbol, l.d, ARRAY(SELECT CASE WHEN k > array_length(l.f, 1) OR l.f[k] = 'NaN'::real OR l.f[k] IS NULL THEN 0
      ELSE width_bucket(l.f[k], ARRAY(SELECT (x)::real FROM jsonb_array_elements_text((SELECT th FROM run) -> (k - 1)) x)) + 1 END
      FROM generate_series(1, 11) k) AS b
    FROM latest l WHERE l.d >= (SELECT max(d) FROM public.pattern_samples) - 10
  )
  SELECT r.a, r.abin, r.b, r.bbin, x.symbol, x.d FROM rules r JOIN binned x ON x.b[r.a] = r.abin AND (r.b IS NULL OR x.b[r.b] = r.bbin);
$$;
GRANT EXECUTE ON FUNCTION public.pattern_matches(bigint, int) TO anon, authenticated, service_role;
