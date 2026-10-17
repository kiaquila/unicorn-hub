# Tasks: Native Codex Review Compatibility

## Implementation

- [x] T001 Reproduce the leading-receipt regression and inspect the installed control plane.
- [x] T002 Implement strict native parsing, evidence ordering, unresolved-thread checks, and final-head validation.
- [x] T003 Fix runtime and workflow routing, bounded active-run wakeups, and duplicate suppression.
- [x] T004 Update templates, bootstrap regressions, and durable review documentation.
- [x] T004a Isolate read-only validation from default-branch writes and add explicit immutable, base-bound source promotion for initial rollout.
- [ ] T005 Run full preflight, publish, and obtain native review of the final head.
- [ ] T006 Verify all gates and threads, wait 120 seconds, and merge normally.

## Process Memory

- Receipt-prefixed native comments were rejected by both the classifier and rerun router; the workflow prefix filter independently prevented wakeups.
- Structured summaries are mutable; creation time alone cannot bind a new review to its request.
- A native review request marker never resolves existing findings.

- Native review identified pending-run eviction in a shared concurrency group;
  both workflows now use GitHub's documented `queue: max` semantics.
- Native review identified stale/incomplete active security state; every active
  review state must now be completed and finding-free on the exact head.
- Native review identified dispatch workflow provenance: checking out default
  scripts alone does not make a branch's workflow definition trusted. The write
  job now requires the default workflow ref; a non-default comment request fails.
- Native review identified a negative legacy-edit ordering gap. Accepted
  negative edits now use update time for ordering while keeping creation-time
  eligibility; regression tests first reproduced the false green, then passed.
- Native review identified delayed-marker deduplication and visible structured
  status conflicts. Request wakeups now use marker publication time, and a
  visible failed/incomplete verdict blocks completed JSON. Both regressions
  reproduced the original false behavior before their fixes.
- Native review caught underscore normalization joining compound negative states.
  Underscores now remain separators; enum, compact/camel-case, dotted, hyphenated,
  and Markdown-styled compound failures have regression coverage.

- Native review identified missing formal-review edit/dismissal subscriptions.
  Both mutation events now wake validation using verified server update time;
  the gate uses GraphQL review updates so negative edits and dismissals
  supersede earlier receipts without renewing stale approvals.

- Native review identified destructive edits that remove all envelope markers.
  Trusted Codex edits now always wake validation; withdrawn review content
  invalidates older passes. Runtime, installed workflow, and evidence
  regressions first reproduced the stale-green behavior, then passed.

- Native review caught withdrawn `COMMENTED` reviews and unrelated bot replies.
  Formal edits now revoke implicit no-findings acceptance. Pending issue-comment
  tombstones require a former review signal from server edit history; ordinary
  replies remain unrelated. History pagination, redaction, and concurrent edits
  have actual-entry-point regressions.

- Native review caught fresh formal reviews accepting contradictory failed or
  pending text. Formal review classification now shares the summary negative-state
  check before accepting either APPROVED or implicit COMMENTED evidence. Fresh
  and folded negative states have actual-entry-point regression coverage.

- Native review identified omitted withdrawal/revocation wording. The shared
  classifier now rejects withdrawn, revoked, stopped/unavailable states and
  standard non-success workflow conclusions and negated completion across receipts, structured
  summaries, and both formal review states. The matrix regression reproduced
  the withdrawal false green before the fix, then passed.

- Comprehensive native review identified untagged formal finding prose, deleted
  issue evidence, and missing inline-comment mutation events. Formal bodies now
  need recognized positive evidence or advisory priority; inline findings apply
  to approvals too. Deletions force reevaluation without stale-time deduplication,
  and blocking inline edits supersede earlier positives using their update time.
  Four targeted regressions fail against the preceding commit in a synthetic
  checkout and pass with the fix; the actual gate also rejects removed evidence.

- Native review identified arbitrary prose appended to positive native envelopes,
  empty formal reviews resurrecting success after inline deletion, and active-run
  timeouts losing invalidation events. Positive rendering is now allowlisted;
  empty formal reviews are pending until an explicit verdict. Timeout cancels the
  stale evaluation, with completion/cancellation races covered by a real rerun.
  Regressions exercise classifiers, the actual gate, and the Actions API boundary.

