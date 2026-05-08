# Plan: Head-Bound AI Review Gate

## Summary

The existing Codex gate accepts native reviews by `commit_id` and no-findings
summary comments by timestamp. That leaves two weak spots: review comments can
race with rapid pushes, and summary comments have no GitHub `commit_id`.

This change introduces a trusted request marker created by `AI Command Policy`
for every trusted review trigger. The gate then treats GitHub's current PR head
as the source of truth and accepts Codex evidence only when it is bound to that
head and the matching marker.

## Implementation

- Add marker creation/parsing helpers in `scripts/ai-review-helpers.mjs`.
- Replace the inline `actions/github-script` policy body with `scripts/ai-command-policy.mjs`.
- Update `scripts/ai-review-gate.mjs` to debounce, re-fetch the PR head, require a marker for Codex evidence, and reject summary comments if the timeline moved between source trigger and summary.
- Keep the native review fast path for exact `commit_id` matches, but only after the marker timestamp.
- Update root and template workflows together through `scripts/sync-workflows.mjs`.
- Update operator docs and template review contract.
- Add helper tests for marker parsing, stale summary rejection, and removal of the timestamp-only fallback.

## Verification

- `node --check scripts/ai-review-helpers.mjs scripts/ai-command-policy.mjs scripts/ai-review-gate.mjs`
- `node --test tests/helpers.test.mjs`
- `pnpm run preflight`
