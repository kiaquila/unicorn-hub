# Spec: Head-Bound AI Review Gate

## Goal

Make Codex review evidence satisfy `AI Review` only when it is tied to the
latest pull request head and to a trusted review request.

## Acceptance Criteria

- AC-001: Trusted review comments create an `AI_REVIEW_REQUEST_ID` marker that records the current PR head SHA.
- AC-002: Codex native reviews satisfy the gate only when their `commit_id` equals the current PR head and they were submitted after the marker for that head.
- AC-003: Codex no-findings summary comments without a SHA satisfy the gate only when they are posted after the marker and no head-changing event occurs between the source trigger and the summary.
- AC-004: Stale `AI Review` runs re-check the current GitHub PR head after a debounce window and stop without satisfying the latest head when the PR moved.
- AC-005: Templates, docs, and tests describe and verify the marker-bound current-head contract.

## Negative Scenarios

- A stale Codex review for an older commit must not satisfy the gate after a newer commit is pushed.
- A timestamp-only no-findings summary must not satisfy the gate without a matching request marker.
- A forged request marker from a non-`github-actions[bot]` account must not satisfy the gate.
