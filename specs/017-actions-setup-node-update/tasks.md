# Tasks: Setup Node Action Update

## Implementation

- [x] T001 Confirm v7 behavior and existing input compatibility against current action documentation.
- [x] T002 Synchronize the root and template CI action pin.
- [x] T003 Run the complete preflight.
- [ ] T004 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Keep Node 20 and pnpm caching unchanged because setup-node v7 supports both settings.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 96 tests on 2026-08-25.
