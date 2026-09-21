# Tasks: GitHub Action Pin Refresh

## Implementation

- [x] T001 Confirm Dependabot's requested versions and immutable commit pins.
- [x] T002 Synchronize the root and template OSV workflows.
- [x] T003 Synchronize the root and template PR Guard workflows.
- [x] T004 Update the workflow test expectations.
- [x] T005 Run the complete preflight.
- [ ] T006 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Preserve all existing scan arguments, triggers, and dependency-policy behavior; this PR only refreshes action implementations.
- Treat root workflows as generated copies and keep them render-equivalent to their source templates after placeholder substitution.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 126 tests on 2026-09-21.
- Current-head GitHub review evidence remains pending until the branch update is pushed.
