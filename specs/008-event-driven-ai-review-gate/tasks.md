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
- [ ] T010 After merge, collect treatment metrics and compare them to the
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

Pending. Measure after this feature reaches `main`, using the first 8
PR/head-branch groups after merge or all groups after 14 calendar days,
whichever comes first.

## Process Memory

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
