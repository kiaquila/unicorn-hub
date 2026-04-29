# Review Contract

## Codex

Native GitHub PR review. Blocking findings use `P0`, `P1`, or `P2`. Advisory findings use `P3`.

When Codex has no inline findings, a top-level `Codex Review:` summary comment from the trusted Codex bot also satisfies the active gate cycle only if it names the current head SHA.

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
