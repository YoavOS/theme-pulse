# Theme Pulse — project notes for AI sessions

Read this first; then query the code map (`graphify query "<question>"`, `graphify explain "<symbol>"`) instead of opening whole files.
The map is rebuilt with `graphify update .` (local, no LLM). Output: `graphify-out/` (git-ignored).

## Working rules (from the owner)
- Personal app, runs on the owner's Windows PC (Docker Desktop + Supabase CLI). Not on the internet.
- Never read `.env`, `local/keys.env` or any secret. API keys stay on the PC.
- Never push or merge `main`. Work on a `claude/...` branch, open PRs via `gh api` (no GraphQL); the owner merges.
  Check a PR isn't merged before pushing to its branch.
- No buy/sell language about tickers. Hebrew text: natural, gender-neutral toward the reader.
- The owner is a fundamentals beginner; teach Damodaran's ideas in the app's own words, with links.
- Only free AI: Ollama on the PC (default `qwen3.8:27b`, 32 GB GPU), cloud free keys (Gemini/Groq) as fallback.
- New AI features live in the **AI Analyst** tab first, with usage counts (`app_features`), and get moved/removed after a trial.
- The owner prefers results that "come to them" (lists, notifications), not badges.
- Trading style: 21 EMA pullbacks after a big run (~40–50% since last EMA touch, alert zone ~0.4 ADR) and breakouts.

## Running locally
- Owner's folder: `C:\Users\yoavp\theme-pulse-local` (synced from this repo file by file; the Lens Hebrew branch is included).
- `Start Theme Pulse.bat` → `local/Start-ThemePulse.ps1`: Docker, `supabase start`, `migration up --local`, `local/setup-local.sql`
  (local scheduler + settings), daily data dump, Ollama check/pull (`local/ai.env`), functions serve, Vite on :8080.
- The local edge runtime stops a request after ~1 minute. Long PC-model calls go through the database:
  `ai_job_submit` → pg_net → Ollama (15 min) → `ai_job_claim` → the function's finisher (`_shared/aiJobs.ts`).
  The page polls `{action:"job", id}`; cron `local-ai-jobs` finishes jobs every minute.
- Scheduler: `local_tick()` (nightly steps after 22:30 UTC weekdays), `local_lists_tick()` (price history → Today's lists → AI lines).

## What exists (Nov 2026)
- AI Analyst tab (`src/pages/AiAnalyst.tsx`): Today's list, market report, ask-your-data (read-only SQL tool loop),
  one stock, from the filings (10-K/8-K text, quote checking), pattern finder, journal review, focus-list review, usage counts.
- Price history: `daily_bars` (~5y, `daily-bars`), lists: `daily-lists` + `_shared/lists.ts`, graded by `today_list_outcomes`.
- Fundamentals Lens (Damodaran): track record (`proven-strength`), fade rates, rarity, industry priced-in growth,
  look-alikes (`proven-lookalikes`), "What the numbers can't tell you", reading guide, "Read together" (`src/lib/lens/linked.ts`),
  "The long story" (AI), price story with correct wording for shrinking companies.
- Pattern finder: `pattern_samples` → `mine_patterns()` (fifths per trait, pairs, older 70% vs newer 30% of dates).

## Open items
- Owner's own data (themes, positions, journal) is still in Lovable; export when its allowance refreshes.
- Hebrew polish of the Lens texts; calmer Lens design.
- PRs: #94 (Lens Hebrew), #95 (run locally), #96 (local AI); later work is on `claude/ai-everywhere`.
- Known limits: survivorship bias (only today's listed stocks) in all history-based odds.
