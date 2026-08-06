# Plan: Ready PR Publication Default

## Summary

Remove unconditional `--draft` from the canonical publisher, add it conditionally for the explicit option, and lock the behavior through mocked GitHub CLI tests, bootstrap coverage, and aligned workflow documentation.

## Technical Context

- runtime: Node.js ESM scripts
- dependencies: no new dependencies; Node test runner and synthetic command shims
- product paths: scripts, templates, tests, docs, and specs
- data changes: none

## Scope Boundaries

- in scope: publisher argument construction, installation coverage, PR-publication documentation, and tests
- out of scope: GitHub Actions definitions, required check configuration, review routing, branch protection, and merge operations

## Constitution Check

- Spec-first: this feature folder records behavior and evidence before publication.
- Testable boundaries: tests capture `gh pr create` arguments for both modes without network writes.
- PR-only: changes are prepared on an isolated branch and will be reviewed through GitHub.
- Simplicity: a single conditional argument array uses the existing generic argument parser.
- Deployability: the installed script remains a direct bootstrap copy with no profile-specific configuration.

## Complexity Tracking

No new abstraction is required. The publisher already parses flags, so a small conditional array makes the mode explicit while retaining the existing command structure.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | `tests/publish-branch.test.mjs` runs the publisher with synthetic `git`, `pnpm`, and `gh` commands and asserts the created PR command omits `--draft`. |
| AC-002 | `tests/publish-branch.test.mjs` runs the same publisher with `--draft` and asserts the created PR command includes `--draft`. |
| AC-003 | `tests/bootstrap.test.mjs` asserts bootstrap installs `scripts/publish-branch.mjs` byte-for-byte from the source blueprint. |
| AC-004 | README, bootstrap flow, GitHub control-plane docs, and installed README/devops workflow docs describe ready-by-default and explicit draft behavior. |

Negative scenario evidence:

- The two publisher tests prove default runs do not create drafts and explicit draft runs retain the flag (NS-001, NS-002).
- The inspected diff is limited to the publisher, installation coverage, relevant docs, tests, and this feature memory (NS-003).
- `pnpm run preflight` runs the sanitizer over the changed synthetic content (NS-004).

## Risks

- Risk: a future edit reintroduces unconditional draft mode.
  Mitigation: tests inspect the exact effective GitHub CLI argument list for both modes.
- Risk: newly bootstrapped repositories diverge from the source workflow.
  Mitigation: bootstrap test compares the installed publisher to the canonical source.
