# Tasks: Portable Dependency Install Guard

## Setup

- [x] T001 Read repository rules and required documentation in order.
- [x] T002 Fetch GitHub state, inspect open PRs, and create `codex/dependency-install-guard` from fresh `origin/main`.
- [x] T003 Inspect workspace settings, profiles, bootstrap behavior, workflows, existing supply-chain docs, and test conventions.
- [x] T004 Create feature memory before implementation.
- [x] T005 Confirm current pnpm, uv, and pip behavior from official documentation.

## Implementation

- [x] T006 Harden root and template pnpm workspace settings with exact install-script allowlisting.
- [x] T007 Make Node lockfile checks and CI installation strictly frozen.
- [x] T008 Implement the portable dependency-policy checker and configuration contract.
- [x] T009 Integrate the checker into root/template PR Guard without a new status context.
- [x] T010 Add profile-scoped uv and hashed-pip contracts for Python profiles.
- [x] T011 Install the checker and policy settings through bootstrap while preserving consumer files without `--force`.
- [x] T012 Update supply-chain, bootstrap, preflight, and CI documentation.

## Verification

- [x] T013 Add focused tests for registry identity/version/age, typo/transposition, Unicode substitution, forbidden sources, unknown registry, registry downtime, and scoped exceptions.
- [x] T014 Add tests for install-script allowlisting, missing/stale Node lockfiles, and Python hash enforcement.
- [x] T015 Add synthetic bootstrap tests for installed settings/scripts, Python profile scoping, and force/collision behavior.
- [x] T016 Run focused tests and fix failures.
- [x] T017 Run `pnpm run preflight` and confirm sanitizer, baseline, workflow sync, syntax, tests, and synthetic bootstrap pass.
- [x] T018 Perform the requested code review and resolve all blocking findings.
- [x] T019 Update verification evidence and process memory.
- [x] T020 Commit with the required Codex co-author trailer, push, and publish a ready-for-review PR with the required PR attribution.

## Process Memory

### Dead Ends

- The first frozen-lock probe used `--ignore-scripts` alone; review identified that pnpm still loads `.pnpmfile.cjs`, so the guard now also passes `--ignore-pnpmfile` and rejects unsafe request routing before invoking pnpm.

### Decisions

- Reuse the existing `guard` job rather than create another required status context.
- Keep name protection heuristic and configurable; do not build or vendor a popularity/reputation database.
- Treat registry availability as required evidence for changed direct dependencies and fail closed when it cannot be obtained.
- Pin pnpm 10.34.5 because the official 10.x security advisories mark earlier releases vulnerable to repository-controlled registry/proxy request routing.
- Reject unsupported pnpm policy escape hatches and noncanonical YAML indirection instead of expanding this checker into a general YAML policy engine.
- Reject repository pnpmfile hooks and hook-location settings before any pnpm command; `--ignore-pnpmfile` remains defense in depth for the frozen-lock probe.
- Prevent the trusted guard from building or installing PR-controlled Python project sources; uv checks and syncs run with `--no-build`, and sync omits the current project.

### Verification Evidence

- `node --test tests/dependency-policy.test.mjs` — 33 focused dependency-policy tests passed.
- `pnpm run preflight` — feature-memory, baseline, context, workflow sync, syntax, sanitizer, and all 94 tests passed after resolving the pnpmfile review finding.
- Synthetic bootstrap coverage confirms checker/settings installation, collision preservation, forced refresh, and Python-profile scoping.

### Known Issues

- None accepted yet.
