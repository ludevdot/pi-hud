![pi-hud](assets/pi-hud.jpeg)

# pi-hud

[![npm](https://img.shields.io/npm/v/pi-hud?color=blue)](https://www.npmjs.com/package/pi-hud)
[![pi package](https://img.shields.io/badge/Pi-package-6f42c1)](https://pi.dev/packages/pi-hud?name=hud)
[![CI](https://github.com/ludevdot/pi-hud/actions/workflows/ci.yml/badge.svg)](https://github.com/ludevdot/pi-hud/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-hud?color=blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ludevdot/pi-hud?style=flat&color=yellow)](https://github.com/ludevdot/pi-hud/stargazers)

Persistent right-side HUD for [Pi](https://pi.dev), published as a Pi package at [pi.dev/packages/pi-hud](https://pi.dev/packages/pi-hud?name=hud).

It shows the current session, model/context usage, subagent activity, project path, and git branch without stealing focus from the editor.

![pi-hud session panel](assets/hud.png)

## Features

- Starts visible by default when the extension is installed.
- `/hud` toggle command.
- `/hud-settings` configuration command.
- Default hide/show keyboard shortcut: `f2`.
- Default minimize/expand keyboard shortcut: `ctrl+h`.
- Non-blocking TUI overlay: keep typing while the hud is visible.
- Live subagent status:
  - running/done/error counts;
  - active task label;
  - elapsed time;
  - token/context count when available.
- Session context usage and cost.
- Project path and current git branch.
- Configured MCP server names when `pi-mcp-adapter` is installed.

## Install

```bash
pi install npm:pi-hud
```

For project-local install:

```bash
pi install -l npm:pi-hud
```

## Try locally

From this repository:

```bash
pi -e .
```

From the Pi monorepo checkout during development:

```bash
./pi-test.sh --no-env -e /path/to/pi-hud
```

The HUD opens automatically on session start. Inside Pi, run:

```text
/hud
```

Run `/hud` again, or press `f2`, to hide or show it. Press `ctrl+h` to minimize or expand it.

## Commands

| Command         | Description                                              |
| --------------- | -------------------------------------------------------- |
| `/hud`          | Toggle the hud.                                          |
| `/hud-settings` | Configure position, shortcuts, auto-compact, and sizing. |

## Settings

`pi-hud` reads a `hud` object from Pi settings. Global settings live in `~/.pi/agent/settings.json`; project settings in `.pi/settings.json` override them.

Defaults:

```json
{
  "hud": {
    "position": "top-right",
    "shortcut": "f2",
    "minimizeShortcut": "ctrl+h",
    "autoCompactWhileStreaming": true,
    "expandedWidth": 42,
    "compactWidth": 26,
    "minTerminalWidth": 90,
    "margin": { "top": 1, "right": 1, "bottom": 1 }
  }
}
```

Supported `position` values are `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center`, `bottom-center`, `left-center`, and `right-center`.

Examples:

```text
/hud-settings position bottom-right
/hud-settings shortcut ctrl+shift+h
/hud-settings minimizeShortcut ctrl+h
/hud-settings autoCompactWhileStreaming off
```

### Recommended profiles

These profiles are copy-paste examples for your Pi settings file. They are documented examples, not built-in runtime presets. Each snippet is a partial override; unspecified HUD settings keep their default or previously configured values.

#### Minimal / low-noise HUD

Use this when screen space matters but you still want the HUD available.

```json
{
  "hud": {
    "expandedWidth": 32,
    "compactWidth": 20,
    "autoCompactWhileStreaming": true,
    "minTerminalWidth": 80
  }
}
```

#### Small terminal

Use this for narrow terminals. The HUD is still hidden when the terminal is narrower than `minTerminalWidth`.

```json
{
  "hud": {
    "expandedWidth": 30,
    "compactWidth": 18,
    "minTerminalWidth": 60,
    "margin": { "top": 0, "right": 0, "bottom": 0 }
  }
}
```

#### Bottom-right placement

Use this when top-right content conflicts with the HUD.

```json
{
  "hud": {
    "position": "bottom-right",
    "margin": { "right": 1, "bottom": 1 }
  }
}
```

#### No auto-compact

Use this if layout changes during assistant turns are distracting. Manual minimize/expand still works with `minimizeShortcut`.

```json
{
  "hud": {
    "autoCompactWhileStreaming": false
  }
}
```

#### Wider expanded panel

Use this on wide monitors to reduce truncation in the expanded HUD.

```json
{
  "hud": {
    "expandedWidth": 56,
    "compactWidth": 26,
    "minTerminalWidth": 110
  }
}
```

Shortcut changes require `/reload` because shortcuts are registered when the extension loads. Do not bind HUD shortcuts to `enter`, `return`, `alt+m`, `ctrl+m`, `ctrl+shift+m`, `ctrl+j`, or `ctrl+shift+j`; those conflict with Pi or terminal input keys.

## Notes

- Configured MCP servers are shown only when Pi has [`pi-mcp-adapter`](https://pi.dev/packages/pi-mcp-adapter?name=pi-mcp-adap) installed; config files alone do not enable the section.
- Subagent status is based on Pi extension events and `pi-subagents` tool/result shapes when available.
- The HUD auto-compacts for the full assistant turn and expands when the turn ends, instead of changing state on each reasoning update.
- The overlay is hidden on narrow terminals under the configured `minTerminalWidth`.

## Known limitations

### MCP connection status

The HUD shows configured MCP server names, not live connection status. It reads global and project MCP config paths and renders the configured names when `pi-mcp-adapter` is installed.

For example, a project-local `.mcp.json` can make a server appear in the HUD even when that server is not currently connected. Use `mcp({})` or `/mcp` for live MCP status.

`pi-mcp-adapter` does not currently expose a public cross-extension status API for `pi-hud` to consume. If such an API becomes available, `pi-hud` can show live states such as connected, cached, failed, needs-auth, or not connected.

## Release notes

User-facing changes are tracked in [CHANGELOG.md](CHANGELOG.md). Maintainer release steps are documented in [RELEASING.md](RELEASING.md).

The package also ships a `release` skill so installed Pi agents can follow the project release workflow with the same checklist.

## Inspiration

`pi-hud` is inspired by [sub-agent-statusline](https://github.com/Joaquinvesapa/sub-agent-statusline).

---

## License

MIT
