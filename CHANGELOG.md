# Changelog

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
