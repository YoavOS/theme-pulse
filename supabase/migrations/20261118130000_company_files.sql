-- "From the filings": the text of each company's latest 10-K (business, risk factors, management's
-- discussion), last year's risk factors, and the latest earnings release — and what the AI read in them.
CREATE TABLE IF NOT EXISTS public.filing_texts (
  symbol      text PRIMARY KEY,
  cik         integer,
  tenk_acc    text, tenk_filed date, tenk_url text,
  prev_acc    text, prev_filed date,
  release_acc text, release_filed date, release_url text,
  business    text, risks text, mdna text, release text,
  risks_added text[], risks_removed text[],
  rpo         jsonb,             -- contracted revenue not yet recognised (backlog), recent values
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.company_files (
  symbol     text NOT NULL,
  lang       text NOT NULL DEFAULT 'en',
  tenk_acc   text,
  release_acc text,
  data       jsonb,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, lang)
);
ALTER TABLE public.filing_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_files read" ON public.company_files;
CREATE POLICY "company_files read" ON public.company_files FOR SELECT USING (true);
GRANT SELECT ON public.company_files TO anon, authenticated;
GRANT ALL ON public.filing_texts, public.company_files TO service_role;

-- "The long story": a long, readable walk through a company's numbers, written by the AI from the Lens facts.
CREATE TABLE IF NOT EXISTS public.long_stories (
  symbol      text NOT NULL,
  lang        text NOT NULL,
  facts_at    text,              -- the Lens computation it was written from
  content     text,
  model       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, lang)
);
ALTER TABLE public.long_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "long_stories read" ON public.long_stories;
CREATE POLICY "long_stories read" ON public.long_stories FOR SELECT USING (true);
GRANT SELECT ON public.long_stories TO anon, authenticated;
GRANT ALL ON public.long_stories TO service_role;
