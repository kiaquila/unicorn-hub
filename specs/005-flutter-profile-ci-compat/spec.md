# Spec: Flutter Profile CI Compatibility

## Goal

Add a portable Flutter/Dart profile that can bootstrap existing mobile app repositories without overwriting their established CI workflows.

## Scope

In scope:

- Add a `flutter-app` profile with Flutter product paths, commands, required checks, and dependency-update ecosystems.
- Keep existing target `.github/workflows/ci.yml` files untouched during bootstrap unless `--force` is explicitly used.
- Generate target control-plane scripts that can run Unicorn gates and Flutter-native checks together.
- Keep local runtime state directories out of portability/sanitizer scans.
- Document how stack-specific profiles preserve target CI job names.
- Cover the bootstrap behavior with synthetic tests.

Out of scope:

- Adding a real Flutter application example.
- Changing branch protection defaults for existing profiles.
- Replacing target repository CI workflows.

## User Stories

### User Story 1

As an agent installing Unicorn Hub into an existing Flutter app, I want a Flutter-specific profile, so that feature-memory gates and AI review controls can be added without breaking the app's current CI/CD.

## Acceptance Criteria

1. Given a synthetic target repository with an existing Flutter CI workflow, when bootstrap runs with `--profile flutter-app`, then the existing CI workflow remains unchanged.
2. Given a bootstrapped Flutter target, when `.unicorn-hub/config.json` is inspected, then product paths include Flutter source, tests, platform folders, and CI files.
3. Given a bootstrapped Flutter target, when required checks are inspected, then they include Flutter CI job names plus `guard` and `AI Review`, and do not require the default Node `baseline-checks` job.
4. Given a bootstrapped Flutter target, when Dependabot config is inspected, then it includes `github-actions` and `pub` ecosystems.
5. Given this blueprint PR, when preflight runs, then sanitizer, baseline, workflow sync, syntax, and tests pass.
6. Given local runtime state exists under `.omx/`, when sanitizer runs, then that state is ignored like other local agent runtime directories.

## Negative Scenarios

1. Given a non-Flutter profile, when bootstrap runs, then existing behavior remains compatible and the default template package scripts are preserved unless that profile explicitly overrides them.
2. Given target CI is already present, when bootstrap runs without `--force`, then the target CI file is skipped rather than overwritten.

## Requirements

- FR-001: The profile must stay generic and avoid product-specific repository names, paths, or private context.
- FR-002: Bootstrap must support profile-specific `packageScripts` without mutating an existing target `package.json` that was skipped.
- FR-003: Bootstrap must support profile-specific Dependabot ecosystems.
- FR-004: Documentation must explain how stack-specific profiles use existing CI job names.
- FR-005: Local OMX runtime state must be ignored by repository file walks and git.

## Success Criteria

- SC-001: The synthetic Flutter bootstrap test proves CI preservation and generated configuration.
- SC-002: `pnpm run preflight` passes locally before publication.

## Assumptions

- Target Flutter repositories commonly expose `make check` and `make test`, but teams can edit generated scripts after bootstrap if their commands differ.
