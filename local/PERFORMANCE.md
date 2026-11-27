# Local performance changes — 2026-11-21

Hardware measured: NVIDIA RTX 3080 Ti, 12 GB VRAM; 32 GB system RAM.
The old model configuration assumed 32 GB VRAM and selected qwen3:32b.

## Normal use

Use Start Theme Pulse.bat as before. A second click opens the existing app without starting additional workers. Services run hidden; Stop Theme Pulse.bat stops their process trees and the local stack. Restart after code updates.

AI uses qwen3:8b with a 16,384-token context. The model was downloaded and answered a smoke test entirely on GPU (~7.5 GB model allocation). It unloads after 60 seconds idle. The old 32B model remains on disk but is not selected. The smaller model trades some reasoning quality for responsiveness; existing calculation code and datasets are unchanged.

Automatic AI reports/commentary are off by default. Manual AI controls remain available. The Brief has a Generate news summary button. Classification remains available through its Classify button rather than automatically invoking AI shortly after opening the app. To opt into scheduled reports, set BACKGROUND_AI=on in local/ai.env and restart.

Background data maintenance has a ten-minute startup grace period, a shared three-minute cooldown, and waits while a queued AI job is running. Price-history refresh runs every ten minutes, one symbol worker at a time, with a 20-second loop budget. An in-flight network request may finish after that budget. Initial history filling takes longer; manual scans remain available. The redundant standalone superperformance schedule is disabled at startup; nightly scoring still runs through local-tick.

Unused logging, storage, realtime, mailbox and admin containers are stopped and their automatic restart policy disabled. No container volumes were deleted. STUDIO=on in local/ai.env re-enables the admin UI after restart. The database is limited to 1.5 CPU cores and the edge runtime to 2 cores. Other Docker projects and global WSL settings are untouched. Editing backend files while running may recreate the edge container: restart the app after updates to reapply limits.

Dashboard volume requests now use one paced queue with in-flight deduplication, visibility/sleep checks, cancellation on navigation and a failed-symbol retry cooldown. Existing volume calculations are unchanged.

## Verification

- PowerShell parsing and TypeScript checks passed.
- Production build passed (existing CSS import-order and chunk-size warnings remain).
- Three regression tests passed: no duplicate/concurrent volume requests, visibility pause/resume, cancellation on unmount.
- Start/Stop/restart and duplicate-Start checks passed.
- SQL transaction tests verified startup grace, eligibility after grace, and shared cooldown; all test changes rolled back.
- Browser check: dashboard industry view loaded saved scan data; AI Analyst recognized qwen3:8b and loaded the existing daily lists. No console errors in that check.
- Model smoke test: answer received, 100% GPU, 16K context. GPU usage returned below 1 GB when unloaded.
- Final backend snapshot: five containers totaling ~520 MiB, combined ~0.4% of one CPU core at idle. Earlier snapshots showed ~1.5 GiB consumed by the unused services alone. These are point-in-time measurements, not a controlled benchmark of every feature or total Windows RAM.

Original changed files are in local/performance-backup-20261121-005644, without API-key files. Restore only the specific files needed while the app is stopped, then Start to reapply configuration. The backup preserves the old ai.env, but restoring it reselects the oversized model. New helper files: local/Runtime.ps1 and local/Worker.ps1. The volume regression test is src/hooks/useVolumeData.test.ts. No GitHub commit or PR was created; this folder is the local installed app.
