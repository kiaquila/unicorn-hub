# Tasks: Checkout Action Update

## Implementation

- [x] T001 Confirm the requested release against current action documentation.
- [x] T002 Synchronize all root and template checkout pins and annotations.
- [x] T003 Run the complete preflight.
- [ ] T004 Obtain a fresh Codex review for the final PR head.

## Process Memory

### Decisions

- Keep every existing checkout input unchanged; only the action implementation and its annotation move to v7.0.1.

### Known Issues

- None accepted.

### Verification Evidence

- `pnpm run preflight` passed with all 96 tests on 2026-08-25.
