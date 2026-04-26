-- ── stock_fundamentals: per-ticker pulled fundamentals ──
CREATE TABLE IF NOT EXISTS public.stock_fundamentals (
  symbol text PRIMARY KEY,
  company_name text,
  sector text,
  market_cap numeric,
  price numeric,

  -- Growth (EPS)
  eps_ttm_yoy numeric,
  eps_annual_yoy numeric,
  eps_quarterly_yoy numeric,
  eps_quarterly_qoq numeric,

  -- Growth (Revenue)
  revenue_ttm_yoy numeric,
  revenue_annual_yoy numeric,
  revenue_quarterly_yoy numeric,
  revenue_quarterly_qoq numeric,

  -- Valuation
  pe_ratio numeric,
  forward_pe numeric,
  peg_ratio numeric,
  ps_ratio numeric,
  pb_ratio numeric,

  -- Profitability
  gross_margin numeric,
  net_margin numeric,
  operating_margin numeric,
  roe numeric,
  roa numeric,

  -- Financial health
  debt_to_equity numeric,
  current_ratio numeric,

  -- Source flags / metadata
  source_eps text,           -- e.g. 'yahoo' | 'finnhub' | 'mixed'
  source_revenue text,
  source_valuation text,
  raw_yahoo jsonb,
  raw_finnhub jsonb,

  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_fundamentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read stock_fundamentals" ON public.stock_fundamentals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert stock_fundamentals" ON public.stock_fundamentals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update stock_fundamentals" ON public.stock_fundamentals FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete stock_fundamentals" ON public.stock_fundamentals FOR DELETE USING (true);

CREATE TRIGGER update_stock_fundamentals_updated_at
BEFORE UPDATE ON public.stock_fundamentals
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── fundamentals_scan_queue ──
CREATE TABLE IF NOT EXISTS public.fundamentals_scan_queue (
  symbol text PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed | skipped
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fund_scan_queue_status ON public.fundamentals_scan_queue (status);

ALTER TABLE public.fundamentals_scan_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read fund_scan_queue" ON public.fundamentals_scan_queue FOR SELECT USING (true);
CREATE POLICY "Anyone can insert fund_scan_queue" ON public.fundamentals_scan_queue FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update fund_scan_queue" ON public.fundamentals_scan_queue FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete fund_scan_queue" ON public.fundamentals_scan_queue FOR DELETE USING (true);

-- ── fundamentals_scan_progress (single row id=1) ──
CREATE TABLE IF NOT EXISTS public.fundamentals_scan_progress (
  id integer PRIMARY KEY DEFAULT 1,
  status text NOT NULL DEFAULT 'idle',  -- idle | running | paused | complete
  total_queued integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  last_updated timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.fundamentals_scan_progress (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.fundamentals_scan_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read fund_scan_progress" ON public.fundamentals_scan_progress FOR SELECT USING (true);
CREATE POLICY "Anyone can insert fund_scan_progress" ON public.fundamentals_scan_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update fund_scan_progress" ON public.fundamentals_scan_progress FOR UPDATE USING (true);

-- ── cron toggle helper ──
CREATE OR REPLACE FUNCTION public.set_fundamentals_cron_active(p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'process-fundamentals-queue-every-minute'
  LIMIT 1;

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'cron job process-fundamentals-queue-every-minute not found';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, active := p_active);
END;
$$;