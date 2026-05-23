# Tasks: Add HUD Section Visibility Settings

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 300-390 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR: tests + implementation + README |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

Forecast notes: this touches a focused set of files (`extensions/types/hud.ts`, `extensions/config/hud-settings.ts`, `extensions/settings/hud-settings.ts`, `extensions/utils/formatters.ts`, `extensions/hud.ts`, `test/hud.test.ts`, `test/helpers/hud-harness.ts`, `README.md`). The main risk to the 400-line budget is test coverage breadth. Keep tests table-driven where readable, avoid new abstractions beyond shared visibility key/label constants, and defer any richer interactive multi-select UI.

## Implementation Tasks

### 1. RED: settings defaults, merge, and malformed persisted values
- [x] Add failing tests in `test/hud.test.ts` for `readHudSettings()` default visibility using mocked global/project settings from `node:fs`.
- [x] Add failing tests in `test/hud.test.ts` for partial global/project merge: global `context=false, mcps=false` plus project `context=true` results in `context=true, mcps=false`.
- [x] Add failing tests in `test/hud.test.ts` for malformed project visibility values falling back to inherited values and unknown keys, including `subagents`, being ignored.
- [x] If the existing fs mock is too coarse, update `test/helpers/hud-harness.ts` or local test helpers in `test/hud.test.ts` to support per-path mocked settings content.
- [x] Run `pnpm test -- test/hud.test.ts` and capture RED evidence for these tests failing because `visibility` is not implemented.

### 2. GREEN: visibility model, defaults, normalization, and serialization
- [x] In `extensions/types/hud.ts`, add `HudVisibilityKey`, `HudVisibility`, and `visibility` on `HudSettings`.
- [x] In `extensions/config/hud-settings.ts`, add the supported visibility keys/labels and default all keys to `true`.
- [x] In `extensions/settings/hud-settings.ts`, deep-copy default `visibility` in `readHudSettings()`.
- [x] In `extensions/settings/hud-settings.ts`, add per-key `normalizeVisibility(input.visibility, base.visibility)` that accepts only known boolean keys and ignores `subagents`/unknown keys.
- [x] In `extensions/settings/hud-settings.ts`, include `visibility` in `serializeHudSettings()` under the existing `hud` object.
- [x] Run `pnpm test -- test/hud.test.ts` and confirm the settings tests from task 1 are GREEN before adding more tests.

### 3. RED: `/hud-settings visibility` command and formatting
- [x] Add failing tests in `test/hud.test.ts` for `/hud-settings visibility worktrees off` writing `.pi/settings.json` with `hud.visibility.worktrees=false` and the other known keys populated.
- [x] Add failing tests in `test/hud.test.ts` for `/hud-settings visibility` showing current visibility without writing.
- [x] Add failing tests in `test/hud.test.ts` for invalid visibility item/value leaving settings unchanged and not calling `writeFileSync`.
- [x] Add failing tests in `test/hud.test.ts` for formatted current settings omitting `subagents` and including known visibility states.
- [x] Add failing interactive tests in `test/hud.test.ts` or helper-backed command tests proving the main menu includes `visibility`, the visibility item list excludes `Subagents`, and selection can set an item enabled/disabled using existing `select` APIs.
- [x] Run `pnpm test -- test/hud.test.ts` and capture RED evidence.

### 4. GREEN: command handling, interactive flow, and current-settings output
- [x] In `extensions/settings/hud-settings.ts`, extend usage text to include `visibility`.
- [x] In `extensions/settings/hud-settings.ts`, extend `updateHudSettingFromArgs()` for `/hud-settings visibility <context|project|worktrees|mcps> <on|off|true|false|yes|no|1|0|enabled|disabled>`.
- [x] In `extensions/settings/hud-settings.ts`, make `/hud-settings visibility` report `formatHudSettings(settings)` or equivalent visibility state without writing.
- [x] In `extensions/settings/hud-settings.ts`, add an interactive `visibility` branch: select one of Context, Project path + Branches, Worktrees, Configured MCPs, then select enabled/disabled and persist.
- [x] In `extensions/utils/formatters.ts`, include `visibility=context:on, project:on, worktrees:off, mcps:on` style output and do not include `subagents`.
- [x] Run `pnpm test -- test/hud.test.ts` and confirm command/formatting tests are GREEN.

