-- ─────────────────────────────────────────────────────────────
-- Permanent per-ticker industry classification
-- (Sector → Industry → Sub-Industry, GICS-style names).
--
-- Filled progressively by the `classify-tickers` edge function:
--   FMP → Yahoo → Finnhub → Alpha Vantage (≤24/day) → Groq (last resort).
-- A ticker is looked up once; good results are kept forever.
-- Survives "Update Stock List" scans (not part of the universe swap).
-- Size: one short row per ticker (~1–2k rows, well under 1 MB).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticker_classification (
  symbol        text PRIMARY KEY,
  sector        text,
  industry      text,
  sub_industry  text,
  source        text,            -- fmp | yahoo | finnhub | alphavantage | groq
  raw_label     text,            -- the provider label we mapped from
  quality       text,            -- exact | fuzzy | ai | partial
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'needs_av', 'needs_ai', 'done', 'failed')),
  tried         text[] NOT NULL DEFAULT '{}',
  company_name  text,
  description   text,            -- short business summary, kept only until AI step finishes
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticker_classification_status_idx
  ON public.ticker_classification (status);

ALTER TABLE public.ticker_classification ENABLE ROW LEVEL SECURITY;

-- Read-only for the app. Only the edge function (service role) writes.
DROP POLICY IF EXISTS "Read ticker classification" ON public.ticker_classification;
CREATE POLICY "Read ticker classification"
  ON public.ticker_classification FOR SELECT USING (true);

-- Daily call counters so free-tier caps (Alpha Vantage 25/day, FMP 250/day) are respected.
CREATE TABLE IF NOT EXISTS public.classification_usage (
  day     date NOT NULL,
  source  text NOT NULL,
  calls   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);

ALTER TABLE public.classification_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read classification usage" ON public.classification_usage;
CREATE POLICY "Read classification usage"
  ON public.classification_usage FOR SELECT USING (true);

-- Copy finished classifications into the live universe so every existing
-- view (RS Alpha, pies, analyzer, exports…) picks them up with no extra queries.
-- Called after each classifier batch and after every universe swap.
CREATE OR REPLACE FUNCTION public.sync_universe_classification()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.qualified_rs_universe q
     SET sector = c.sub_industry
    FROM public.ticker_classification c
   WHERE c.symbol = q.symbol
     AND c.status = 'done'
     AND c.sub_industry IS NOT NULL
     AND q.sector IS DISTINCT FROM c.sub_industry;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_universe_classification() FROM anon, authenticated, PUBLIC;
