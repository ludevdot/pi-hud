# Apply Progress: Add HUD Section Visibility

## Completed tasks

- Added strict-TDD coverage for visibility defaults, per-key global/project merge, malformed/unsupported keys, command persistence/reporting/validation, interactive visibility selection, expanded render gating, compact context omission, and Subagents invariants.
- Added `hud.visibility` model with default-visible keys: `context`, `project`, `worktrees`, `mcps`.
- Implemented safe normalization and serialization under the existing `hud` settings object.
- Added `/hud-settings visibility` direct command support and interactive select flow.
- Included visibility state in current settings formatting.
- Gated expanded HUD Context, Project, Git worktrees, and Configured MCPs by visibility.
- Gated compact context summary by visibility while keeping Subagents status visible.
- Documented visibility settings and examples in `README.md`.
- Updated task checklist in `tasks.md`.

## Files changed

- `README.md`
- `extensions/config/hud-settings.ts`
- `extensions/hud.ts`
- `extensions/settings/hud-settings.ts`
- `extensions/types/hud.ts`
- `extensions/utils/formatters.ts`
- `test/helpers/hud-harness.ts`
- `test/hud.test.ts`
- `openspec/changes/add-hud-section-visibility/tasks.md`
- `openspec/changes/add-hud-section-visibility/apply-progress.md`

## TDD Cycle Evidence

| Cycle | RED evidence | GREEN evidence | TRIANGULATE evidence | REFACTOR evidence |
| --- | --- | --- | --- | --- |
| Visibility settings/model | Added tests before implementation; `pnpm test -- test/hud.test.ts` failed because `HudSettings.visibility` was undefined and `/hud-settings visibility` was unsupported. | Added visibility types/defaults, per-key normalization, and serialization; targeted tests passed after implementation. | Covered partial global/project merge plus malformed project values and unsupported `subagents`/unknown keys. | Centralized keys/labels in `extensions/config/hud-settings.ts`; targeted tests re-run. |
| Command/render behavior | Added tests before render/command implementation; targeted run failed for missing command persistence, expanded gates, compact hiding, and interactive `select`. | Implemented command handling, formatting, render gates, and harness select/input support; `pnpm test -- test/hud.test.ts` passed. | Verified compact Subagents status remains visible when context is hidden and interactive visibility excludes `subagents`. | Reduced test breadth to focused scenarios to keep review diff under budget; final targeted and full tests passed. |

## Test commands run

- `pnpm test -- test/hud.test.ts` — failed initially with 8 expected RED failures before implementation.
- `pnpm test -- test/hud.test.ts` — passed after GREEN implementation.
- `pnpm test` — passed, 22 tests.

## Deviations from design

- Kept the interactive visibility flow as select item → select enabled/disabled, matching the design fallback for available UI primitives.
- Combined several RED scenarios into focused tests to keep the final review diff within the 400-line target.

## Remaining tasks

- None for apply. Optional follow-up: run `pnpm run verify:package` before release/PR if desired.

## Workload / PR boundary

- Single cohesive work boundary: tests + implementation + README for `add-hud-section-visibility`.
- Final diff exceeds the configured 400-line review budget after follow-up UX and lint cleanup.
- Size exception accepted and recorded in `openspec/changes/add-hud-section-visibility/size-exception.md` because there is no PR for this work and splitting would create awkward intermediate states.
