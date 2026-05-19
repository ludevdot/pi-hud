# Releasing pi-hud

`pi-hud` uses Changesets for version planning and changelog updates. The Changesets CLI is pinned in `devDependencies`; update it intentionally rather than using a floating range.

## When a change needs a changeset

Add a changeset for every user-visible change:

- new HUD behavior or settings;
- bug fixes users can observe;
- package/install changes;
- documentation changes worth mentioning in release notes.

Small internal-only maintenance changes may skip a changeset if they do not affect users.

## Add a changeset

```bash
pnpm changeset
```

Choose the correct bump:

- `patch` for fixes and small documentation/package updates;
- `minor` for new user-visible capabilities;
- `major` for breaking changes.

Write the summary for users, not only maintainers.

## Prepare a release

1. Start from a clean `main` branch.
2. Install with the pinned package manager:
   ```bash
   pnpm install --frozen-lockfile
   ```
3. Apply pending changesets:
   ```bash
   pnpm version:changeset
   ```
4. Review the generated changes:
   - `package.json` version;
   - `CHANGELOG.md` entry;
   - removed `.changeset/*.md` files.
5. Confirm the target version is not already published:
   ```bash
   VERSION=$(node -p "require('./package.json').version")
   npm view "pi-hud@$VERSION" version --registry=https://registry.npmjs.org/ || true
   ```
   Continue only if npm does not return that exact version.
6. Run the release check:
   ```bash
   pnpm release:check
   ```
7. Commit the release changes:
   ```bash
   git add package.json pnpm-lock.yaml CHANGELOG.md .changeset
   git commit -m "chore(release): vX.Y.Z"
   ```
8. Tag using the publish workflow convention:
   ```bash
   git tag v-X.Y.Z-RELEASE
   git push origin main --tags
   ```

The GitHub Actions publish workflow publishes tags matching `v-*-RELEASE` to npm with provenance.

## Manual publish workflow

The `Publish to npm` workflow can also be run manually with a selected npm dist-tag, such as `latest`, `next`, or `beta`.

Before using the manual workflow, confirm that:

- `pnpm release:check` passes locally;
- the package version has not already been published;
- the chosen dist-tag is intentional.

## After publishing

- Verify the npm package page shows the expected version.
- Verify the Pi package listing still renders the package image.
- Confirm `pi install npm:pi-hud` works in a clean Pi environment when practical.
- Close the release issue or milestone if one was used.
