-- ─────────────────────────────────────────────────────────────
-- Weinstein Stage Analysis — latest stage per stock (one row each).
-- Written by the `stage-scan` edge function (Full Scan / Scan Stages).
-- "Keep only the latest scan": each scan overwrites rows and removes
-- symbols that are no longer in the stock list. ~1.5k short rows.
-- `history` = confirmed stage of the last ≤52 completed weeks
-- (oldest→newest, "1".."4" or "T"), used for the market chart and
-- 4-week changes — so no separate history table is needed.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_stages (
  symbol            text PRIMARY KEY,
  stage             smallint NOT NULL,          -- 0 = transition / uncertain
  substage          text NOT NULL,
  confidence        smallint NOT NULL,
  quality           text,                       -- HIGH | MIXED | LOW (fresh Stage 2 only)
  event             text,                       -- e.g. "1→2"
  event_kind        text,                       -- BREAKOUT | BREAKDOWN | RESUMPTION | FAILED_BASE | TREND | RANGE
  event_weeks_ago   smallint,
  weeks_in_stage    smallint,
  last_directional  smallint,
  history           text,
  features          jsonb,
  reasons           text[],
  as_of             date NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_stages_stage_idx ON public.stock_stages (stage);

ALTER TABLE public.stock_stages ENABLE ROW LEVEL SECURITY;

-- Read-only for the app; only the edge function (service role) writes.
DROP POLICY IF EXISTS "Read stock stages" ON public.stock_stages;
CREATE POLICY "Read stock stages" ON public.stock_stages FOR SELECT USING (true);
