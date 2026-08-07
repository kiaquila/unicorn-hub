# Tasks: Ready PR Publication Default

## Setup

- [x] T001 Refresh `origin/main`, create the isolated `codex/ready-pr-publication` branch, and locate all publisher, bootstrap, test, and documentation references.
- [x] T002 Create feature memory after the local preflight gate identified it as required for this workflow change.

## Implementation

- [x] T003 Make `--draft` conditional on the explicit publisher option.
- [x] T004 Update the source and installed workflow documentation for ready-by-default publication.
- [x] T005 Add publisher mode tests and bootstrap preservation coverage.

## Verification

- [x] T006 Run `pnpm test` and verify both ready and explicit-draft tests pass.
- [x] T007 Run `pnpm run preflight` after feature memory is complete.
- [ ] T008 Publish a ready-for-review PR, verify CI and review gates, and hand off without merging.

## Process Memory

### Dead Ends

- The first `pnpm run preflight` was intentionally stopped by the feature-memory gate because the change touched configured product paths before this feature folder existed. The required files were then added rather than bypassing the gate.

### Decisions

- Keep draft support as the existing generic `--draft` flag and make omission the ready-for-review default; no new configuration key or profile switch is needed.
- Test command construction through synthetic executable shims rather than opening network PRs, so the behavior is deterministic and safe in local verification.
- Treat the raw script copy performed by bootstrap as the canonical generator path and assert byte identity after installation.

### Known Issues

- None identified. CI and GitHub review evidence remain to be collected after the branch is published.
