# GitHub CI And Branch Protection

GitHub is the control plane for pull requests, checks, and AI review routing.

## PR Publication Default

`node scripts/publish-branch.mjs` creates a ready-for-review pull request by
default. Pass `--draft` only when the author explicitly wants to keep the pull
request in draft state.

## Required Workflows

- `ci.yml`: runs repository baseline checks as `baseline-checks`, unless a stack-specific profile preserves an existing target CI workflow
- `pr-guard.yml`: enforces feature-memory, context-budget, baseline, frozen-lock, registry identity/age, lightweight typosquat, install-script, and profile-scoped Python lock policy as `guard`
- `ai-command-policy.yml`: validates trusted AI command comments
- `ai-review.yml`: normalizes native review output into a required `AI Review` check
- `ai-review-rerun.yml`: reruns `AI Review` when trusted review evidence appears
- `osv-scan.yml`: scans dependencies for known vulnerabilities

Bootstrap renders the `ci.yml` and `osv-scan.yml` push filters for the target
repository's configured or discovered default branch. This ensures their
`default-head` activation evidence is produced for repositories that use names
such as `master` or `trunk`, not only `main`.

For existing repositories, `requiredChecks` comes from `.unicorn-hub/config.json`. Profiles that preserve a target CI workflow should list the target's current job names there, plus `guard`, `osv-scan`, and `AI Review` when the OSV workflow is installed. A profile excluding the OSV workflow must also omit `osv-scan`.

## Fail-Closed Rules

- Unsupported `AI_REVIEW_AGENT` values fail the check.
- Missing review-request markers and missing review evidence fail quickly instead
  of holding a runner open for the old polling window.
- Review evidence must be bound to the current PR head SHA. Native reviews compare `commit_id` to head and must be submitted after the latest trusted review-request marker for that head. Trusted no-findings Codex summaries that do not name the head SHA must be posted after the marker and must have no commit or force-push event between the source trigger comment and the summary.
- Native receipt comments require one explicit matching reviewed-commit SHA.
  Mutable structured summaries require a validated `codex-review-state:v1`
  schema, exact full current SHA, completed status, and explicit no-findings
  booleans (or separately corroborated omitted code flags as described below). Their update time must follow the request. Reactions and display
  text alone never satisfy the gate.
- Completed structured state with a visible failed, pending, running, unresolved,
  or other negative/incomplete verdict fails closed. Standard help in the
  optional details section is not a review verdict.
- The latest evidence is evaluated; negative or incomplete edits invalidate an
  earlier success. Every unresolved Codex thread blocks independently of the
  latest request, including advisory and earlier-head findings.
- Accepted negative SHA-less legacy edits are ordered by update time, while
  their request/head eligibility still uses creation time. Editing old positive
  prose cannot refresh its eligibility or outrank newer negative evidence.
- The `AI Review` gate debounces briefly and re-checks GitHub's current PR head before accepting evidence and immediately before success; stale runs fail closed.
- Privileged automation always uses the trusted default branch. Validation uses
  a read-only token and the default branch, or an independently reviewed,
  immutable source explicitly promoted by a maintainer as described below.
- Context-budget gates must run against the committed PR diff, not only the local worktree, so placeholder-only specs cannot pass after they are committed.
- Skipped required gates must not be used as a successful state.
- Node installation never falls back from a frozen lockfile; PR CI also passes `--ignore-scripts --ignore-pnpmfile`, and a missing or stale lockfile fails.
- Changed direct dependencies fail when official-registry identity, exact version, publication time, source policy, or required install-script approval cannot be proven.
- Registry outages produce a blocking “not verified” result rather than an advisory pass.

## Branch Protection Baseline

Apply after workflows are merged into the default branch:

```text
required checks:
  - baseline-checks
  - guard
  - osv-scan
  - AI Review
enforce admins: true
dismiss stale reviews: true
require conversation resolution: true
allow force pushes: false
allow deletions: false
```

If a profile preserves existing CI, replace `baseline-checks` with the repository's actual job names before applying branch protection. Stack-specific profiles (e.g., `flutter-app`) ship `requiredChecks` containing the installed Unicorn-controlled contexts (`guard`, `osv-scan`, `AI Review`); the installing team must add the target repository's real CI job names to `.unicorn-hub/config.json` after bootstrap. Hard-coded label guesses are intentionally avoided.

Unmapped consumer checks are proven on the current default-branch head. If a
consumer check runs only for pull requests, add provenance metadata so the
activation command can validate the correct workflow and base branch:

```json
{
  "requiredCheckEvidence": {
    "flutter-ci": {
      "workflow": ".github/workflows/flutter.yml",
      "mode": "pull-request"
    }
  }
}
```

