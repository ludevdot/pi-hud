# Size Exception: add-hud-section-visibility

## Status

Accepted.

## Decision

This change is allowed to exceed the configured 400 changed-line review budget.

## Rationale

- There is no PR for this work, so the normal PR review-size guard does not apply as a reviewer workload blocker.
- The diff is large but cohesive: it implements one user-facing capability, HUD module visibility, across the required settings model, command UI, render behavior, tests, and README documentation.
- Splitting would create awkward intermediate states, such as settings without render behavior or render gates without user-facing configuration.
- The extra size is mostly from focused test/harness coverage and from iterative UX refinements requested after the first implementation:
  - `Modules visibility` interactive toggle list;
  - single reload status message instead of repeated notifications;
  - `Default settings` reset;
  - lint/type-safety cleanup in `test/hud.test.ts` and `extensions/config/hud-settings.ts`.

## Scope Boundary

Accepted scope remains limited to `add-hud-section-visibility`:

- `hud.visibility` config defaults and normalization;
- `/hud-settings visibility` direct command;
- `/hud-settings` → `Modules visibility` interactive toggle UI;
- hiding configured modules in expanded and compact HUD equivalents;
- keeping Subagents non-configurable and visible when otherwise applicable;
- README and tests for the behavior.

No unrelated feature work is included in this exception.

## Verification Required

Before considering the change complete, keep these checks green:

```sh
pnpm test -- test/hud.test.ts
pnpm test
pnpm run verify:package
```

LSP diagnostics should also remain clean for touched TypeScript test/source files.
