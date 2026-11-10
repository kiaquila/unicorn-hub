# Tasks: Native Codex Details Summary

## Implementation

- [x] T001 Reproduce the live details-wrapped structured summary that leaves the trusted gate pending.
- [x] T002 Normalize the exact wrapper and retain the existing state/table/history checks.
- [x] T003 Add positive and adversarial regression coverage.
- [x] T004 Run targeted native-review tests and complete preflight.

Current-head native Codex review, immutable gate promotion, required checks, and cleanup of the temporary pin are tracked in the PR and must complete before merge.

## Process Memory

### Decisions

- Treat the wrapper as presentation only; it cannot replace or weaken the machine state and canonical table.
- Accept no attributes or alternate outer markup until independently observed and reviewed.

### Dead Ends

- A valid SHA-bound receipt could not pass while the newer details-wrapped summary remained an unknown pending signal.
- Repeating the review request reproduced the same native presentation, confirming that authentic legacy evidence was unavailable.

### Known Issues

- None accepted.

### Verification Evidence

- Focused details-wrapper regression passes.
- `node --test tests/native-codex-review.test.mjs` passed all 56 tests.
- `pnpm run preflight` passed all 225 tests, workflow parity, sanitizer, baseline, syntax, and context checks on 2026-11-10.
