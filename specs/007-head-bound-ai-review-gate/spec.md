# Spec: Head-Bound AI Review Gate

## Goal

Make Codex review evidence satisfy `AI Review` only when it is tied to the
latest pull request head and to a trusted review request.

## Acceptance Criteria

- AC-001: Trusted review comments create an `AI_REVIEW_REQUEST_ID` marker that records the current PR head SHA and the source trigger timestamp.
- AC-002: Codex native reviews satisfy the gate only when their `commit_id` equals the current PR head and they were submitted at or after the trusted source trigger time recorded in the marker.
- AC-003: Codex no-findings summary comments without a SHA satisfy the gate only when a matching marker exists for the current head and no head-changing event occurs between the source trigger time and the summary creation time.
- AC-004: Stale `AI Review` runs re-check the current GitHub PR head after a debounce window and stop without satisfying the latest head when the PR moved.
- AC-005: Templates, docs, and tests describe and verify the marker-bound current-head contract.
- AC-006: The `AI Command Policy` workflow ignores comments authored by bots so the gate's own administrative trigger comment cannot trigger the workflow recursively.

## Negative Scenarios

- A stale Codex review for an older commit must not satisfy the gate after a newer commit is pushed.
- A timestamp-only no-findings summary must not satisfy the gate without a matching request marker.
- A forged request marker from a non-`github-actions[bot]` account must not satisfy the gate.
- A bot-authored comment containing a trigger keyword (`@codex review`, `@claude review once`, `/gemini review`) must not start a new policy workflow run.
