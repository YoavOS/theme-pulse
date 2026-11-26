# Durable decisions and historical context

Read only the relevant section. Summarized from the shared Claude conversation and subsequent Codex work. Code and runtime checks outrank old completion claims. These preferences guide authorized work; backlog entries are not new task instructions.

## Product and trading workflow
- Personal stock-research app, primarily used before and after US market hours. Avoid duplicate morning refreshes of completed nightly work.
- Dashboard owns its Full Scan; do not silently substitute RS Alpha returns. Industry/sector views cover the broader stock list, while themes use their own members.
- Whole-market Stage breadth is separate from the ADR-filtered trading universe. Distinguish completed weekly signals from provisional current-week readings.
- Setups: breakouts and 21 EMA pullbacks. Focus candidates enter after roughly a 40% run since the last EMA touch, even while extended; proximity is readiness, not eligibility. Keep SPY/QQQ/IWM at the top and industry peers adjacent to focus stocks. Preserve overrides, file import and TradingView exports.
- The 0.4/0.5 ADR proximity discussion was not empirically calibrated. ADR multiples are not percentages. Do not present heuristic thresholds as proven trading edges.

## Design and learning
- Improve the existing app rather than replacing its whole design. Preserve exact filter ranges, exports, controls and calculations. Compact readable tables, centered overlays, fewer distracting elements.
- Meaningful color: blue positive, pink negative, gold caution; intensity reflects magnitude. Existing price-chart colors may differ.
- Fundamentals should teach what numbers mean for this company, compare with peers/industry, connect related metrics and explain caveats. Life-cycle and sector context matter; banks/insurers require different measures. A good company is not automatically a good investment.
- Terms should have beginner-friendly explanations, company-specific interpretation and natural Hebrew, using gender-neutral phrasing. Avoid literal translations of negative growth and misleading price-story verdicts. Keep long explanations readable through hierarchy and progressive disclosure.
- Requested features included linked metrics, a long narrative, filings context, limitations, look-alikes and fade odds. Earlier assistant reports said these were built, but not all were live-tested. Full Hebrew rewrite and calmer older Lens design were still unfinished.

## AI decisions
- Free AI only. Local first; existing free-provider fallback is part of the app. Do not add paid services without a new user request.
- Code computes and validates facts; AI interprets evidence, sources and uncertainties. Never treat model prose or historical backtests as proof of a profitable strategy.
- Latest placement decision: trial new AI features inside the AI tab, then keep, move or remove based on use. The user rejected badges as the main delivery method; useful lists should be easy to find. Planned Damodaran teaching remains in Fundamentals.
- Journal review should focus on thinking, selection, thesis and overlooked context, rather than merely execution. User's original journal source was not settled in the historical chat.
- Pattern discovery needs held-out evaluation. Today's surviving stock universe introduces survivorship bias in pattern, fade and look-alike results. Management filings and AI interpretations have limitations; verify quotations against the source.

## Migration and rejected paths
- Moved from Lovable to local Docker because of costs. Old frontend publication, backend deployment and DB migrations were separate operations; old PR/deployment claims do not establish this local folder's current state.
- Trade Desk was removed; Model Book/Watchlist proposals were rejected. Wholesale redesign was rejected. Do not revive these without a new request.
- Historic remote path `/home/claude/theme-pulse` is not the local app. Keep the app at `C:\Users\yoavp\theme-pulse-local`; use desktop shortcuts rather than moving its folder.
- User merges historical PRs. This installed copy has no Git metadata, and recent Codex edits were local only. Never imply they reached GitHub.
- Graphify was historically run on code and a partial, condensed chat export. Those maps have not been verified in this installed folder. A short maintained handoff is the current continuation mechanism; no graph build is required.

## Source, only for a specific unresolved historical question
Shared chat: https://claude.ai/share/fda85732-5ae6-4b1e-af5e-4fa41bdaa162
Codex read the entire available text on 2026-11-21. Shared attachments were hidden. This summary intentionally excludes repeated deployment prompts, superseded recommendations, raw logs and code dumps. Consult the source selectively when the missing detail materially affects a decision.

- 2026-11-21: Clean EMA Uptrend gain uses the existing first streak close as its base and the highest high within that uninterrupted streak as its endpoint. A close below the selected EMA resets it. User explicitly requested this change.

- 2026-11-22: Fundamentals is education for total beginners using real companies. Lead with the company story and latest-quarter/growth context; use horizontal visuals with QoQ/YoY overlays, blue/pink/gold, and progressively disclosed details. No thesis/journaling form in this view.
