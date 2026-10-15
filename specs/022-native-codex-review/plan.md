# Plan: Native Codex Review Compatibility

## Approach

Parse native envelopes strictly, retain temporal binding for SHA-less legacy comments, evaluate the latest evidence with failure winning ties, and query all unresolved Codex threads independently of request boundaries. Recheck the live head immediately before success.

Serialize evidence wakeups per PR and wait briefly for active runs before deciding whether a newer attempt has already evaluated the event. Revalidate the PR head before rerunning. Keep privileged automation on default-branch scripts.

## Verification

| Criteria | Evidence |
| --- | --- |
| AC-001, AC-002 | Parser and gate integration regressions with synthetic full SHAs, native envelopes, conflicting verdicts, unresolved threads, and a final-head race. |
| AC-003 | Runtime-router and mocked Actions API tests for created/edited events, active/completed runs, deduplication, and head movement. |
| AC-004 | Bootstrap execution, generated-workflow tests, and `pnpm run preflight`. |
| AC-005 | Real native current-head review and unchanged GitHub protection; use a trusted formal review on initial rollout if the old gate cannot parse receipts. |

## Risks

Mutable summary comments need `updated_at` and exact full-SHA validation. Workflow filters are routing hints, never review verdicts. Initial rollout can be blocked by old trusted scripts; do not run unreviewed PR code with elevated credentials or synthesize a status to bypass it.
