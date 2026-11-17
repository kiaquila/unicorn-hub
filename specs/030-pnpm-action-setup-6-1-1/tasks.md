# Tasks: pnpm Setup Action 6.1.1 Update

## Implementation

- [x] T001 Synchronize the root/template action pins and workflow-test expectation.
- [x] T002 Run targeted workflow tests and the complete preflight.
- [ ] T003 Obtain a fresh Codex review for the final PR head and resolve all findings.

## Process Memory

### Decisions

- Keep the immutable pin supplied by Dependabot and preserve workflow behavior.
- Update feature memory because installable templates and tests are configured product paths.

### Dead Ends

- Updating only the generated workflows left both source templates and the explicit pin assertion stale; the original PR failed CI and received a P1 finding.

### Known Issues

- None accepted.

### Verification Evidence

- `node --test tests/workflows.test.mjs` passed all 8 tests.
- `pnpm run preflight` passed all 225 tests, workflow parity, sanitizer, baseline, syntax, and context checks on 2026-11-17.
