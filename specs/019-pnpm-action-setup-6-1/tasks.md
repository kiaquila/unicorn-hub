# Tasks: pnpm Setup Action 6.1 Update

## Implementation

- [x] T001 Confirm Dependabot's requested version and immutable commit pin.
- [x] T002 Synchronize the root and template CI workflows.
- [x] T003 Synchronize the root and template PR Guard workflows.
- [x] T004 Update the workflow test expectation.
- [x] T005 Run the complete preflight.
- [ ] T006 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Preserve the configured pnpm runtime version; this PR only updates the setup action implementation.
- Treat root workflows as generated copies and keep their source templates byte-for-byte aligned.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 126 tests on 2026-09-17.
- Current-head GitHub checks and Codex review remain pending until the branch update is pushed.
