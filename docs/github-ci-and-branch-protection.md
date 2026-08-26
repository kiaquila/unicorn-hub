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
- The `AI Review` gate debounces briefly and re-checks GitHub's current PR head before accepting evidence; stale runs exit without satisfying the latest head.
- Gate scripts must run from the trusted default branch, not PR-supplied code.
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
6. The gate passes only if the configured backend returns an acceptable result
   for the latest PR head.
