# GitHub CI And Branch Protection

GitHub is the control plane for pull requests, checks, and AI review routing.

## Required Workflows

- `ci.yml`: runs repository baseline checks as `baseline-checks`
- `pr-guard.yml`: enforces documentation and feature-memory coverage as `guard`
- `ai-command-policy.yml`: validates trusted AI command comments
- `ai-review.yml`: normalizes native review output into a required `AI Review` check
- `osv-scan.yml`: scans dependencies for known vulnerabilities

## Fail-Closed Rules

- Unsupported `AI_REVIEW_AGENT` values fail the check.
- Missing review evidence fails the check.
- Review evidence must match the current PR head SHA, or be a fresh Codex no-findings summary comment for the active gate cycle.
- Gate scripts must run from the trusted default branch, not PR-supplied code.
- Skipped required gates must not be used as a successful state.

## Branch Protection Baseline

Apply after workflows are merged into the default branch:

```text
required checks:
  - baseline-checks
  - guard
  - AI Review
enforce admins: true
dismiss stale reviews: true
require conversation resolution: true
allow force pushes: false
allow deletions: false
```

Use `scripts/apply-branch-protection.mjs` from a trusted local checkout.

By default, `scripts/apply-branch-protection.mjs` sets required human approvals
to `0`. This keeps the solo-owner workflow usable while still requiring green
checks, AI review evidence, and conversation resolution. Repositories with more
than one maintainer should pass `--approvals 1` or a stricter value when they
want human approval to be part of branch protection.

## Review Trigger Reality

Most native AI backends require human-authored comments or native app triggers. GitHub Actions bot comments should not be assumed to trigger review.

The default pull request behavior is therefore:

1. `AI Review` starts in skip/poll mode.
2. A trusted human posts the backend-native trigger, such as `@codex review`.
3. The gate polls for current-head review evidence.
4. The gate passes only if the configured backend returns an acceptable result.
