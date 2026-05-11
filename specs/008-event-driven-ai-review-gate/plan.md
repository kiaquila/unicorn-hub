# Plan: Event-Driven AI Review Gate

## Summary

The current `AI Review` job uses runner time as a waiting room: every
`pull_request` run can poll for up to 20 minutes while waiting for review
evidence that may never arrive. The native fix is to make the required check
short-lived and rerunnable by GitHub events:

1. `AI Review` validates existing current-head evidence and otherwise fails
   fast with an actionable reason.
2. `AI Command Policy` records the trusted review-request marker and reruns the
   `AI Review` workflow for the current PR head.
3. Review-result events rerun `AI Review` once evidence appears.

## Implementation Outline

- Add a fast-fail path to `scripts/ai-review-gate.mjs` for missing current-head
  request markers.
- Keep a bounded, short wait only when an event just created a marker or review
  evidence and GitHub API propagation may lag.
- Add native rerun support through the GitHub Actions workflow-runs API.
- Give only the workflows that rerun checks `actions: write`; keep validation
  workflows on read/minimal permissions where possible.
- Add a small event router for `pull_request_review` and relevant
  `issue_comment` evidence comments if needed.
- Update templates and root workflows together.
- Update docs explaining that `AI Review` is required but event-driven, not a
  20-minute polling loop.

## A/B Test Procedure

Control cohort:

- Source: GitHub Actions historical `ai-review.yml` `pull_request` runs.
- Captured: 2026-05-11 20:49:55Z.
- Scope: completed, non-skipped runs only; cancelled runs count for consumed
  duration.
- Grouping: PR head branch.
- Result: 289.02 total runner-minutes across 8 PR/head-branch groups, 36.13
  average runner-minutes per PR, 304 rounded job-minutes, 38 rounded
  job-minutes per PR.

Treatment cohort:

- Source: the same GitHub Actions APIs after this feature reaches `main`.
- Scope: first 8 PR/head-branch groups after merge, or all groups after 14
  calendar days.
- Primary metric: average `AI Review` job runner-minutes per PR/head branch.
- Secondary metric: total AI-review control-plane runner-minutes, including
  `ai-review.yml`, `ai-command-policy.yml`, and any new rerun-router workflow.
- Success threshold: `AI Review` average at or below 9.03 runner-minutes per PR
  and rounded job-minutes at or below 10 per PR.

## Verification

- Unit tests for marker-missing fast-fail, stale-head rejection, and accepted
  evidence pass.
- Workflow tests assert the required check still runs on `pull_request`, uses
  concurrency cancellation, and does not rely on workflow-level skips.
- `pnpm run preflight`
- After merge, run the post-change measurement script and record the result in
  `tasks.md`.

## Decisions and Constraints

- Keep `AI Review` as the branch-protection required check. Required checks must
  report against the latest PR head, so the check itself remains the merge
  signal.
- Do not replace the required check with a skipped workflow. GitHub treats some
  skipped job states as successful, but a skipped workflow can also leave a
  required check pending; both are the wrong contract for this gate.
- Do not introduce a GitHub App for this iteration. A GitHub App-backed Checks
  API check would be cleaner long term, but the portable blueprint should first
  use native Actions and repository permissions.
- Keep the post-change measurement honest by counting any new rerun-router
  workflow in the secondary control-plane metric.
- Grant `pull-requests: write` to `ai-command-policy.yml` and `ai-review.yml`.
  Issue comments on pull requests require the `pull-requests` permission, not
  `issues`, even though the REST endpoint lives under `/issues/{n}/comments`.
  Without this, the marker write fails with `403 Resource not accessible by
  integration` and the gate can never observe a trusted current-head request.
