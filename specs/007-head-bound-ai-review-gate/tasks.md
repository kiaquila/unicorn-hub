# Tasks: Head-Bound AI Review Gate

- [x] Add trusted review-request marker helpers.
- [x] Record review-request markers from `AI Command Policy`.
- [x] Require marker-bound current-head Codex evidence in `AI Review`.
- [x] Add debounce and current-head refresh before accepting evidence.
- [x] Update root and template workflows.
- [x] Update docs and template review contract.
- [x] Add helper tests for marker binding and stale summary rejection.
- [x] Ensure bootstrap and baseline checks install the new command-policy script.
- [x] Compare Codex evidence against marker creation time, not the source trigger time.
- [x] Skip the policy workflow on bot-authored comments to prevent recursive runs from administrative triggers.
- [x] Replace timeline event-id matching with `created_at` boundaries so the no-findings summary path is robust to GitHub's timeline-vs-issue-comment id divergence.
- [x] Use the source trigger comment's `created_at` as the evidence cutoff so Codex reviews that land before the marker comment is posted are still accepted for the same head.
- [x] Document downstream-consumer migration: existing bootstrapped repos must re-run `node scripts/bootstrap-repo.mjs --force` (or copy `scripts/ai-command-policy.mjs`) before the new `AI Command Policy` workflow runs.
- [x] Run full preflight before publishing.
