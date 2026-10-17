# Tasks: Native Codex Review Compatibility

## Implementation

- [x] T001 Reproduce the leading-receipt regression and inspect the installed control plane.
- [x] T002 Implement strict native parsing, evidence ordering, unresolved-thread checks, and final-head validation.
- [x] T003 Fix runtime and workflow routing, bounded active-run wakeups, and duplicate suppression.
- [x] T004 Update templates, bootstrap regressions, and durable review documentation.
- [x] T004a Isolate read-only validation from default-branch writes and add explicit immutable, base-bound source promotion for initial rollout.
- [ ] T005 Run full preflight, publish, and obtain native review of the final head.
- [ ] T006 Verify all gates and threads, wait 120 seconds, and merge normally.

## Process Memory

- Receipt-prefixed native comments were rejected by both the classifier and rerun router; the workflow prefix filter independently prevented wakeups.
- Structured summaries are mutable; creation time alone cannot bind a new review to its request.
- A native review request marker never resolves existing findings.

- Native review identified pending-run eviction in a shared concurrency group;
  both workflows now use GitHub's documented `queue: max` semantics.
- Native review identified stale/incomplete active security state; every active
  review state must now be completed and finding-free on the exact head.
- Native review identified dispatch workflow provenance: checking out default
  scripts alone does not make a branch's workflow definition trusted. The write
  job now requires the default workflow ref; a non-default comment request fails.

## Known Issues

Initial rollout requires independent native review of the promoted snapshot and final head, with unchanged protection and the real PR workflow. The temporary repository source pin must be removed after merge.

## Verification Evidence

- Full `pnpm run preflight` passed: 143 tests, sanitizer, baseline, syntax,
  feature memory, context budget, and generated workflow parity.
- Gate integration tests execute the actual workflow entry point with a
  synthetic GitHub API, including GraphQL failures and a push before success.
- Native review and initial trusted-parser rollout remain deployment gates.
- Source-promotion tests execute the actual workflow shell against a synthetic
  Git repository; branch names, partial SHAs, injection strings, stale base pins,
  and failed request jobs cannot select a gate or produce a passing validation.
