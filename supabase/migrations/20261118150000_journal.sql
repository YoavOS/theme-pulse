-- Trading journal for the AI review: each trade with WHY it was taken (setup, thesis, conviction, what would
-- prove it wrong). Personal and local, so the app reads and writes it directly.
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol       text NOT NULL,
  entry_date   date NOT NULL,
  entry_price  numeric,
  exit_date    date,
  exit_price   numeric,
  setup        text,          -- ema21 | breakout | other
  thesis       text,          -- why I'm entering
  conviction   smallint,      -- 1..5
  invalidation text,          -- what would prove me wrong
  notes        text,
  source       text NOT NULL DEFAULT 'manual',   -- manual | positions | import
  source_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "journal all" ON public.journal_entries;
CREATE POLICY "journal all" ON public.journal_entries FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO anon, authenticated;
GRANT ALL ON public.journal_entries TO service_role;
