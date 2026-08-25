# Tasks: pnpm Setup Action Update

## Implementation

- [x] T001 Confirm Dependabot's requested version and immutable commit pin.
- [x] T002 Synchronize the root and template CI workflows.
- [x] T003 Synchronize the root and template PR Guard workflows.
- [x] T004 Run the complete preflight.
- [ ] T005 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Preserve the configured pnpm runtime version; this PR only updates the setup action implementation.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 96 tests on 2026-08-25.
