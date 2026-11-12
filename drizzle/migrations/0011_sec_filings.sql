-- SEC filing feed (research PR 2):
-- 1) sec_filings: every 10-Q / 10-K / 20-F / 40-F and Form 4 filed by a stock in the universe,
--    read nightly from EDGAR's free daily index by the sec-filings-watch function.
--    superperf-refresh rescores a stock as soon as a new periodic report lands (that is when SEC
--    publishes the new quarter's numbers — often weeks after the earnings date).
-- 2) insider_trades: open-market purchases (P) and sales (S) parsed from those Form 4s.
-- 3) sec_index_days: which daily index files were already read.

CREATE TABLE IF NOT EXISTS public.sec_filings (
  accession   text PRIMARY KEY,
  symbol      text NOT NULL,
  cik         bigint NOT NULL,
  form        text NOT NULL,
  filed       date NOT NULL,
  path        text NOT NULL,
  parsed      boolean NOT NULL DEFAULT false,   -- Form 4: transactions read
  parse_error text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sec_filings_symbol_filed_idx ON public.sec_filings (symbol, filed DESC);
CREATE INDEX IF NOT EXISTS sec_filings_pending_idx ON public.sec_filings (filed DESC) WHERE form = '4' AND parsed = false;

CREATE TABLE IF NOT EXISTS public.insider_trades (
  accession    text NOT NULL,
  line         smallint NOT NULL,
  symbol       text NOT NULL,
  owner        text NOT NULL,
  owner_cik    bigint,
  title        text,
  is_director  boolean NOT NULL DEFAULT false,
  is_officer   boolean NOT NULL DEFAULT false,
  is_ten_pct   boolean NOT NULL DEFAULT false,
  code         text NOT NULL,                    -- P = open-market purchase, S = open-market sale
  trade_date   date,
  shares       numeric,
  price        numeric,
  value        numeric,
  plan_10b5_1  boolean NOT NULL DEFAULT false,
  filed        date NOT NULL,
  PRIMARY KEY (accession, line)
);
CREATE INDEX IF NOT EXISTS insider_trades_symbol_date_idx ON public.insider_trades (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS insider_trades_code_date_idx ON public.insider_trades (code, trade_date DESC);

CREATE TABLE IF NOT EXISTS public.sec_index_days (
  day          date PRIMARY KEY,
  status       text NOT NULL,                    -- ok | missing (weekend / holiday)
  rows_kept    integer NOT NULL DEFAULT 0,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sec_filings, public.insider_trades, public.sec_index_days TO anon, authenticated;
GRANT ALL ON public.sec_filings, public.insider_trades, public.sec_index_days TO service_role;
ALTER TABLE public.sec_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insider_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sec_index_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read sec filings" ON public.sec_filings;
CREATE POLICY "Read sec filings" ON public.sec_filings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Read insider trades" ON public.insider_trades;
CREATE POLICY "Read insider trades" ON public.insider_trades FOR SELECT USING (true);
DROP POLICY IF EXISTS "Read sec index days" ON public.sec_index_days;
CREATE POLICY "Read sec index days" ON public.sec_index_days FOR SELECT USING (true);