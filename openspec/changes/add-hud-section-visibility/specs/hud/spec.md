# HUD Specification

## Purpose

Define user-visible HUD section visibility settings, persistence, command exposure, and rendering behavior for expanded and compact HUD modes.

## Requirements

### Requirement: HUD Visibility Defaults

The system MUST treat all toggleable HUD visibility items as visible when no visibility setting is configured.

#### Scenario: Missing visibility configuration preserves existing HUD output

- GIVEN global and project settings do not contain `hud.visibility`
- WHEN HUD settings are loaded
- THEN visibility for Context, Project path + Branches, Worktrees, and Configured MCPs MUST be enabled
- AND HUD sections that would have rendered before this change MUST remain eligible to render.

#### Scenario: Missing visibility keys default to visible

- GIVEN `hud.visibility` contains only `worktrees: false`
- WHEN HUD settings are loaded
- THEN Worktrees visibility MUST be disabled
- AND Context, Project path + Branches, and Configured MCPs visibility MUST be enabled.

### Requirement: HUD Visibility Persistence and Merge

The system MUST persist HUD visibility under the existing `hud` settings object and MUST merge global and project visibility settings per visibility item, with project values overriding only the items they specify.

#### Scenario: Project visibility overrides one global item without replacing others

- GIVEN global settings contain `hud.visibility.context: false` and `hud.visibility.mcps: false`
- AND project settings contain `hud.visibility.context: true`
- WHEN HUD settings are loaded for the project
- THEN Context visibility MUST be enabled
- AND Configured MCPs visibility MUST remain disabled.

#### Scenario: Visibility changes are written under hud

- GIVEN a user changes Worktrees visibility through `/hud-settings`
- WHEN the setting is saved
- THEN the persisted settings MUST contain the value at `hud.visibility.worktrees`
- AND the setting MUST use the same settings file and precedence mechanism as other HUD settings.

### Requirement: HUD Visibility Command Surface

The system MUST expose a single `/hud-settings` option named `visibility` that lets users inspect and change visibility for Context, Project path + Branches, Worktrees, and Configured MCPs.

#### Scenario: Direct command toggles a visibility item

- GIVEN Worktrees visibility is enabled
- WHEN the user runs `/hud-settings visibility worktrees off`
- THEN Worktrees visibility MUST be disabled
- AND subsequent HUD settings output MUST report Worktrees as hidden or disabled.

#### Scenario: Interactive visibility selection excludes Subagents

- GIVEN the user opens interactive `/hud-settings`
- WHEN the user selects the `visibility` option
- THEN the toggleable list MUST include Context, Project path + Branches, Worktrees, and Configured MCPs
- AND the toggleable list MUST NOT include Subagents.

#### Scenario: Invalid visibility input is rejected

- GIVEN a user provides an unknown visibility item or malformed visibility value
- WHEN `/hud-settings visibility` handles the input
- THEN the command MUST reject the input with usage or warning behavior consistent with other invalid `/hud-settings` arguments
- AND existing visibility settings MUST remain unchanged.

### Requirement: Expanded HUD Respects Visibility

The expanded HUD MUST omit any hidden toggleable section while preserving all visible sections and all non-toggleable sections that otherwise apply.

#### Scenario: Context visibility hides expanded context details

- GIVEN Context visibility is disabled
- WHEN the expanded HUD renders
- THEN the Context section MUST NOT render
- AND context token and cost lines associated with that section MUST NOT render.

#### Scenario: Project visibility hides project path and branches

- GIVEN Project path + Branches visibility is disabled
- WHEN the expanded HUD renders
- THEN project path display MUST NOT render
- AND branch display MUST NOT render.

#### Scenario: Worktrees and MCP visibility hide their expanded sections

- GIVEN Worktrees visibility is disabled
- AND Configured MCPs visibility is disabled
- WHEN the expanded HUD renders with worktrees and MCPs otherwise available
- THEN the Git worktrees section MUST NOT render
- AND the Configured MCPs section MUST NOT render.

### Requirement: Compact HUD Respects Visibility Equivalents

The compact HUD MUST omit compact-mode content that corresponds to a hidden visibility item.

#### Scenario: Context visibility hides compact context summary

- GIVEN Context visibility is disabled
- WHEN the compact HUD renders
- THEN compact context summary content MUST NOT render
- AND unrelated compact status content MAY still render.

#### Scenario: Hidden items are absent from compact mode

- GIVEN a visibility item is disabled
- WHEN compact HUD content would otherwise include an equivalent for that item
- THEN the compact HUD MUST omit that equivalent content.

### Requirement: Subagents Visibility Is Not Configurable

The system MUST keep Subagents outside HUD visibility configuration and MUST render Subagents when otherwise applicable regardless of visibility settings.

#### Scenario: Subagents remains visible when context is hidden

- GIVEN Context visibility is disabled
- AND Subagent status would otherwise render
- WHEN the HUD renders in expanded or compact mode
- THEN Subagent status MUST still render.

#### Scenario: Persisted subagents visibility keys do not hide Subagents

- GIVEN persisted settings contain a `hud.visibility.subagents` value
- WHEN HUD settings are loaded
- THEN Subagents MUST NOT become a supported toggleable visibility item
- AND Subagent rendering MUST NOT be disabled by that value.

### Requirement: Malformed Persisted Visibility Is Safe

The system MUST ignore unknown visibility keys and malformed persisted visibility values without corrupting inherited or default visibility for valid items.

#### Scenario: Malformed project value falls back safely

- GIVEN global settings contain `hud.visibility.mcps: false`
- AND project settings contain a malformed value for `hud.visibility.mcps`
- WHEN HUD settings are loaded
- THEN Configured MCPs visibility MUST remain disabled from the inherited global value or otherwise fall back safely according to existing HUD settings normalization behavior
- AND no malformed value MUST be persisted as a valid visibility state.

#### Scenario: Unknown visibility key is ignored

- GIVEN persisted settings contain `hud.visibility.unknownSection: false`
- WHEN HUD settings are loaded
- THEN the unknown key MUST NOT create a new toggleable HUD item
- AND valid visibility items MUST continue to load normally.
