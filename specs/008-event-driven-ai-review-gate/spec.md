# Spec: Event-Driven AI Review Gate

## Goal

Replace the long-running `AI Review` polling gate with a native GitHub
Actions flow that fails fast when review evidence is missing, reruns when a
trusted review request or review result appears, and materially reduces GitHub
Actions runner minutes per pull request.

## Baseline Measurement

Captured on 2026-05-11 at 20:49:55Z from GitHub Actions using completed,
non-skipped `ai-review.yml` `pull_request` runs. Historical runs were grouped by
PR head branch because GitHub's workflow-run API did not always retain PR
numbers for merged historical runs.

| Metric | Baseline |
| --- | ---: |
| PR/head-branch groups | 8 |
| `AI Review` runs | 28 |
| Total `AI Review` runner-minutes | 289.02 |
| Total rounded job-minutes | 304 |
| Average runner-minutes per PR | 36.13 |
| Average rounded job-minutes per PR | 38.00 |
| Failure runs lasting at least 19 minutes | 10 |

The A/B control is this baseline. The treatment is the first comparable sample
after the event-driven gate lands.

## A/B Measurement Contract

Primary metric: average `AI Review` job runner-minutes per PR/head branch.

Secondary metrics:

- average rounded `AI Review` job-minutes per PR/head branch
- total AI-review control-plane runner-minutes, including `AI Command Policy`
  and any new rerun-router workflow introduced by this change
- count of `AI Review` failure runs lasting at least 19 minutes
- time from trusted review request marker to passing `AI Review`
- count of required-check states left pending after review evidence exists

The post-change measurement must use the same grouping rule as the baseline:
group completed, non-skipped `ai-review.yml` `pull_request` runs by PR head
branch, and include cancelled runs for the minutes they consumed. If a new
workflow is added only to rerun `AI Review`, include it in the secondary
control-plane metric but keep the primary metric focused on the required
`AI Review` job.

Success threshold:

- average `AI Review` runner-minutes per PR is at least 75% lower than the
  36.13-minute baseline, i.e. at or below 9.03 runner-minutes per PR
- average rounded `AI Review` job-minutes per PR is at or below 10
- no missing-evidence failure waits for the old 20-minute polling window
- stale PR heads still fail closed and never satisfy branch protection

Post-change sample:

- measure the first 8 PR/head-branch groups after this change reaches `main`,
  or all PR/head-branch groups after 14 calendar days, whichever comes first
- publish the measurement in the feature `tasks.md` process-memory section
  before declaring the PR fully validated

## Acceptance Criteria

- AC-001: On `pull_request`, `AI Review` exits quickly when no current-head
  trusted review request marker exists and reports the missing requirement
  clearly.
- AC-002: When a trusted human posts the backend-native review trigger, `AI
  Command Policy` records the current head marker and natively reruns the
  failed `AI Review` check for that PR head.
- AC-003: When accepted review evidence appears after the marker, a native
  GitHub event reruns `AI Review` so the required check can pass without an
  idle polling runner.
- AC-004: Existing head-binding rules remain intact: stale reviews, summary
  comments without a matching marker, and evidence created before the trusted
  trigger do not satisfy the gate.
- AC-005: Concurrency still cancels obsolete in-progress `AI Review` runs for
  the same PR.
- AC-006: The A/B metrics above are captured before and after the change, with
  the baseline numbers in this spec and the post-change result recorded in
  `tasks.md`.

## Negative Scenarios

- A PR with no trusted review request must not burn the full 20-minute wait
  window.
- A bot-authored administrative trigger must not recurse through `AI Command
  Policy`.
- A review for an older head SHA must not pass the latest required check after
  a new commit is pushed.
- A skipped workflow must not be used as the required `AI Review` success path.
