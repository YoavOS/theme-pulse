-- Fresh earnings: sec-filings-watch now records every listed company's 10-Q / 10-K / 20-F / 40-F (not only
-- the universe on the night they were filed), so stocks added to the universe later still have their
-- latest report on record. Days read by the old version are read once more (version < 2).
-- (Never applied before this edit; the cron-history purge was dropped — the platform doesn't allow it,
-- and disk is billed on the provisioned size, so it would save nothing.)
ALTER TABLE public.sec_index_days ADD COLUMN IF NOT EXISTS version smallint NOT NULL DEFAULT 1;
