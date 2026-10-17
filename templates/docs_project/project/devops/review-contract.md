# Review Contract

Reviewers check the pull request against the active feature spec, not only
against the implementation diff. Acceptance criteria, negative scenarios, and
known issues are the source of truth for expected behavior.

## Codex

Native GitHub PR review. Blocking findings use `P0`, `P1`, or `P2`. Advisory findings use `P3`.

Codex evidence must be tied to the latest PR head. Native reviews must have `commit_id` equal to the current head SHA and must be submitted after the trusted `AI_REVIEW_REQUEST_ID` marker for that head.

Trusted Codex no-findings comments support both legacy `Codex Review:` bodies and
native `<!-- codex-review-receipt:v1 -->` receipts. Receipts require exactly one
`**Reviewed commit:**` binding (10–40 hexadecimal characters matching the current
full head). Explicit stale or malformed bindings never fall back to timestamps.
SHA-less legacy comments require a matching trusted marker and no intervening
head-changing timeline event.

Mutable `<!-- codex-pull-request-review-summary -->` comments can supply evidence
only with one valid `codex-review-state:v1` object. The object must contain the
exact current full `code_review.commit_sha`, `status: "completed"`, and explicit
boolean `has_any_findings: false` and `has_unresolved_findings: false`. Schema,
types, duplicate markers/fields, and conflicting visible verdicts are validated.
The inactive security-review state has null fields; active security state must
be well formed, completed, finding-free, and bound to the exact current head. Bare headings, reactions,
and visible "Completed" text do not prove review success.

Evidence must be at or after the source request time. Explicitly head-bound
mutable evidence uses `updated_at`; SHA-less legacy evidence uses `created_at`.
An accepted negative legacy edit is ordered by `updated_at` to invalidate older
success, while its request/head eligibility remains bound to `created_at`.
The latest result wins, with failure winning timestamp ties. All unresolved
Codex threads block, including advisory or earlier-head findings, independently
of the request marker. The gate rechecks the live PR head before success.

Both created and edited native comments wake the gate. Wakeup routing never
constitutes an acceptable verdict. Per-PR serialization with `queue: max`, a bounded active-run
wait, and attempt timestamps prevent lost wakeups and duplicate reruns. A newer
negative or incomplete edit re-evaluates a previously successful gate.

Validation has a read-only token; administrative writes remain in an isolated
default-branch job that can run only from the default workflow ref. Non-default
diagnostic dispatches cannot request writes. Validation normally checks out an
immutable default-branch SHA.
For a parser's initial rollout, a maintainer may set repository variable
`AI_REVIEW_GATE_PIN=<default-full-sha>:<independently-reviewed-gate-full-sha>`
only after inspecting, testing, and obtaining genuine native review of that
gate snapshot. The pin is not a PR input or an automatic fallback, and expires
when the default SHA changes. The final PR head still needs real current-head
native evidence, resolved threads, and all real required checks. Remove the pin
after merge; never use a synthetic status or relax protection.

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
