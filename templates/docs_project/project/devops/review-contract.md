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
boolean `has_any_findings: false` and `has_unresolved_findings: false` for a
standalone verdict. Omitted code flags require a separate current-request receipt
as described below; null fields alone never establish success. Schema,
types, duplicate markers/fields, and conflicting visible verdicts are validated.
Visible failure or incomplete statuses cannot be hidden by completed JSON;
compound enum-style negative statuses remain blocking after normalization.
Positive summaries and receipts allow only recognized positive renderings;
arbitrary additional prose remains non-successful even without a severity tag.
Structured results require the full native table; bare completed text is not
a supported rendering. If structured state exists, its latest trusted snapshot
must be valid, current, complete, and finding-free. Later code-only receipts or
approvals cannot override pending/negative security work, malformed state, or a
stale snapshot; a newer complete structured result is required. Only the complete known standard help footer is excluded;
a matching details label cannot hide arbitrary review prose.
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

Formal reviews reject negative/incomplete state text and unrecognized finding
prose. Nonempty bodies require a recognized no-findings/approval verdict or an
explicit advisory priority. Inline findings are checked on both commented and
approved reviews; blocking inline edits use their own update time, while
positive edits cannot renew old approval eligibility. Edited COMMENTED reviews
remain pending. Empty formal reviews are also pending: deletion of the last
inline finding cannot itself create positive evidence; require a fresh explicit
native verdict.

Created, edited, and deleted native comments, plus formal review and inline
review-comment mutations, wake the gate. Deletions always force a fresh check;
the deleted comment's old update time cannot suppress this rerun. Ordinary bot
replies remain unrelated: pending withdrawal tombstones require a former review
signal verified from complete server edit history.

The default-branch workflow-run controller persists negative-only deletion
records using the existing administrative write scope. Source path and its server-bound ref suffix, event,
repository, and PR association/default branch are checked from server run
metadata. Each record binds the live full head and server event time; positives
at or before that time cannot pass. The record is published before waking the
real gate. Delayed or duplicate events retain their original event time, and
machine review-control edits/deletions are repaired. Ordinary Actions diagnostics
remain unrelated. Control membership uses the current or pre-edit webhook body
and is checked by both runtime paths. The controller executes only default
scripts, downloads no artifacts, and never executes source-run code. Validation
and the native-event router gain no write scope.

Wakeup routing never
constitutes an acceptable verdict. Per-PR serialization with `queue: max`, a bounded active-run
wait, and attempt timestamps prevent lost wakeups and duplicate reruns. A wait
timeout requests cancellation, confirms terminal state by polling, escalates
to force-cancel when needed, and schedules a fresh rerun even if stale success
won the cancellation race. The gate has a ten-minute job limit; controllers
have fifteen minutes. A newer
negative or incomplete edit re-evaluates a previously successful gate.
Request wakeup deduplication uses the marker's server publication time, while
native-review eligibility retains the human source request time. Missing marker
timestamps and rerun API failures fail command policy explicitly.

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

Deletion metadata distinguishes native issue-comment review signals from ordinary
command replies; inline native findings remain review evidence. Edit histories
reconstruct only the removed/prior side of unified or HTML diffs and retain the
legacy start-of-body rule. Added markers and quoted legacy phrases cannot create
withdrawal records or pending tombstones for unrelated bot replies.


Whole-review state survives marker removal and deletion. The gate reads complete
server edit histories for code-only receipts as well as ordinary replies, and
retains structured-summary withdrawal state. Durable withdrawal records require a
newer complete structured snapshot; a later code-only receipt or approval cannot
clear them. Destructive native edits persist a record before a cleared comment
can itself disappear. Normal structured-summary updates do not fence their own
completion.

Legacy top-level verdicts must start at column zero, case-insensitively, matching
Actions `startsWith`. Leading whitespace is outside the accepted legacy grammar;
edit history preserves that whitespace and Markdown content after removing only
diff prefixes and paired file headers before the first hunk. Partial hunks below
line one cannot establish a start-of-body legacy verdict. HTML history removes
diff-specific `del`/`ins` markup, preserving text, evidence-bearing HTML comments,
and container boundaries. Tag names and quoted attributes are excluded; nested
insertions are removed completely. Real diff markup is tokenized before retained
text entities are decoded, so escaped tags cannot close an insertion.
Explicit receipts and structured envelopes retain their own marker rules.

Destructive native events and machine review-control mutations defer in the
ordinary rerun router. Only the default-branch withdrawal controller wakes their
validation, after the durable negative record has been published. A direct rerun
cannot race the independent writer and briefly restore an older positive result.


The read-only gate also checks server-listed withdrawal source runs for this PR
since its creation. A source requires its exact trusted durable record even while
the separate writer is queued, running, or failed; later positive wakeups cannot
publish green before that fence. Writer and gate share provenance validation.
Records already persisted on an earlier head prove that source was processed;
current-head records still require a newer complete structured snapshot. This
uses `actions: read` only. API errors, changing/incomplete pagination, and the
Actions search limit fail closed instead of silently skipping sources. A deleted
durable record must be restored by replaying its original default-branch
controller; later reviews or replacement records cannot silently erase its source.

When the native backend omits both code findings flags in a completed summary,
that summary remains pending by itself. The gate can corroborate it only with a
separate trusted v1 no-findings receipt bound to the exact head and created after
the current request. Legacy receipt closings remain strict: unseen presentation text alone never
approves. A current-request complete structured snapshot with explicit
false findings flags independently establishes the verdict; arbitrary English
never determines machine success. Unknown receipt prose remains pending. Only a strictly newer affirmative snapshot
can supersede it; pending wins an equal timestamp. Structured success must follow the current request.
Both artifacts
must be newer than any withdrawal they clear. Mixed null/boolean flags, missing
receipts, formal approvals, stale or edited older receipts, and unknown active
security flags cannot fill the missing code verdict. Security and visible status
must still be fully complete and consistent. The paired verdict uses the older
of the summary update and receipt publication times, so it cannot renew an older
receipt over intervening negative evidence. Source state is never rewritten.

Positive code-only receipts and legacy verdicts retain their original publication
time even when edited. A benign edit cannot make them newer than an intervening
failure or request. Negative edits still use server update time; only structured
snapshots can publish a fresh whole-review verdict through an edit.

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
