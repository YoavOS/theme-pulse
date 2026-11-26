# Theme Pulse working instructions

## Context discipline
- Read this file and `docs/PROJECT-NOTES.md` when starting work without current project context. In an ongoing chat, reuse already-read context; reread only after changes, missing context, or conflicting evidence.
- Use focused `rg` searches and relevant functions. Open `docs/CODE-MAP.md` only to locate unfamiliar code. Read other references only for the active task.
- Do not reopen the old Claude chat, broad repository scans, or unchanged files by default. Current code and runtime evidence outrank historical claims.
- Keep tool output small: matched lines, targeted excerpts, short diffs, and failure summaries. Store verbose logs locally; inspect them only as needed. Never dump secrets, bundles, lockfiles or backups.
- Batch independent checks. Run targeted validation; repeat only after relevant changes or unresolved failures. Do not sacrifice necessary checks to save tokens.
- Use brief progress updates and final answers. Do not repeat plans, findings or unchanged status. Avoid creating duplicate handoffs or indexes.

## Product and safety
Personal Windows app; prioritize responsiveness. Free AI only; code computes facts, AI explains. AI trials stay in the AI tab until requested otherwise. Preserve calculations during design changes. Prefer compact layouts, meaningful blue/pink/gold, and natural gender-neutral Hebrew.
Never expose credentials or delete database volumes. Installed app has no `.git`; do not imply changes were committed or synced. Back up substantial changes. Proceed with authorized routine work without unnecessary confirmations.

## Handoff
Update `docs/PROJECT-NOTES.md` after meaningful changes, replacing obsolete state. Target 350 words; retain decisions, verification limits, unresolved issues and useful pointers. Keep this file under 300 words. Detailed history belongs in topic references. Update `docs/DECISIONS.md` only for durable decisions. Saving a handoff does not require rereading old chats.
