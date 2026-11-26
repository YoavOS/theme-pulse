# Topic map — open only the relevant row

Paths are relative to `C:\Users\yoavp\theme-pulse-local`. Verified file locations on 2026-11-21; implementation details can change.

| Topic | Start here |
|---|---|
| Startup, shutdown, resource use | `local/Start-ThemePulse.ps1`, `local/Stop-ThemePulse.ps1`, `local/Runtime.ps1`, `local/Worker.ps1`, `local/PERFORMANCE.md` |
| Background data jobs | `local/setup-local.sql`, `supabase/functions/daily-bars/index.ts` |
| Local AI routing / long jobs | `supabase/functions/_shared/llm.ts`, `supabase/functions/_shared/aiJobs.ts`, `supabase/migrations/20261118160000_ai_jobs.sql`, `local/ai.env` (not keys.env) |
| Routes and startup tasks | `src/App.tsx` |
| Dashboard and grouping | `src/pages/Index.tsx`, `src/lib/groupThemes.ts`, `src/lib/groupStage.ts`, `src/hooks/useFullScan.ts` |
| Volume loading / sleep / Brief | `src/hooks/useVolumeData.ts`, its `.test.ts`, `src/lib/appSleep.ts`, `src/hooks/useBrief.ts`, `src/components/brief/BriefPanel.tsx` |
| RS filters / focus organizer | `src/pages/RsAlpha.tsx`, `src/lib/focusList.ts`, `src/components/rs/FocusOrganizer.tsx` |
| Weekly stages / bases | `src/pages/StageAnalysis.tsx`, `src/pages/BaseScanner.tsx`, `supabase/functions/_shared/stageEngine.ts`, `supabase/functions/_shared/baseEngine.ts` |
| Minervini / profiles / filings | `src/pages/MinerviniChecker.tsx`, `src/lib/superperfProfiles.ts`, `src/hooks/useSuperperformance.ts`, `supabase/functions/_shared/secFundamentals.ts` |
| Fundamentals teaching / Hebrew | `src/pages/FundamentalsLens.tsx`, `src/components/lens/`, `src/lib/lens/`, `src/lib/lens/he/`, `supabase/functions/_shared/lensMetrics.ts` |
| AI trials | `src/pages/AiAnalyst.tsx`, `src/components/ai/`, `supabase/functions/ai-analyst/`, `supabase/functions/company-file/`, `supabase/functions/pattern-finder/` |

Search narrowly before opening a big file, e.g. `rg -n "loadDigest|wantNews" src/hooks/useBrief.ts`. Exclude `node_modules`, `dist`, backups, logs and archives from broad discovery. Read only relevant log tails. Never dump `.env`, `keys.env`, or function secret files.

## Validation in the app folder
- Types: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`
- Build: `node node_modules/vite/bin/vite.js build`
- Volume behavior: `node node_modules/vitest/vitest.mjs run src/hooks/useVolumeData.test.ts --maxWorkers=1`
- PowerShell changes: use `System.Management.Automation.Language.Parser.ParseFile` before running.
- Database/scheduling changes: inspect the live local project and test using a rollback transaction where possible. Do not reset the database. CLI currently pinned to Supabase 3.2.0 in startup scripts; read CLI help before unfamiliar commands.
- UI: reload the production page after rebuilding/restarting; do not assume hot reload.

Past checks are evidence of a past state, not a reason to skip validation of new changes. No need to run unrelated full suites repeatedly for a documentation-only change.
