# Changelog

## 0.9.2

### Patch Changes

- Fix minimized overlays returning compact after switching through footer mode.

## 0.9.1

### Patch Changes

- 4d6678d: Change the default HUD mode switch shortcut to `ctrl+.` and reject Pi's reserved `ctrl+s` binding.

## 0.9.0

### Minor Changes

- c254508: Add a configurable switch shortcut for toggling between overlay and footer mode.

## 0.8.1

### Patch Changes

- Route live MCP footer status to the dedicated MCP line and hide MCP from the Help/Flow status segment so footer mode no longer shows conflicting MCP counts.

## 0.8.0

### Minor Changes

- Add subscription-friendly footer usage display settings for hiding token and cost details, plus an optional colored context usage bar.
- Add a HUD settings modal for editing mode, shortcuts, sizing, startup notifications, and module visibility from inside Pi.

### Patch Changes

- Prefer Pi's live MCP extension status in footer mode so stale project-local MCP configuration does not appear when the active agent config is empty.

## 0.7.0

### Minor Changes

- Add richer footer mode status with thinking level, compact session resume, project-aware help/SDD Flow hints, refreshed footer screenshot, and hide completed verified SDD changes from active Flow hints.

## 0.6.0

### Minor Changes

- da404ca: Add opt-in footer mode with `/hud-mode`, compact footer rendering, git/context status indicators, session resume command, and README documentation.

## 0.5.0

### Minor Changes

- 9c27b9d: Color context usage percentages at higher thresholds and show an exclamation marker from 50% to 69% so long sessions surface early warning states in compact and expanded HUD views.
- 0912b37: Show the current project folder as a green Project line in the compact HUD so multiple Pi HUD instances are easier to distinguish.

### Patch Changes

- Prefer Pi's active agent MCP config before legacy project-local MCP config paths so stale project MCP names do not appear in the HUD.

## 0.4.4

### Patch Changes

- Update the packaged Pi HUD extension images.

## 0.4.3

### Patch Changes

- 0fe7dbb: Show individual active subagents in the expanded HUD while keeping compact mode summary-only.
- 17d2d65: Update the pinned package manager to pnpm 11.4.0, align CI, publish, and contributor setup instructions, preserve pnpm 11's release-age gate with explicit temporary exclusions for the already-reviewed Pi 0.77.0 refresh, and document approved dependency build scripts required by the locked install.
- 77c859e: Render the startup notification through Pi's UI notification API instead of injecting a custom session message, preventing HUD startup text and release notes from entering agent prompt context.

## 0.4.2

### Patch Changes

- 9926e20: Avoid slash-command-like text in the startup HUD notification so automatic session messages are less likely to be interpreted as user prompts.

## 0.4.1

### Patch Changes

- 72d955e: Change the default HUD toggle shortcut from `f2` to `ctrl+shift+h` so fresh installs avoid function-key handling issues in macOS, terminal, and multiplexer stacks.

## 0.4.0

### Minor Changes

- Show a custom startup notification with the HUD toggle shortcut and display packaged release notes once per version.

## 0.3.0

### Minor Changes

- Add configurable HUD module visibility settings with a Modules visibility toggle UI, default-visible modules, compact-mode hiding, and a Default settings reset.

## 0.2.1

### Patch Changes

- Refresh the HUD screenshot to show the current worktree display.

## 0.2.0

### Minor Changes

- Add a Git worktrees section to the expanded HUD so nearby sibling worktrees are visible without confusing temporary detached worktrees.

## 0.1.8

### Patch Changes

- Restore the initial narrow expanded HUD default so the panel no longer spans most of wide terminals by default.

## 0.1.7

### Patch Changes

- 6e05577: Increase the default expanded HUD width while keeping the narrow-terminal hide threshold at 90 columns.

## 0.1.6

### Patch Changes

- 5ba6cb5: Improve package metadata for npm, GitHub, and Pi package discovery.
- 114da9d: Add a first 60 seconds quick start to help new users validate the HUD after installation.

## 0.1.5

### Patch Changes

- Rename the packaged release skill to `pi-hud-release` so it no longer collides with other Pi release skills.

## 0.1.4

### Patch Changes

- da8c866: Add GitHub issue templates for bug reports, feature requests, and display or terminal rendering problems.
- d3b1d52: Add Changesets-powered release documentation, changelog workflow, and a packaged release skill for Pi agents.
- b7c73bf: Publish only the image assets needed by the README and Pi package listing.

All notable user-facing changes to `pi-hud` are documented here.

This project uses [Changesets](https://github.com/changesets/changesets) to prepare version bumps and changelog entries. Add a changeset for every user-visible change before release.

## 0.1.3

Initial public release line for the Pi HUD package.

### Current capabilities

- Persistent non-blocking HUD overlay for Pi.
- Session, model, context usage, cost, project path, and git branch display.
- Subagent activity summary when available.
- Configured MCP server names when `pi-mcp-adapter` is installed.
- `/hud` and `/hud-settings` commands.
- Configurable shortcuts, position, sizing, and auto-compact behavior.
