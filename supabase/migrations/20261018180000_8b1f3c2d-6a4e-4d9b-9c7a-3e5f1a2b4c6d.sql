-- ─────────────────────────────────────────────────────────────
-- Trade Desk — the signed-in user's own positions (open and closed).
-- The app computes stops, R multiples, exit checks and portfolio heat
-- from these rows; nothing else reads them. One row per position.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trade_positions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  symbol        text NOT NULL,
  entry_date    date NOT NULL,
  entry_price   numeric NOT NULL,
  shares        numeric NOT NULL,
  initial_stop  numeric NOT NULL,
  stop          numeric,                    -- current stop (user-managed)
  status        text NOT NULL DEFAULT 'open', -- open | closed
  exit_date     date,
  exit_price    numeric,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 1. Privileges: signed-in users manage their own rows (RLS below); the service role has full access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_positions TO authenticated;
GRANT ALL ON public.trade_positions TO service_role;

-- 2. Row level security
ALTER TABLE public.trade_positions ENABLE ROW LEVEL SECURITY;

-- 3. Policies: each user sees and changes only their own positions.
DROP POLICY IF EXISTS "Own positions: select" ON public.trade_positions;
CREATE POLICY "Own positions: select" ON public.trade_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own positions: insert" ON public.trade_positions;
CREATE POLICY "Own positions: insert" ON public.trade_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own positions: update" ON public.trade_positions;
CREATE POLICY "Own positions: update" ON public.trade_positions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Own positions: delete" ON public.trade_positions;
CREATE POLICY "Own positions: delete" ON public.trade_positions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4. Index
CREATE INDEX IF NOT EXISTS trade_positions_user_idx ON public.trade_positions (user_id, status);
