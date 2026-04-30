# Tasks: Codex Summary Comment Timestamp Binding

## Implementation

- [x] Extend `isAcceptableCodexSummaryComment` in `scripts/ai-review-helpers.mjs` to accept `(comment, headSha, headCommittedAt = null, config = {})` and add a timestamp-binding fallback after the SHA-in-body fast path.
- [x] Add `fetchHeadCommittedAt` to `scripts/ai-review-gate.mjs` and thread the result into the Codex summary-comment scan.
- [x] Update `templates/docs_project/project/devops/review-contract.md` and `docs/github-ci-and-branch-protection.md` to reflect the at-or-after timestamp acceptance.

## Local Hygiene

- [x] Add `.omc` to the `walkFiles` ignored set in `scripts/shared.mjs` so the sanitizer ignores local OMC plugin metadata.
- [x] Add `.omc/` and `.codex/` to `.gitignore` so contributors do not accidentally commit per-checkout tool state.

## Verification

- [x] Add timestamp-binding test cases (acceptance at and after head commit, rejection for stale comment) to `tests/helpers.test.mjs`.
- [x] Run `pnpm run preflight`.
- [ ] Re-trigger `AI Review` on https://github.com/kiaquila/unicorn-hub/pull/3 after merge to confirm the gate passes against the existing Codex no-findings comment.
