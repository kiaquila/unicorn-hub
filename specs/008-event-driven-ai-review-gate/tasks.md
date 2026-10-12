# Tasks: Event-Driven AI Review Gate

## Implementation

- [x] T001 Capture baseline `AI Review` GitHub Actions runner-minute usage.
- [x] T002 Record A/B measurement contract in `spec.md` and `plan.md`.
- [x] T003 Add missing-marker fast-fail behavior to `scripts/ai-review-gate.mjs`.
- [x] T004 Add native rerun support after trusted review request markers.
- [x] T005 Add native rerun support after accepted review evidence appears.
- [x] T006 Update root and template workflows together.
- [x] T007 Update operator docs for the event-driven review flow.
- [x] T008 Add tests for fast-fail, rerun routing, and stale-head safety.
- [x] T009 Run `pnpm run preflight`.
- [x] T010 After merge, collect treatment metrics and compare them to the
  baseline.

## Baseline Results

Captured on 2026-05-11 at 20:49:55Z.

| Branch group | Runs | Runner-minutes | Rounded job-minutes |
| --- | ---: | ---: | ---: |
| `codex/flutter-profile-ci-compat-clean` | 6 | 88.35 | 92 |
| `fix/fr-007-env-mapping-consistency` | 9 | 76.50 | 81 |
| `codex/flutter-profile-ci-compat` | 2 | 40.23 | 42 |
| `codex/onboarding-activation-flow` | 3 | 25.93 | 27 |
| `claude/elated-mirzakhani-f76610` | 1 | 20.12 | 21 |
| `codex/portable-multi-agent-blueprint` | 1 | 20.10 | 21 |
| `codex/head-bound-ai-review-gate` | 4 | 17.57 | 18 |
| `codex/senar-process-layer` | 2 | 0.22 | 2 |

Total: 289.02 runner-minutes and 304 rounded job-minutes across 8 branch
groups. Average: 36.13 runner-minutes and 38 rounded job-minutes per PR/head
branch. Ten failure runs lasted at least 19 minutes.

## Treatment Results

Measured on 2026-10-12 from GitHub Actions job timestamps. The post-merge
window is 2026-05-12T00:50:21Z through 2026-05-26T00:50:21Z. Only one
PR/head-branch group occurred within 14 calendar days, so the time-based
sample rule applies. This is a before/after observation with a small treatment
sample, not a randomized experiment.

The sample is PR #10, branch `docs/at-syntax-claude-md`. Its two workflow
runs have six non-skipped job attempts in total, including native reruns:

| Workflow run | Attempt | Conclusion | Runner-seconds | Rounded job-minutes |
| --- | ---: | --- | ---: | ---: |
| `25868452766` | 1 | failure | 14 | 1 |
| `25868452766` | 2 | failure | 41 | 1 |
| `25869160536` | 1 | failure | 10 | 1 |
| `25869160536` | 2 | failure | 41 | 1 |
| `25869160536` | 3 | failure | 41 | 1 |
| `25869160536` | 4 | success | 17 | 1 |

| Metric | Treatment |
| --- | ---: |
| PR/head-branch groups | 1 |
| `AI Review` workflow runs | 2 |
| Non-skipped `AI Review` job attempts | 6 |
| Total / average `AI Review` runner-minutes per PR | 2.73 |
| Total / average rounded `AI Review` job-minutes per PR | 6 |
| Failure attempts lasting at least 19 minutes | 0 |
| Longest `AI Review` attempt, seconds | 41 |
| Required checks still pending at measurement time | 0 |

The previous preliminary B estimate of 0.97 runner-minutes and 2 rounded
job-minutes counted only the latest attempt of each workflow run. It omitted
four rerun attempts and is superseded by the totals above.

Secondary control-plane consumption in the same window includes all
non-skipped jobs in the three review workflows:

| Workflow | Job attempts | Runner-minutes | Rounded job-minutes |
| --- | ---: | ---: | ---: |
| `AI Review` | 6 | 2.73 | 6 |
| `AI Command Policy` | 3 | 0.30 | 3 |
| `AI Review Rerun` | 3 | 0.27 | 3 |
| Total | 12 | 3.30 | 12 |

The final current-head request was posted at 2026-05-14T15:35:52Z, its marker
at 15:36:04Z, accepted evidence at 15:37:32Z, and the passing check completed
at 15:38:15Z. Marker-to-pass latency was 131 seconds; evidence-to-pass latency
was 43 seconds. Earlier requests were superseded by a new head or a newer
request, so this latency describes the final successful request only.

### Baseline Attempt Audit

