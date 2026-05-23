# Design: HUD Section Visibility Settings

## Overview

Add a `visibility` HUD setting that lets users hide selected HUD sections while keeping the existing HUD settings architecture, settings paths, and global/project precedence. The change is intentionally limited to `packages/pi-hud`-style extension code in this repository: settings type/defaults, `/hud-settings` command handling, current-settings formatting, HUD rendering, tests, and user docs.

The supported visibility keys are:

| Key | User-facing label | Expanded HUD effect | Compact HUD effect |
| --- | --- | --- | --- |
| `context` | Context | Hide `Context` section, token usage, cost, input/output/cache lines | Hide compact context summary; keep non-context compact status |
| `project` | Project path + Branches | Hide project path and branch line | No current compact equivalent |
| `worktrees` | Worktrees | Hide `Git worktrees` section | No current compact equivalent |
| `mcps` | Configured MCPs | Hide `Configured MCPs` section | No current compact equivalent |

`Subagents` is not a supported visibility key and remains always rendered when otherwise applicable.

## Current Architecture Findings

- Settings are read from global `PI_CODING_AGENT_DIR/settings.json` or `~/.pi/agent/settings.json`, then project `.pi/settings.json`, through `readHudSettings(cwd)` in `extensions/settings/hud-settings.ts`.
- `normalizeHudSettings(input, base)` already supports inherited fallback values, which is the right place to merge visibility per key.
- `/hud-settings` direct arguments are handled by `updateHudSettingFromArgs`; interactive settings are selected in `handleHudSettingsCommand`.
- `writeProjectHudSettings` currently serializes the whole normalized HUD object under the existing `hud` object.
- Expanded and compact HUD output are both rendered in `HudComponent.render()` in `extensions/hud.ts`.
- Worktree lookup is already skipped in compact mode. With visibility hidden, worktree/MCP lookup can also be skipped in expanded mode to avoid unnecessary work.

## Decisions

1. **Typed visibility model**
   - Add `HudVisibilityKey = "context" | "project" | "worktrees" | "mcps"`.
   - Add `HudVisibility = Record<HudVisibilityKey, boolean>` or an equivalent explicit interface.
   - Add `visibility: HudVisibility` to `HudSettings`.

2. **Default-visible semantics**
   - Add `visibility` to `DEFAULT_HUD_SETTINGS` with all four keys set to `true`.
   - Missing `hud.visibility` and missing per-key values inherit from the base settings, preserving backward compatibility.

3. **Safe normalization**
   - Normalize only known visibility keys and only boolean persisted values.
   - Unknown keys, including `subagents`, are ignored.
   - Malformed project values fall back to the inherited base value, matching existing normalization style.

4. **Persist under existing HUD settings**
   - `serializeHudSettings()` writes `visibility` under `hud.visibility` along with existing HUD settings.
   - No new settings file or precedence path is introduced.

5. **User-facing command name**
   - Add one `/hud-settings` option named `visibility`.
   - Direct syntax: `/hud-settings visibility <context|project|worktrees|mcps> <on|off|true|false|yes|no|1|0|enabled|disabled>`.
   - `/hud-settings visibility` without item/value should show current visibility state rather than mutate settings.
   - Invalid item/value should use the existing warning/usage path and leave settings unchanged.

6. **Interactive behavior**
   - Add `visibility` to the main interactive settings menu.
   - Selecting it presents only Context, Project path + Branches, Worktrees, and Configured MCPs.
   - Given the current UI helper visible in tests only guarantees `select` and `input`, implement this as a simple selectable item list followed by an enabled/disabled selection for the chosen item. This satisfies a toggleable-list concept without requiring a new multi-select UI API.

7. **Rendering gates**
   - Compact: when `visibility.context === false`, omit `headerSummary` because it currently combines model and context. Keep compact subagent run/error and active-label lines.
   - Expanded: gate `Context`, project path/branch, worktrees, and MCP sections independently.
   - `Subagents` rendering is not gated by visibility.
   - `Help` remains visible.

## Data Flow

1. User command or startup calls `readHudSettings(projectPath)`.
2. Defaults are copied, including a fresh nested `visibility` object.
3. Global `hud` settings normalize over defaults.
4. Project `hud` settings normalize over global results.
5. Commands update the in-memory `HudSettings.visibility` object and write the project HUD settings through `writeProjectHudSettings`.
6. HUD overlay receives the normalized `HudSettings` and renders sections according to `settings.visibility`.

## File Changes

### `extensions/types/hud.ts`

- Add visibility key/type exports.
- Add `visibility` to `HudSettings`.

### `extensions/config/hud-settings.ts`

