# Spec: Codex Summary Comment Timestamp Binding

## User Stories

### US1: Codex No-Findings Path Is Reachable in Production

As a repository owner, I want the AI Review gate to accept the actual no-findings response from `chatgpt-codex-connector[bot]`, so that PRs do not stall for 20 minutes waiting on an unsatisfiable summary-comment match when Codex Cloud has already approved the change.

## Requirements

- FR-010a: A trusted no-findings `Codex Review:` summary comment satisfies the gate when its `created_at` is at or after the head commit's `committer.date`.
- FR-010b: The pre-existing SHA-in-body fast path continues to satisfy the gate without consulting timestamps.
- FR-010c: Stale no-findings summaries from prior heads, identified by `created_at` strictly before the head commit timestamp, must not satisfy the gate.

## Success Criteria

- SC-001: `pnpm run preflight` passes locally on the fix branch.
- SC-002: `tests/helpers.test.mjs` covers the at-or-after timestamp acceptance, the stale-comment rejection, and preserves the existing SHA-in-body acceptance.
- SC-003: After the fix lands on the default branch, re-triggering `AI Review` on a PR whose only Codex evidence is the generic `Codex Review: Didn't find any major issues. Can't wait for the next one!` comment passes the gate without further intervention.
