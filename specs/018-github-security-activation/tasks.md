# Tasks: GitHub Security Activation

## Setup

- [x] T001 Read repository rules and required documentation in order.
- [x] T002 Fetch GitHub state, confirm PR #14 and dependency-install PR #20 are merged, inspect open PRs/settings/protection, and create `codex/github-security-activation` from fresh `origin/main`.
- [x] T003 Inspect Dependabot, OSV, profiles, configs, bootstrap, branch protection, docs, and test conventions.
- [x] T004 Consult current official GitHub REST documentation for repository security settings and branch protection.
- [x] T005 Create feature memory before implementation.

## Implementation

- [x] T006 Preserve Dependabot grouping/cooldowns and define relevant ecosystems for generic, Node, Flutter, and Python profiles.
- [x] T007 Make OSV explicitly fail on vulnerabilities and add `osv-scan` to profile-aware required checks.
- [x] T008 Implement idempotent `scripts/apply-security-settings.mjs` with explicit `--apply` and `--dry-run` behavior.
- [x] T009 Add required-context existence validation and dry-run support to branch protection.
- [x] T010 Install the security script through bootstrap and print the safe post-merge activation order.
- [x] T011 Update root/template configuration, baseline, managed Linguist files, activation docs, and incident-response checklist.

## Verification

- [x] T012 Add Dependabot regression tests for grouping, majors, cooldowns, and ecosystem scope.
- [x] T013 Add OSV workflow and profile-aware required-check tests.
- [x] T014 Add security-script tests for dry-run, idempotency, unsupported options, postcondition failures, and API errors.
- [x] T015 Add bootstrap and branch-protection activation-order tests.
- [x] T016 Run focused tests and fix failures.
- [x] T017 Run `pnpm run preflight` and confirm sanitizer, baseline, workflow sync, syntax, tests, and synthetic bootstrap pass.
- [x] T018 Use the requested code-review skill and resolve all blocking findings.
- [x] T019 Update verification evidence and process memory.
- [x] T020 Commit with the required trailer, push, and publish a ready-for-review PR with the required PR attribution.
- [x] T021 Resolve Codex P1 by rendering CI and OSV push filters for the configured or discovered default branch, with regression coverage and updated install docs.

## Process Memory

### Dead Ends

- Validating every required context only on the current `main` head rejected real PR-only checks (`guard`, `AI Review`). The activation now proves push-oriented and consumer-defined CI on the current default head, while proving Unicorn's PR-only jobs through workflow-specific pull-request runs created after that workflow version reached the default branch.
- The first live dry-run exceeded Node's default synchronous subprocess buffer while reading GitHub responses. GitHub CLI response capture now uses a bounded 16 MiB buffer, workflow-scoped queries, and early exit as soon as each workflow's configured contexts are proven.

### Decisions

- Treat PR #20 as the dependency-install prerequisite described by the request because it is the merged PR titled `feat: add portable dependency install guard` and its merge commit is contained in current `origin/main`.
- Apply security fields independently so unsupported optional features cannot hide available mandatory protection.
- Require `--apply` for remote mutations; `--dry-run` and no-mode ambiguity cannot mutate GitHub.
- Verify Checks API runs and legacy commit statuses on the default head before requiring push-oriented or consumer-defined CI contexts. Verify Unicorn's known PR-only contexts against recent, workflow-scoped pull-request evidence targeting the default branch.
- Merge existing branch-protection controls into the update payload so activation cannot reduce approval counts, required contexts, review restrictions, push restrictions, or stricter toggles.

### Verification Evidence

- `pnpm run preflight` passed after the review fix: sanitizer, repository baseline, workflow synchronization, syntax checks, synthetic bootstrap coverage, and 119 tests.
- Focused security activation coverage passed for dry-run behavior, idempotency, optional unsupported capabilities, mandatory and optional API failures, security and branch-protection postcondition failures, default-head provenance, stale evidence, feature-only OSV evidence, custom default-head and PR-only target CI, bounded evidence lookup, and monotonic protection updates.
- A live `node scripts/apply-security-settings.mjs --dry-run` against `kiaquila/unicorn-hub` planned all six security capabilities, proved `baseline-checks`, `guard`, `osv-scan`, and `AI Review`, and confirmed that neither settings nor branch protection were changed.
- The final two-lane review cleared the implementation after fixes for API response contracts, workflow provenance, evidence collisions, bounded pagination, consumer PR-only metadata, monotonic protection merging, mutation postconditions, and exact actor-set verification.
- Commit `453143c` was pushed to `codex/github-security-activation`, and ready-for-review PR [#21](https://github.com/kiaquila/unicorn-hub/pull/21) was published with the required attribution.
- Codex found that non-`main` repositories could never produce the default-head CI and OSV evidence required for activation. Bootstrap now keeps workflow filters and `defaultBaseBranch` aligned through an explicit, configured, or `origin/HEAD` branch choice.

### Known Issues

- None accepted.