Evidence scans are workflow-specific and capped at the 20 most recent runs.
Jobs, default-head check runs, and legacy statuses paginate up to 10 pages and
stop as soon as every requested context is proven.

After the workflows have run on the default branch, use
`node scripts/apply-security-settings.mjs --dry-run` and then explicitly use
`node scripts/apply-security-settings.mjs --apply` from a trusted checkout.
The activation script verifies mandatory GitHub security settings first and
then invokes `scripts/apply-branch-protection.mjs`. The latter reads Checks API
runs and legacy commit statuses on the default head, plus recent workflow-specific
pull-request runs for Unicorn's PR-only jobs. Evidence must be within the
configured freshness cutoff; PR-only evidence is accepted only when the
workflow file at the run head has the same Git blob SHA as the version now on
the default branch. This lets the installation PR prove its current workflow
version after merge without accepting evidence from an older version. The update preserves existing
required checks, approval thresholds, actor restrictions, and stricter controls,
so activation only tightens protection. It refuses the update if any configured
context is absent, and re-reads protection after mutation before reporting
success. It also supports
`--dry-run`; direct remote mutation requires `--apply`.

The implementation follows GitHub's documented repository endpoints for
[vulnerability alerts, Dependabot security updates, and repository security settings](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28),
plus the [branch protection REST API](https://docs.github.com/en/rest/branches/branch-protection?apiVersion=2022-11-28).
Secret-scanning validity checks and non-provider patterns can depend on the
repository type, plan, and current API support; the activation command reports
those optional capabilities as unsupported when GitHub rejects them for
availability reasons. Authentication, permission, and unexpected API failures
remain real errors.

Dependabot security updates are only treated as enabled when GitHub reports them
as enabled and not paused. A paused repository is planned for remediation under
`--dry-run` and re-enabled under `--apply`; if GitHub still reports the feature
as paused after the update, activation fails closed and branch protection is not
applied.

When invoked with `--apply`, `scripts/apply-branch-protection.mjs` sets required human approvals
to `0`. This keeps the solo-owner workflow usable while still requiring green
checks, AI review evidence, and conversation resolution. Repositories with more
than one maintainer should pass `--approvals 1` or a stricter value when they
want human approval to be part of branch protection.

The PR checklist complements these checks by asking the author to attach SENAR
verification evidence for each acceptance criterion and to update process memory
before merge.

## Review Trigger Reality

Most native AI backends require human-authored comments or native app triggers. GitHub Actions bot comments should not be assumed to trigger review.

The default pull request behavior is therefore:

1. `AI Review` starts in validation mode. If no trusted current-head marker or
   review evidence exists yet, it fails fast with an actionable required-check
   summary.
2. A trusted human posts the backend-native trigger, such as `@codex review`.
3. `AI Command Policy` records the PR head SHA in an `AI_REVIEW_REQUEST_ID` marker comment.
4. `AI Command Policy` reruns the failed `AI Review` check for the current PR
   head.
5. When trusted native review evidence or a trusted summary/outcome comment
   appears, `ai-review-rerun.yml` reruns `AI Review` again.
6. Wakeups share a per-PR concurrency group with command policy using
   `queue: max` to retain pending commands and evidence events. If the gate is
   active, the router waits with bounded backoff, then checks the latest attempt
   start against the evidence update. It reruns only when that event has not yet
   been evaluated, and checks the live PR head again before the rerun request.
   A timeout requests cancellation and polls until terminal state; a 202 response
   alone is never confirmation. Slow cancellation escalates to force-cancel.
   A cancelled attempt or success racing cancellation receives a fresh rerun.
   The gate has a ten-minute job limit; wakeup controllers have fifteen minutes.
   Request wakeups use the server publication time of the marker for attempt
   deduplication, while review eligibility still uses the human source time.
   Missing publication timestamps and failed rerun requests fail command policy.
   Native formal review submissions, edits, and dismissals also wake the gate.
   Mutation wakeups use the review node's verified server `updatedAt`, because
   the webhook retains the original submission time. The gate reads review
   update times through GraphQL: a negative edit or dismissal invalidates an
   earlier pass, while editing an old approval cannot renew its eligibility.
   All authenticated Codex issue-comment edits wake validation, including edits
   that remove every review marker. The gate checks server edit history for
   unknown native comments: only former review signals leave a pending tombstone;
   ordinary bot replies remain unrelated. Missing/redacted history or a mutation
   during pagination fails closed. Legacy signals are also recognized inside
   prefixed or HTML-rendered server edit summaries; diff text never grants pass. Empty formal reviews never establish no-findings evidence, including after
   the last inline finding is deleted; a fresh explicit native verdict is required.
   Edited `COMMENTED` formal reviews also remain pending.
   Fresh formal approvals and comments also reject visible failed/incomplete
   states using the same negative-state classifier as native summaries.
   Withdrawal, revocation, stopped/unavailable states, and standard non-success
   workflow conclusions are also negative across every accepted review format.
   Positive summaries/receipts accept only recognized rendering, so arbitrary
   additional finding prose cannot hide behind positive machine state. The full
   structured table is required. The latest trusted structured snapshot covers
   the whole review and must be valid, current, complete, and finding-free; a
   later code-only receipt or approval cannot override pending/negative security
   state, malformed state, or a stale snapshot. A newer complete snapshot can. Only the complete known help footer is excluded;
   a matching details label cannot hide finding text.
   Nonempty formal-review bodies need a recognized no-findings/approval verdict
   or explicit advisory priority; unknown finding prose never inherits success
   from the formal state. Inline comments are checked even on formal approvals.
   Inline review-comment creation, edits, and deletion wake validation; blocking
   inline edits use their own server update time to supersede older positives.
   Positive/advisory edits cannot refresh an older verdict. Native issue-comment
   deletions always force a fresh evaluation after active runs complete: their
   old content timestamp cannot safely deduplicate deletion events. Duplicate
   deletion deliveries may rerun twice, preserving validation over deduplication.
   Deletions also receive a durable negative-only withdrawal record from the
   default-branch `workflow_run` controller in AI Command Policy. It checks the
   source run path (including a server-bound ref suffix), event, repository, and API-associated PR (or default branch
   for issue comments), then records the server event time and live full head.
   No positive verdict at or before that time can pass. Publication precedes the
   fresh gate wakeup; delayed/duplicate delivery cannot renew old evidence.
   Edited/deleted machine review-control records also receive repair records;
   ordinary Actions diagnostics are unrelated. Control membership is encoded from
   the current or pre-edit webhook body and checked by both runtime paths. This controller
   reuses existing administrative write scope, executes only default scripts,
   and never downloads artifacts or executes source-run code. The gate and
   native-event router gain no write permissions.
   Deletion metadata distinguishes native issue-comment review signals from ordinary
   command replies; inline native findings remain review evidence. Edit histories
   reconstruct only the removed/prior side of unified or HTML diffs and retain the
   legacy start-of-body rule. Added markers and quoted legacy phrases cannot create
   withdrawal records or pending tombstones for unrelated bot replies.
7. The gate passes only if the configured backend returns an acceptable result
   for the latest PR head.


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
the current request. Only exact observed celebratory receipt closings are accepted, including `:+1:`, "Delightful!",
"Can't wait for the next one!", and "Already looking forward to the next diff.".
Unknown closings or appended findings remain non-passing. Both artifacts
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

## Updating The Review Gate Itself

Wakeup and administrative request scripts always use the default branch.
Validation also defaults to that branch, resolved to an immutable SHA, and has
only `contents: read`, `pull-requests: read`, and `issues: read`. Checkout never
persists credentials. Optional `trigger_mode=comment` writes run in a separate
default-branch job, and the write job is enabled only when the workflow itself
is dispatched from the default ref. A branch/tag diagnostic can validate with
`trigger_mode=skip` only; requesting a write there fails the actual `AI Review`
job. Request failure or cancellation also fails validation.

A parser-fix PR cannot update the default-branch parser for its own check. First
prefer genuine native formal evidence understood by the existing parser. If
the backend only emits a new native format, a maintainer can explicitly promote
an independently reviewed gate snapshot without changing required checks:

1. Inspect the exact gate snapshot, its configuration and imports. Run preflight
   and obtain genuine native review of that immutable commit. Do not establish
   trust merely because the candidate parser reports its own success.
2. Set the repository Actions variable `AI_REVIEW_GATE_PIN` to
   `<current-default-full-sha>:<independently-reviewed-gate-full-sha>`. Both must
   be full lowercase commit SHAs in the same repository. This is a deliberate
   trusted-code promotion by a maintainer, never a PR input, comment, branch
   name, or automatic fallback.
3. Obtain native review of the final PR head, including the workflow changes.
   Run or rerun the real `pull_request` workflow. It must evaluate live native
   evidence and unresolved threads using the promoted code, with a read-only
   token. No write-capable job uses the override. A manual dispatch is useful
   for diagnosis but is not a substitute for required PR check evidence.
4. Verify every required check and merge normally. Remove the variable after
   merge and verify default-branch operation. A changed default SHA invalidates
   the pin and fails closed until it is removed or independently reapproved.

Never rewrite the bot's evidence, publish a synthetic status, switch to a weaker
backend, or relax protection. If neither authentic legacy evidence nor reviewed
source promotion is available, preserve the PR and report the bootstrap blocker.

Existing consumers must refresh the three review scripts, command policy,
review workflows, and review contract together (or run bootstrap with `--force`
after reviewing consumer customizations). New bootstraps install these files
from the same blueprint version.