- Add `HUD_VISIBILITY_KEYS` and/or `HUD_VISIBILITY_LABELS` if useful for command rendering.
- Add default `visibility` with all known keys set to `true`.

### `extensions/settings/hud-settings.ts`

- Ensure initial settings clone deep-copies `visibility` and `margin`.
- Add `normalizeVisibility(input.visibility, base.visibility)`.
- Extend `updateHudSettingFromArgs` for `visibility` direct args.
- Add interactive `visibility` branch.
- Include `visibility` in `serializeHudSettings()`.
- Update usage text to include `visibility`.

### `extensions/utils/formatters.ts`

- Include visibility in `formatHudSettings`, e.g. `visibility=context:on, project:on, worktrees:off, mcps:on`.

### `extensions/hud.ts`

- Use `settings.visibility` in `HudComponent.render()`.
- Avoid `getGitWorktrees(projectPath)` unless expanded and `visibility.worktrees` is true.
- Avoid `getMcpAdapterInfo(...)` unless expanded and `visibility.mcps` is true.
- Keep `Subagents` rendered regardless of visibility.

### `test/hud.test.ts` and `test/helpers/hud-harness.ts`

- Add helper support for mocked settings content and interactive `select`/`input` if needed.
- Add RED tests before implementation, then implement to GREEN.

### `README.md`

- Document `hud.visibility` defaults and `/hud-settings visibility` examples.

## Contracts

### Persisted settings contract

```json
{
  "hud": {
    "visibility": {
      "context": true,
      "project": true,
      "worktrees": false,
      "mcps": true
    }
  }
}
```

Only known keys are honored. `subagents` and unknown keys are ignored.

### In-memory contract

`HudSettings.visibility` is always fully populated after `readHudSettings()` returns.

### Command contract

- `/hud-settings visibility` reports current visibility.
- `/hud-settings visibility worktrees off` persists `hud.visibility.worktrees=false`.
- Invalid visibility item/value warns and does not write.

## Strict TDD Plan

### RED

Add failing tests first, preferably in this order:

1. Defaults and partial merge:
   - Missing visibility returns all keys visible.
   - Global `context=false, mcps=false` plus project `context=true` keeps `mcps=false`.
   - Malformed project value falls back to inherited global/default.
2. Direct command persistence:
   - `/hud-settings visibility worktrees off` writes `"visibility": { ..., "worktrees": false, ... }` under `hud` and reports the change.
   - Invalid visibility item/value does not call `writeFileSync`.
3. Expanded rendering:
   - `context=false` removes `Context`, `tokens`, `% used`, and cost lines.
   - `project=false` removes project path and `branch main`.
   - `worktrees=false` removes `Git worktrees` even when multiple worktrees exist.
   - `mcps=false` removes `Configured MCPs` with adapter available.
4. Compact rendering/triangulation:
   - `context=false` removes `6.0% ctx` from compact output.
   - Subagent status still renders when `context=false`.
5. Subagents exclusion:
   - Persisted `hud.visibility.subagents=false` does not hide Subagents and does not appear in formatted settings/toggle choices.

Run targeted tests and capture RED evidence:

```sh
pnpm test -- test/hud.test.ts
```

### GREEN

Implement the smallest code changes to satisfy the tests:

1. Types/defaults/normalization/serialization.
2. Command direct args and formatting.
3. Interactive branch.
4. Render gates.
5. README update.

Run targeted tests until green:

```sh
pnpm test -- test/hud.test.ts
```

### TRIANGULATE

Add at least one variant test after initial green to prevent overfitting, such as malformed project override preserving global `mcps=false`, or compact `context=false` with active subagent label still visible.

### REFACTOR

Clean duplication by centralizing visibility keys/labels and command formatting. Re-run:

```sh
pnpm test -- test/hud.test.ts
pnpm test
```

## Rollout and Review Notes

- This is a backward-compatible settings extension: existing settings without `hud.visibility` remain unchanged in behavior.
- Review should stay under the 400 changed-line target by limiting implementation to the listed files and avoiding new abstractions beyond visibility key/label helpers.
- Rollback is straightforward: remove the `visibility` field, command branch, render gates, tests, and docs. Existing persisted `hud.visibility` keys become ignored data if rollback code omits the field.

## Risks and Mitigations

- **Compact header readability:** Hiding context removes the combined model/context summary. Mitigate by keeping compact subagent status lines and the `HUD` title; do not introduce a new compact model-only line unless tests/product feedback require it.
- **Merge regressions:** Use per-key normalization against `base.visibility`; do not replace the whole visibility object.
- **Interactive UI limitations:** Use existing `select` APIs for item and enabled/disabled state rather than assuming multi-select support.
- **Unexpected persisted keys:** Ignore unknown keys during normalization and serialization so `subagents` never becomes configurable.
