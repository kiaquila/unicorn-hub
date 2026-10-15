# Tasks: Native Codex Review Compatibility

## Implementation

- [x] T001 Reproduce the leading-receipt regression and inspect the installed control plane.
- [x] T002 Implement strict native parsing, evidence ordering, unresolved-thread checks, and final-head validation.
- [x] T003 Fix runtime and workflow routing, bounded active-run wakeups, and duplicate suppression.
- [x] T004 Update templates, bootstrap regressions, and durable review documentation.
- [ ] T005 Run full preflight, publish, and obtain native review of the final head.
- [ ] T006 Verify all gates and threads, wait 120 seconds, and merge normally.

## Process Memory

- Receipt-prefixed native comments were rejected by both the classifier and rerun router; the workflow prefix filter independently prevented wakeups.
- Structured summaries are mutable; creation time alone cannot bind a new review to its request.
- A native review request marker never resolves existing findings.

## Known Issues

Initial rollout must pass the existing trusted default-branch gate without weakening protection.

## Verification Evidence

- Full `pnpm run preflight` passed: 139 tests, sanitizer, baseline, syntax,
  feature memory, context budget, and generated workflow parity.
- Gate integration tests execute the actual workflow entry point with a
  synthetic GitHub API, including GraphQL failures and a push before success.
- Native review and initial trusted-parser rollout remain deployment gates.
