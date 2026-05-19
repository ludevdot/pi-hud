# Contributing

Thanks for your interest in contributing to `pi-hud` ❤️

`pi-hud` is a Pi package that provides a persistent HUD with context, project, git, MCP, and subagent status. We aim to keep contributions simple, respectful, and easy to review.

## Before You Start

- Check existing issues and pull requests to avoid duplicate work.
- Prefer an issue-first workflow for non-trivial changes.
- Keep changes focused; small PRs are easier to review.

## Local Setup

### Requirements

Match the versions declared in `package.json`:

- Node.js 20 or newer (`engines.node`)
- pnpm 10.30.2 (`packageManager`)

### Install

```sh
pnpm install --frozen-lockfile
```

## Development Flow

1. Fork the repository or create a branch from `main`.
2. Make a focused change with a conventional commit.
3. Run the relevant checks below.
4. Open a pull request with context, rationale, and validation evidence.

Branch naming suggestions:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `chore/<short-description>`

## Commit Messages

Use **Conventional Commits**:

- `feat: add compact project status`
- `fix: handle missing MCP adapter`
- `docs: clarify local setup`
- `chore: update package metadata`

## Quality Checks

Run the checks that match your change:

```sh
pnpm test
pnpm run verify:package
pnpm run pack:dry
```

Guidance:

- Use `pnpm test` for code changes.
- Use `pnpm run verify:package` when package contents or metadata change.
- Use `pnpm run pack:dry` before release or packaging-related PRs.
- For docs-only changes, a careful review plus `pnpm test` is usually enough unless package metadata or published files change.

## Security & Secrets

- Never commit secrets, tokens, API keys, or private credentials.
- If your change touches security-sensitive behavior, mention it clearly in the PR.
- For vulnerabilities, follow [SECURITY.md](./SECURITY.md).

## Pull Requests

Please include:

- what changed
- why it changed
- how you validated it locally
- screenshots or log snippets when UI or behavior changes are involved

Keep PRs focused. Smaller PRs get reviewed faster and with better feedback.

## Code of Conduct

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
