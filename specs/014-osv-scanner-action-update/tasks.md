# Tasks: OSV Scanner Action Update

## Implementation

- [x] T001 Confirm Dependabot's requested version and immutable commit pin.
- [x] T002 Synchronize the root and template OSV workflows.
- [x] T003 Run the complete preflight.
- [ ] T004 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Keep the Dependabot-provided immutable SHA and update only its matching template copy.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 96 tests on 2026-08-25.
