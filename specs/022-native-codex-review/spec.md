# Spec: Native Codex Review Compatibility

## Goal

Accept authenticated native Codex receipts and current-head structured summaries without weakening review or branch protection.

## Scope

Update evidence parsing, selection, final head validation, event routing, bounded reruns, installable workflows, and the review contract. Preserve legacy comments and formal reviews.

## Acceptance Criteria

- AC-001: Trusted legacy, receipt, structured-summary, and formal evidence passes only for the requested current head with an explicit acceptable verdict.
- AC-002: Invalid, conflicting, stale, forged, incomplete, or unresolved evidence fails closed; a new request cannot erase findings.
- AC-003: Created and edited evidence wakes the actual gate, including events received during an active run; deletion creates a durable server-timed withdrawal record before a fresh evaluation. Cancellation is observed to terminal state. Duplicate deliveries reuse existing records.
- AC-004: Bootstrap installs the corrected scripts and workflows; template parity and full preflight pass.
- AC-005: Initial rollout retains default-branch privileged automation and real required checks; an independently reviewed immutable gate can be explicitly promoted for read-only validation, bound to the current default SHA.

- AC-006: A completed summary with both code findings flags omitted is pending alone. A separate trusted, exact-head, current-request v1 no-findings receipt can corroborate only its code verdict; active security remains strict. Both artifacts must follow any withdrawal they clear.

## Negative Scenarios

Wrong or missing receipt SHA, duplicated markers, malformed state, negative or incomplete verdicts, stale edited summaries, unresolved findings from an earlier request/head, and a push during evaluation must never produce success for the latest head.