### 5. RED: expanded HUD render gating
- [x] Add failing tests in `test/hud.test.ts` for expanded `context=false` omitting `Context`, token usage, `% used`, cost, input/output, and cache lines.
- [x] Add failing tests in `test/hud.test.ts` for expanded `project=false` omitting project path and `branch main`.
- [x] Add failing tests in `test/hud.test.ts` for expanded `worktrees=false` omitting `Git worktrees` when multiple worktrees would otherwise exist.
- [x] Add failing tests in `test/hud.test.ts` for expanded `mcps=false` omitting `Configured MCPs` with MCP adapter available.
- [x] Run `pnpm test -- test/hud.test.ts` and capture RED evidence.

### 6. GREEN: expanded HUD render gates and lookup avoidance
- [x] In `extensions/hud.ts`, gate the expanded Context section and associated context token/cost lines on `settings.visibility.context`.
- [x] In `extensions/hud.ts`, gate project path and branch lines on `settings.visibility.project`.
- [x] In `extensions/hud.ts`, gate Git worktree section on `settings.visibility.worktrees` and avoid `getGitWorktrees(projectPath)` unless expanded and visible.
- [x] In `extensions/hud.ts`, gate Configured MCPs on `settings.visibility.mcps` and avoid `getMcpAdapterInfo(...)` unless expanded and visible.
- [x] Keep Subagents and Help rendering independent of visibility.
- [x] Run `pnpm test -- test/hud.test.ts` and confirm expanded rendering tests are GREEN.

### 7. RED + TRIANGULATE: compact mode and Subagents exclusion
- [x] Add failing compact-mode test in `test/hud.test.ts` for `context=false` omitting `6.0% ctx` / compact context summary.
- [x] Add TRIANGULATE test in `test/hud.test.ts` proving compact Subagent running/error/active-label status still renders when `context=false`.
- [x] Add TRIANGULATE test proving persisted `hud.visibility.subagents=false` does not hide Subagents in expanded rendering and does not appear in formatted settings/toggle choices.
- [x] Run `pnpm test -- test/hud.test.ts` and capture RED/TRIANGULATE evidence.

### 8. GREEN: compact behavior and Subagents invariant
- [x] In `extensions/hud.ts`, omit the compact `headerSummary` line when `settings.visibility.context === false`, while keeping compact title, run/error line, and active subagent label.
- [x] Ensure no code path treats `subagents` as a supported `HudVisibilityKey`.
- [x] Run `pnpm test -- test/hud.test.ts` and confirm compact/Subagents tests are GREEN.

### 9. REFACTOR: centralize visibility helpers and keep changes under budget
- [x] Refactor duplicated visibility keys/labels in `extensions/config/hud-settings.ts` and `extensions/settings/hud-settings.ts` to one exported source if duplication emerged during GREEN.
- [x] Keep helper functions small and local; do not introduce a new settings subsystem.
- [x] Review `git diff --stat` and trim verbose tests/docs if changed lines approach 400 without losing required coverage.
- [x] Run `pnpm test -- test/hud.test.ts` and capture REFACTOR evidence.

### 10. Documentation and final verification
- [x] Update `README.md` with `hud.visibility` defaults, supported keys, examples for `/hud-settings visibility`, and explicit note that Subagents is not toggleable.
- [x] Run final targeted verification: `pnpm test -- test/hud.test.ts`.
- [x] Run final full verification: `pnpm test`.
- [x] Optional package safety if time permits or release path is involved: `pnpm run verify:package`.

## Rollback Boundaries
- Settings/model rollback: revert `extensions/types/hud.ts`, `extensions/config/hud-settings.ts`, normalization, serialization, and formatter changes; persisted `hud.visibility` becomes ignored data.
- Command rollback: remove `/hud-settings visibility` direct and interactive branches from `extensions/settings/hud-settings.ts`.
- Rendering rollback: remove visibility gates from `extensions/hud.ts`.
- Test/docs rollback: remove visibility-specific tests and README additions.
