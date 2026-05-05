# Spec: Flutter Profile CI Compatibility

## Goal

Add a portable Flutter/Dart profile that can bootstrap existing mobile app repositories without overwriting their established CI workflows.

## Scope

In scope:

- Add a `flutter-app` profile with Flutter product paths, commands, required checks, and dependency-update ecosystems.
- Add a profile-level `excludeTemplates` field so stack-specific profiles can opt out of incompatible blueprint templates regardless of `--force`.
- Generate target control-plane scripts that can run Unicorn gates and Flutter-native checks together.
- Keep local runtime state directories out of portability/sanitizer scans.
- Document how stack-specific profiles preserve target CI job names.
- Cover the bootstrap behavior with synthetic tests, including fresh targets, `--force` re-runs, and pre-existing target `package.json`.

Out of scope:

- Adding a real Flutter application example.
- Changing branch protection defaults for existing profiles.
- Replacing target repository CI workflows.

## User Stories

### User Story 1

As an agent installing Unicorn Hub into an existing Flutter app, I want a Flutter-specific profile, so that feature-memory gates and AI review controls can be added without breaking the app's current CI/CD.

## Acceptance Criteria

1. Given a synthetic target repository with an existing Flutter CI workflow, when bootstrap runs with `--profile flutter-app`, then the existing CI workflow remains unchanged.
2. Given a bootstrapped Flutter target, when `.unicorn-hub/config.json` is inspected, then product paths include Flutter source, tests, and platform folders.
3. Given a bootstrapped Flutter target, when required checks are inspected, then they include Flutter CI job names plus `guard` and `AI Review`, and do not require the default Node `baseline-checks` job.
4. Given a bootstrapped Flutter target, when Dependabot config is inspected, then it includes `github-actions` and `pub` ecosystems.
5. Given this blueprint PR, when preflight runs, then sanitizer, baseline, workflow sync, syntax, and tests pass.
6. Given local runtime state exists under `.omx/`, when sanitizer runs, then that state is ignored like other local agent runtime directories.
7. Given a fresh Flutter target with no pre-existing `.github/workflows/ci.yml`, when bootstrap runs with `--profile flutter-app`, then the default Node `baseline-checks` workflow is not installed; the target keeps full ownership of its CI workflow file while still receiving Unicorn guard, AI review, and OSV workflows.
8. Given a Flutter target with an existing `.github/workflows/ci.yml`, when bootstrap runs with `--force` and `--profile flutter-app`, then the target CI file is still preserved because the profile excludes that template.
9. Given a target with a pre-existing `package.json`, when bootstrap runs with a profile that defines `packageScripts`, then those scripts are merged into the existing file, profile entries override colliding keys, and unrelated user-defined scripts are preserved.
10. Given a target with a pre-existing `package.json`, when bootstrap merges `packageScripts` whose `preflight` chain references baseline scripts (`check:repo`, `check:feature-memory`), then any baseline scripts not already present in the user file are filled in from the template defaults so the merged `preflight` can run without `ERR_PNPM_NO_SCRIPT`. User-defined values for the same script keys are preserved over template defaults.
11. Given a fresh target bootstrapped with a profile whose `excludeTemplates` removes a baseline-required workflow file (e.g., `.github/workflows/ci.yml`), when `scripts/check-repo-baseline.mjs` runs against that target, then the excluded path is not required and the baseline check passes.
12. Given a stack-specific profile that preserves an existing target CI workflow (e.g., `flutter-app`), when bootstrap writes `.unicorn-hub/config.json`, then `requiredChecks` lists only Unicorn-controlled status contexts (`guard`, `AI Review`) and contains no presumed target job names. The installing team is expected to add the target's real CI job names before running `scripts/apply-branch-protection.mjs` — otherwise mismatched names would become required-but-never-reporting status contexts that block all merges.
13. Given a profile with `dependabotUpdates` that explicitly sets a numeric field to `0` (e.g., `openPullRequestsLimit: 0` or `cooldown.defaultDays: 0`), when bootstrap renders `.github/dependabot.yml`, then the `0` is preserved verbatim instead of being silently replaced by the default.
14. Given `.unicorn-hub/config.json` lists an `excludeTemplates` entry that is not in the baseline-allowed exclusion set (currently only `.github/workflows/ci.yml`), when `scripts/check-repo-baseline.mjs` runs, then the disallowed entry is ignored and the corresponding required path is still enforced. This protects PR Guard from a malicious config tweak that could otherwise drop required scaffold files like `AGENTS.md`.
15. Given a target with a pre-existing `package.json` that lacks `packageManager`, when bootstrap merges the profile into that file, then `packageManager` and `engines` are filled from `templates/package.json` so `scripts/check-repo-baseline.mjs` passes against the bootstrapped target. User-defined values for those keys must be preserved over template defaults.

## Negative Scenarios

1. Given a non-Flutter profile, when bootstrap runs, then existing behavior remains compatible and the default template package scripts are preserved unless that profile explicitly overrides them.
2. Given target CI is already present, when bootstrap runs without `--force` for any profile, then the target CI file is skipped rather than overwritten.

## Requirements

- FR-001: The profile must stay generic and avoid product-specific repository names, paths, or private context.
- FR-002: Bootstrap must merge profile-specific `packageScripts` into the target `package.json`, whether the file was freshly installed by bootstrap or pre-existed in the target, while preserving unrelated user-defined scripts.
- FR-003: Bootstrap must support profile-specific Dependabot ecosystems and validate that each entry declares an ecosystem.
- FR-004: Documentation must explain how stack-specific profiles use existing CI job names.
- FR-005: Local OMX runtime state must be ignored by repository file walks and git.
- FR-006: Profiles may declare an `excludeTemplates` list. Templates listed there must never be installed into the target, including under `--force`.
- FR-007: Bootstrap must persist `excludeTemplates` into `.unicorn-hub/config.json`, and `scripts/check-repo-baseline.mjs` must skip those paths when verifying non-blueprint repositories.
- FR-008: When merging `packageScripts` into a pre-existing `package.json`, bootstrap must layer template baseline scripts under user-defined scripts under profile overrides, so the merged `preflight` chain has the baseline scripts it depends on while preserving any user-customized values.
- FR-009: Stack-specific profiles that preserve an existing target CI workflow must not ship presumed target CI job names in `requiredChecks`. The shipped list must contain only Unicorn-controlled contexts (`guard`, `AI Review`); the docs must direct installers to extend that list with the target's real CI job names before applying branch protection.
- FR-010: Numeric Dependabot fields (e.g., `openPullRequestsLimit`, `cooldown.*Days`) must use nullish coalescing for defaults so an explicit `0` configured in a profile is rendered as `0` rather than silently rewritten to the default.
- FR-011: `scripts/check-repo-baseline.mjs` must restrict `config.excludeTemplates` to a known-safe allowlist (currently only `.github/workflows/ci.yml`). Any other entry must be ignored so a tampered config cannot drop required scaffold files (`AGENTS.md`, control-plane scripts, Unicorn workflows) from the baseline contract.
- FR-012: When merging into a pre-existing `package.json`, bootstrap must fill missing `packageManager` and `engines` from `templates/package.json` so `scripts/check-repo-baseline.mjs` (which requires `packageManager` to start with `pnpm@`) passes. User-defined values for those keys must be preserved.

## Success Criteria

- SC-001: The synthetic Flutter bootstrap test proves CI preservation and generated configuration.
- SC-002: `pnpm run preflight` passes locally before publication.

## Assumptions

- Target Flutter repositories commonly expose `make check` and `make test`, but teams can edit generated scripts after bootstrap if their commands differ.
