# Proposal: Add HUD Section Visibility Settings

## Intent

Add a `/hud-settings` visibility option that lets users show or hide selected HUD sections, with the same global/project settings persistence model used by existing HUD settings. Hidden sections must not render in expanded HUD, and any hidden item that contributes to compact HUD content must be omitted from compact mode too.

## Scope

### In scope

- Add a user-facing `/hud-settings visibility` setting.
- Persist visibility in HUD config loaded from:
  1. global `~/.pi/agent/settings.json` (or `PI_CODING_AGENT_DIR/settings.json`), then
  2. project `.pi/settings.json`, with project values overriding global values.
- Support toggles for these visibility items:
  - `context` — the expanded `Context` section and compact-mode context summary.
  - `project` — project path and branch display in the expanded `Project` section.
  - `worktrees` — the expanded `Git worktrees` section.
  - `mcps` — the expanded `Configured MCPs` section.
- Keep `Subagents` intentionally always rendered when otherwise applicable; it must not be configurable in visibility settings.
- Update direct-argument and interactive `/hud-settings` flows so users can inspect/change visibility using a toggleable list.
- Update formatted “show current” settings output to include visibility state.
- Update README or user-facing command docs if implementation changes command usage.
- Add tests before implementation and follow strict TDD evidence gates.

### Out of scope

- Hiding `Subagents`.
- Adding arbitrary custom HUD sections or user-defined labels.
- Changing HUD position, shortcut, sizing, auto-compact, or overlay visibility semantics except where needed to respect hidden sections.
- Persisting settings outside the existing HUD config objects.

## Affected Areas

- `extensions/types/hud.ts`
  - Add a typed visibility model to `HudSettings`.
- `extensions/config/hud-settings.ts`
  - Add default visibility with all toggleable items visible.
- `extensions/settings/hud-settings.ts`
  - Normalize, merge, serialize, and write `visibility` settings.
  - Extend `/hud-settings` usage/direct args and interactive selection.
- `extensions/hud.ts`
  - Gate expanded sections by visibility.
  - Gate compact context summary by visibility while keeping compact subagent summary always present.
  - Avoid unnecessary worktree/MCP lookup when the associated section is hidden if practical.
- `extensions/utils/formatters.ts`
  - Include visibility in current settings formatting.
- `test/hud.test.ts` and/or helpers under `test/helpers/`
  - Add strict TDD coverage for settings persistence and render behavior.
- `README.md` or command documentation
  - Document the new visibility setting if user-facing command syntax is added or changed.

## Proposed User Experience

Prefer the setting name `visibility`.

Examples the implementation should support unless codebase constraints require a small syntax adjustment:

```text
/hud-settings visibility
/hud-settings visibility context off
/hud-settings visibility project false
/hud-settings visibility worktrees on
/hud-settings visibility mcps enabled
```

Interactive `/hud-settings` should include `visibility` in the main menu. Selecting it should present a toggleable list for Context, Project path + Branches, Worktrees, and Configured MCPs. Subagents must not appear in that toggle list.

Persisted project settings should remain under `hud`, for example:

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

## Behavior Requirements

- Defaults: all toggleable sections are visible.
- Merge behavior: global HUD visibility values are loaded first; project HUD visibility values override only the keys they specify.
- Invalid visibility keys or values are rejected with usage/warning behavior consistent with existing `/hud-settings` argument validation.
- Unknown/malformed persisted visibility values fall back to the inherited/default value per key.
- Expanded mode:
  - `context=false` hides the `Context` section and its token/cost lines.
  - `project=false` hides project path and branch display.
  - `worktrees=false` hides `Git worktrees` even when multiple worktrees exist.
  - `mcps=false` hides `Configured MCPs` even when the adapter is available.
  - `Subagents` still renders.
- Compact mode:
  - `context=false` removes context from the compact header/summary.
  - Subagent run/error/active status remains rendered.
- Any hidden item must not appear in compact mode either.

## TDD and Verification Requirements

Strict TDD mode is active. Apply/verify artifacts must include evidence for:

1. **RED** — failing tests are written first for visibility persistence and render behavior.
2. **GREEN** — implementation makes those tests pass.
3. **TRIANGULATE** — at least one additional/variant test prevents overfitting, such as partial project override of global visibility or compact-mode context hiding while subagents remain visible.
4. **REFACTOR** — final cleanup pass after green/triangulation with tests still passing.

Required final test command:

```sh
pnpm test
```

Recommended targeted tests while iterating:

```sh
pnpm test -- test/hud.test.ts
```

## Risks

- Compact HUD currently combines model and context in one header; hiding only context may require a readable alternate header format that still fits compact width.
- Partial global/project merge can regress existing settings if visibility normalization replaces the whole object instead of merging per key.
- Interactive multi-toggle UI capabilities may be limited by the current `ctx.ui.select` API; implementation may need a simple repeated toggle/select flow while still presenting a toggleable list concept.
- New direct-argument syntax can make usage text long; keep warning text understandable and testable.

## Rollback Plan

- Remove the `visibility` field from `HudSettings`, defaults, normalization, serialization, formatting, and command handling.
- Remove render gating from HUD sections and restore existing unconditional section rendering.
- Remove visibility tests and documentation updates.
- Existing settings files with `hud.visibility` should be harmless if code ignores unknown HUD keys after rollback.

## Success Criteria

- Users can hide/show Context, Project path + Branches, Worktrees, and Configured MCPs from `/hud-settings visibility`.
- Visibility persists in project `.pi/settings.json` and respects existing global/project override ordering.
- Hidden sections are absent from expanded HUD and from compact HUD where applicable.
- Subagents remains visible and is not offered as a hideable option.
- `pnpm test` passes.
- Apply/verify reports include RED, GREEN, TRIANGULATE, and REFACTOR evidence.
