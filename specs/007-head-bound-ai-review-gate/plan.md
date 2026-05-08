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

## Decisions and Dead Ends

- Source trigger time over marker comment time. The cutoff for accepting Codex evidence is the trusted source trigger comment's `created_at`, not the marker comment's own `created_at`. The `AI Command Policy` workflow can run several seconds to minutes after the trigger; gating on the marker's post time would silently reject Codex reviews that legitimately ran for the trigger's head SHA. The marker still attests trust; the cutoff records when the human asked.
- Timestamp boundaries over event-id matching. The timeline check uses `created_at` boundaries on `committed`/`head_ref_force_pushed` events instead of finding events by id. GitHub's issue-timeline endpoint exposes timeline-event ids that do not always match the issue-comment ids on `commented` rows, which made the previous id-based check silently fail closed. Timestamp boundaries are stable across endpoints.
- Bot author guard at the workflow `if:` and the script. The administrative trigger comment posted by `AI Review` in `comment` mode contains the same `@codex` / `@claude` / `/gemini` literals that fire the policy workflow. Filtering bot authors at both the workflow `if:` and the script avoids a recursive run plus a confusing rejection comment on every administrative trigger.
- Marker authentication remains author-based. We considered HMAC-signing the marker body with a workflow secret, but that adds a secret rotation surface for marginal benefit: a non-bot account already cannot forge a marker, and a malicious workflow that can post as `github-actions[bot]` already has a stronger attack surface than the gate. Out of scope for this PR; track in follow-up if the bot-author trust boundary tightens.
- Marker pipeline scope. Markers are written for all three agents (codex/claude/gemini) but only consumed by the codex evidence path. Claude continues to emit a marker comment with `AI_REVIEW_OUTCOME` and Gemini relies on its native review's `commit_id`. Extending the marker contract to claude/gemini is intentional follow-up.
- Edited and double-trigger comments. The policy workflow listens to `types: [created]` only. Editing a trigger comment after marker write does not invalidate the marker, and a rapid double trigger writes two markers for the same head; `latestAiReviewRequestMarker` returns the most recent. Both are acceptable for this PR; revisit if operators report stuck loops.