- Native review caught the minimal Completed shortcut, unverified help-footer
  contents, deletion tombstones ordered at original submission time, and treating
  accepted cancellation as terminal. Full native tables and complete known
  footers are required. A default-branch workflow-run controller persists
  negative-only server-timed withdrawal records using existing administrative
  scope. The read-only gate rejects positives preceding those records. Cancellation
  remains under observation through terminal state and a fresh rerun, including
  successful and slow/force-cancel races. Bootstrap verifies the recorder too.

- Native review identified ref-qualified workflow API paths, legacy markers inside
  rendered edit diffs, and overly broad machine-comment withdrawal. Source refs
  are bound to server branch/SHA/default/PR metadata; edit-summary recognition is
  negative-only. Machine withdrawals require review-control membership encoded
  from current or pre-edit webhook content; ordinary diagnostics are unrelated.

- Additional cross-format verification reproduced a code-only receipt overriding
  active security review in an earlier structured snapshot. The latest trusted
  structured snapshot is now authoritative for the whole review: pending,
  negative, malformed, and stale state cannot be erased by a later receipt or
  approval. A newer complete structured result restores success. Classifier and
  actual-entry-point regressions cover code and active security state together.

- Native findings on ordinary-comment deletion and edit-summary false positives
  are covered by body-membership metadata and prior-side diff reconstruction.
  Added markers and quoted legacy phrases stay unrelated; removed genuine
  markers and inline findings retain their blocking behavior.

- Whole-review withdrawals now survive both marker-removing edits and deletion:
  complete server histories identify prior structured state, and durable records
  require a newer complete structured result. Destructive edits persist before
  the cleared comment can disappear. Legacy routing and acceptance share a
  case-insensitive column-zero grammar; whitespace-prefixed legacy bodies do not
  establish a positive verdict.

- The ordinary router defers destructive native events and machine control
  mutations to the durable controller. Actual-CLI regression coverage forbids
  any direct API access before that controller records the withdrawal, closing
  the independent-writer/direct-rerun race.

- Zero-wait validation always evaluates its first evidence snapshot. An advancing
  synthetic clock reproduces the skipped-first-poll race without timing sleeps;
  positive, negative, and moved-head outcomes remain enforced.

- A genuine clean native run exposed completed code summaries with null findings
  flags plus a separate SHA-bound v1 no-findings receipt. The summary alone stays
  pending; both artifacts are validated without rewriting null state. The
  corroborating receipt must follow the current request and any withdrawal;
  active security state still requires explicit complete finding-free fields.
  The observed thumbs-up receipt suffix has narrow positive-rendering coverage.

- Code-only positive receipts and legacy verdicts now retain publication time
  after edits. Classifier and actual-gate regressions reproduce a positive edit
  masking an intervening failure, including omitted-flag corroboration, and
  verify that a genuinely new native receipt can restore a positive result.

- Prior-side edit reconstruction preserves the original body's leading whitespace.
  Raw, unified, and HTML diff regressions verify that ordinary whitespace-prefixed
  legacy-like text cannot invalidate a later valid receipt, while column-zero
  verdict withdrawals still block the actual gate.

- Unified history retains removed horizontal rules and header-like body content.
  Only paired file headers before a hunk are metadata, and a partial hunk below
  line one cannot establish a legacy start-of-body signal. Actual-gate regressions
  cover both false tombstones and genuine full-body withdrawals.

- HTML history removes only diff markup and retains structural containers.
  Quote, list, code, paragraph, span, and div regressions ensure legacy-like
  ordinary text cannot create a tombstone while explicit receipt markers remain
  recognizable throughout the original body.

- HTML history preserves container boundaries while excluding tag names and
  quoted attributes from signal text. Regressions cover marker-like attributes,
  quoted angle brackets, custom tag names, and nested insertions; genuine prior
  structured HTML-comment markers remain recognized.

## Known Issues

Initial rollout requires independent native review of the promoted snapshot and final head, with unchanged protection and the real PR workflow. The temporary repository source pin must be removed after merge.

## Verification Evidence

- Full `pnpm run preflight` passed: 187 tests, sanitizer, baseline, syntax,
  feature memory, context budget, and generated workflow parity.
- Gate integration tests execute the actual workflow entry point with a
  synthetic GitHub API, including GraphQL failures and a push before success.
- Native review and initial trusted-parser rollout remain deployment gates.
- Source-promotion tests execute the actual workflow shell against a synthetic
  Git repository; branch names, partial SHAs, injection strings, stale base pins,
  and failed request jobs cannot select a gate or produce a passing validation.
