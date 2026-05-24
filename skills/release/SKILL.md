---
name: pi-hud-release
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
- Release preparation MUST refresh packaged release metadata before validation so runtime startup notices can show the latest release details without git or network access.

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

3. Generate packaged release metadata for the startup notice:

   ```bash
   VERSION=$(node -p "require('./package.json').version")
   PREVIOUS_TAG=$(git tag --list 'v-*-RELEASE' --sort=-creatordate | head -1)
   pnpm generate:release-notes
   ```

   The generated metadata should be committed with the release prep and packaged with npm, for example as `assets/release-notes.json`. It should include the new package version, previous release tag/version when available, generation timestamp, and commit list from `$PREVIOUS_TAG..HEAD`. Runtime code should read this static file instead of calling git, npm, or GitHub.

4. Verify the target version is unpublished:

   ```bash
   npm view "pi-hud@$VERSION" version --registry=https://registry.npmjs.org/ || true
   ```

5. Validate locally:

   ```bash
   pnpm release:check
   ```

6. Commit and push the release preparation:

   ```bash
   git add package.json pnpm-lock.yaml CHANGELOG.md assets/release-notes.json .changeset
   git commit -m "chore(release): v$VERSION"
   git push origin HEAD
   ```

7. After the release PR is merged, tag the exact release commit:

   ```bash
   TAG="v-$VERSION-RELEASE"
   git tag "$TAG"
   git push origin "$TAG"
   ```

8. Watch publish and verify npm/Pi availability.

## Packaged Release Metadata Contract

- Generate the metadata during release preparation, after `pnpm version:changeset` updates `package.json` and `CHANGELOG.md`, and before `pnpm release:check`.
- Prefer a deterministic script such as `pnpm generate:release-notes` that reads local git tags and writes a static JSON file included by `package.json#files`.
- Do not make runtime startup notifications depend on `.git`, npm registry, GitHub API, or network access.
- The JSON should be small and stable. Recommended shape:

  ```json
  {
    "version": "0.3.1",
    "previousTag": "v-0.3.0-RELEASE",
    "generatedAt": "2026-05-24T00:00:00.000Z",
    "commits": [
      { "hash": "abc1234", "subject": "Add startup notification" }
    ]
  }
  ```

- Runtime should persist a shown marker by version, for example `lastReleaseNotesShown: "0.3.1"`, so each packaged release note is shown once.

## Output Contract

Report the version, branch, commit SHA, tag, publish workflow result, npm exact version, npm `latest` dist-tag, and any warnings or manual follow-up.
