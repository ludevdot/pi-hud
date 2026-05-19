---
name: release
description: "Trigger: release pi-hud, publish, npm publish, version bump, changelog, changeset, release tag. Release pi-hud through its pinned Changesets and GitHub tag workflow."
license: MIT
metadata:
  author: ludevdot
  version: "1.0"
---

## Activation Contract

Use this skill when preparing, publishing, or verifying a `pi-hud` release.

## Hard Rules

- First read `RELEASING.md`; it is the source of truth for the release checklist.
- Do not publish `pi-hud` to npm from a local machine.
- Publishing MUST go through `.github/workflows/publish.yml` via `v-<version>-RELEASE` tag or manual workflow dispatch.
- Use the pinned `@changesets/cli` version in `package.json`; do not upgrade or use a floating version unless explicitly requested.
- Use Changesets for version/changelog preparation: never use `npm version`.
- Work on a dedicated branch until the release PR is merged. Tag from `main` unless the user explicitly approves releasing another branch commit.
- Never push a release tag before the release commit is pushed and `npm view pi-hud@<version>` confirms the version is unpublished.
- Never skip `pnpm release:check` before tagging.

## Decision Gates

| Situation                                     | Action                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| No changeset exists for a user-visible change | Run `pnpm changeset` before release preparation.                            |
| Pending changesets exist                      | Run `pnpm version:changeset` and review `package.json` plus `CHANGELOG.md`. |
| `npm view pi-hud@<version>` returns a version | Stop; do not tag an already-published version.                              |
| Branch differs from `main` at tag time        | Ask whether to merge first or release that branch SHA.                      |
| User says “push the tag”                      | Confirm this triggers npm publish, then proceed only if already explicit.   |

## Execution Steps

1. Inspect state:

   ```bash
   git status --short --branch
   git fetch origin main --tags
   git tag --list 'v-*-RELEASE' --sort=-creatordate | head
   ```

2. Prepare version and changelog:

   ```bash
   pnpm install --frozen-lockfile
   pnpm version:changeset
   ```

3. Verify the target version is unpublished:

   ```bash
   VERSION=$(node -p "require('./package.json').version")
   npm view "pi-hud@$VERSION" version --registry=https://registry.npmjs.org/ || true
   ```

4. Validate locally:

   ```bash
   pnpm release:check
   ```

5. Commit and push the release preparation:

   ```bash
   git add package.json pnpm-lock.yaml CHANGELOG.md .changeset
   git commit -m "chore(release): v$VERSION"
   git push origin HEAD
   ```

6. After the release PR is merged, tag the exact release commit:

   ```bash
   TAG="v-$VERSION-RELEASE"
   git tag "$TAG"
   git push origin "$TAG"
   ```

7. Watch publish and verify npm/Pi availability.

## Output Contract

Report the version, branch, commit SHA, tag, publish workflow result, npm exact version, npm `latest` dist-tag, and any warnings or manual follow-up.
