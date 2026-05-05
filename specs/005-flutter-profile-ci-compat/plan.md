# Plan: Flutter Profile CI Compatibility

## Summary

Add a stack-specific Flutter profile and make bootstrap honor profile-defined local scripts and Dependabot ecosystems. Preserve existing target CI by default, then document that branch protection should use the target's real job names instead of assuming the default Node `baseline-checks` job exists.

## Technical Context

- runtime: Node.js 20 for Unicorn scripts; target runtime is Flutter/Dart.
- dependencies: no new runtime dependencies.
- product paths: `profiles/`, `scripts/`, `docs/`, `tests/`, and `specs/`.
- data changes: new profile JSON and generated target config fields.

## Scope Boundaries

- in scope: `profiles/flutter-app.json`, bootstrap profile handling, docs, tests, and feature memory.
- out of scope: real app migration, real target CI replacement, and branch protection API changes.

## Constitution Check

- Spec-first: this feature folder records goal, scope, acceptance criteria, negative scenarios, and verification evidence.
- Testable boundaries: synthetic bootstrap test covers the compatibility contract.
- PR-only: changes are prepared on a feature branch for pull request review.
- Simplicity: profile fields are plain JSON and bootstrap keeps default template behavior when fields are absent.
- Deployability: no deployment platform assumptions are introduced.

## Complexity Tracking

Bootstrap gains two profile-aware extension points: `packageScripts` for installed control-plane `package.json`, and `dependabotUpdates` for profile-matched Dependabot ecosystems. Both are opt-in and preserve existing behavior for profiles that do not set them. Repository walking also learns `.omx/` as local runtime state, matching existing `.omc/` handling.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | `tests/bootstrap.test.mjs` preserves a synthetic existing `.github/workflows/ci.yml`. |
| AC-002 | `tests/bootstrap.test.mjs` asserts Flutter product paths in `.unicorn-hub/config.json`. |
| AC-003 | `tests/bootstrap.test.mjs` asserts Flutter required checks include `Build Android APK` and exclude `baseline-checks`. |
| AC-004 | `tests/bootstrap.test.mjs` asserts generated Dependabot includes `github-actions` and `pub`, not `npm`. |
| AC-005 | `pnpm run preflight` passed locally with sanitizer, baseline, workflow sync, syntax, and 19 tests green. |
| AC-006 | `tests/sanitizer.test.mjs` asserts `.omx/` runtime state is ignored. |

Negative scenario evidence:

- Existing generic bootstrap test continues to cover default package/template behavior.
- Synthetic Flutter bootstrap test verifies target CI is skipped without `--force`.

## Risks

- Some Flutter targets may not use Make. Mitigation: commands are visible in generated config and package scripts, so teams can adjust during bootstrap review.
