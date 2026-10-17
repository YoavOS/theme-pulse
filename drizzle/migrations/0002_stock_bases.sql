-- ─────────────────────────────────────────────────────────────
-- Base Scanner — latest base candidate per stock (one row each).
-- Written by the `stage-scan` edge function in the same pass as the
-- Weinstein stages (no extra API calls). "Keep only the latest scan":
-- rows not refreshed by a scan are removed. Only stocks with a
-- qualifying base are stored (typically a few hundred short rows).
-- score / state / labels are filled by the scan's finalize step, which
-- applies the cross-sectional 26-week RS percentile.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_bases (
  symbol          text PRIMARY KEY,
  score           smallint,                   -- 0–100 Generic Base Ranker (null until finalized)
  band            text,                       -- prime | qualified | developing | research
  state           text,                       -- ready | qualified | developing | watch | triggered | extended | failed
  primary_label   text,                       -- htf | vcp | cup | double_bottom | ascending | flat | box | generic
  labels          text[],
  tier            smallint,                   -- alert tier 1 / 2
  rs_pct          smallint,                   -- 26-week RS percentile across the whole stock list
  pivot           numeric,
  support         numeric,
  dist_to_pivot   numeric,                    -- % below the pivot (negative = above)
  stop_risk       numeric,                    -- % from pivot to support
  features        jsonb NOT NULL,             -- all raw measurements (see _shared/baseEngine.ts)
  breakdown       jsonb,                      -- score components
  warnings        text[],
  earnings_date   date,
  as_of           date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 1. Privileges: the app reads; only the edge function (service role) writes.
GRANT SELECT ON public.stock_bases TO anon, authenticated;
GRANT ALL ON public.stock_bases TO service_role;

-- 2. Row level security
ALTER TABLE public.stock_bases ENABLE ROW LEVEL SECURITY;

-- 3. Policies: read-only for the app.
DROP POLICY IF EXISTS "Read stock bases" ON public.stock_bases;
CREATE POLICY "Read stock bases" ON public.stock_bases FOR SELECT USING (true);

-- 4. Index
CREATE INDEX IF NOT EXISTS stock_bases_score_idx ON public.stock_bases (score DESC);
