# Review Contract

Reviewers check the pull request against the active feature spec, not only
against the implementation diff. Acceptance criteria, negative scenarios, and
known issues are the source of truth for expected behavior.

## Codex

Native GitHub PR review. Blocking findings use `P0`, `P1`, or `P2`. Advisory findings use `P3`.

Codex evidence must be tied to the latest PR head. Native reviews must have `commit_id` equal to the current head SHA and must be submitted after the trusted `AI_REVIEW_REQUEST_ID` marker for that head.

When Codex has no inline findings, a top-level `Codex Review:` summary comment from the trusted Codex bot also satisfies the gate only when it either names the current head SHA in its body or is posted after the trusted marker with no commit or force-push event between the source trigger comment and the summary.

## Claude

Top-level comment must start with:

```text
AI_REVIEW_AGENT: claude
AI_REVIEW_SHA: <head-sha>
AI_REVIEW_OUTCOME: pass|advisory|block
```

Only `pass` satisfies the gate.

## Gemini

Native GitHub PR review from the configured app. Critical or high-severity findings block merge.