The same audit found two previously omitted non-skipped attempts in the
control cohort, both in `codex/senar-process-layer`. That group consumed
40.40 runner-minutes and 44 rounded job-minutes across four attempts, rather
than the original latest-attempt snapshot of 0.22 minutes and 2 rounded minutes.
Other control groups retain their published totals. Skipped attempts are
excluded, including the first attempts of the two
`codex/flutter-profile-ci-compat` workflow runs.

| Metric | Original A snapshot | A including all non-skipped attempts | B |
| --- | ---: | ---: | ---: |
| PR/head-branch groups | 8 | 8 | 1 |
| Counted job attempts | 28 | 30 | 6 |
| Total runner-minutes | 289.02 | 329.20 | 2.73 |
| Total rounded job-minutes | 304 | 346 | 6 |
| Average runner-minutes per PR | 36.13 | 41.15 | 2.73 |
| Average rounded job-minutes per PR | 38.00 | 43.25 | 6 |
| Failure attempts lasting at least 19 minutes | 10 | 12 | 0 |

Result: the agreed thresholds pass. Treatment averages are below the original
9.03 runner-minute and 10 rounded-job-minute limits. Runner time per PR fell
92.4% against the original baseline, or 93.4% against the audited baseline.
The thresholds remain as agreed before implementation. Rounded job-minutes
are a conservative usage proxy, not an invoice or a measurement of total CI
consumption. Existing stale-head regression tests remain the evidence for that
safety requirement; the small treatment cohort cannot establish it alone.

Reproduction: list completed `ai-review.yml` `pull_request` workflow runs
within each cohort, group by head branch, and enumerate attempts `1` through
`run_attempt`. For each attempt, retrieve
`GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs`
and sum `(completed_at - started_at) / 60` for non-skipped jobs, including
cancelled jobs for their consumed duration. Round each job up separately for
the rounded metric. For B control-plane totals, include non-skipped jobs from
`ai-command-policy.yml` and `ai-review-rerun.yml` in the same window.

Source runs: [first PR head](https://github.com/kiaquila/unicorn-hub/actions/runs/25868452766),
[final PR head](https://github.com/kiaquila/unicorn-hub/actions/runs/25869160536),
and [PR #10 request markers and review evidence](https://github.com/kiaquila/unicorn-hub/pull/10).

## Process Memory

- T010 is complete; the treatment result and all-attempt baseline audit above
  include the rerun-router overhead. Always enumerate job attempts when
  measuring rerun-based workflows; latest-attempt totals undercount usage.
- The baseline deliberately excludes skipped `ai-review.yml` workflow runs
  because they did not run the required `AI Review` job and did not consume the
  polling window.
- Cancelled runs are included for the duration they consumed because
  `concurrency.cancel-in-progress` saves time only after a newer run starts.
- Rounded job-minutes are recorded alongside exact runner-minutes to keep the
  cost discussion conservative.
- Implementation uses GitHub's native workflow-run rerun API instead of
  `workflow_dispatch`, because rerunning the original `pull_request` run keeps
  the required `AI Review` check attached to the PR head SHA. A dispatch run
  would report on the default branch and would not reliably satisfy branch
  protection.
- Missing marker/evidence states now fail the required check quickly and write
  details to the check summary. The script only posts an issue comment for a
  real blocking review result, avoiding comment noise during expected
  wait-for-review states.
- The rerun selector deliberately ignores `workflow_dispatch` runs. A dispatch
  run reports against the default branch and cannot satisfy branch protection
  on the PR head, so rerunning it would not help the gate pass. Operators who
  start `AI Review` via `workflow_dispatch` get a one-shot validation that does
  not participate in the event-driven rerun chain; the next `pull_request`
  event will create a fresh run that the rerun chain can keep current.
- A trusted bot review can race ahead of the policy marker write by a few
  milliseconds, in which case `ai-review-rerun.yml` triggers a rerun that
  exits with `missing_marker` and `ai-command-policy.mjs` then writes the
  marker and requests another rerun. The contract self-heals; the extra rerun
  costs roughly one short fast-fail run and is counted in the secondary
  control-plane metric.
- `ai-command-policy.mjs` wraps the rerun call in a `try`/`catch` so that a
  transient Actions API error does not blank the marker comment that the gate
  depends on. The next trusted review event (or the next `synchronize`) will
  cover the missed rerun.
- `ai-command-policy.yml` and `ai-review.yml` were granted `pull-requests:
  write` after the marker write started failing with `403 Resource not
  accessible by integration`. Issue comments on a pull request require the
  `pull-requests` scope (not the `issues` scope) when the repository's
  default workflow permissions are set to read-only. The `ai-review-rerun.yml`
  workflow keeps `pull-requests: read` because it only calls the
  workflow-runs rerun endpoint.
