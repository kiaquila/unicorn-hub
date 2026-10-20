# Tasks: GitHub Action Pin Refresh

## Implementation

- [x] T001 Confirm Dependabot's requested versions and immutable commit pins.
- [x] T002 Synchronize the root and template workflow pins.
- [x] T003 Update the workflow test expectations.
- [x] T004 Run targeted workflow synchronization and tests.
- [x] T005 Run the complete preflight.
- [ ] T006 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Preserve existing workflow behavior and policy; this PR only refreshes action implementations.
- Treat root workflows as generated copies and keep them render-equivalent to their source templates.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run check:workflows` passed locally.
- `node --test tests/workflows.test.mjs` passed locally with 8 tests.
- `pnpm run preflight` passed locally with all 190 tests on 2026-10-20.
- Current-head GitHub checks and Codex review remain pending until the branch update is pushed.
