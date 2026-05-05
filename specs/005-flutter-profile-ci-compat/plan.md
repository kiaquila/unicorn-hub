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

Bootstrap gains three profile-aware extension points:

- `packageScripts` for the installed control-plane `package.json`, merged whether bootstrap freshly created the file or it already existed.
- `dependabotUpdates` for profile-matched Dependabot ecosystems with required `packageEcosystem` and weekly-only `day` emission.
- `excludeTemplates` for templates that the profile considers incompatible (e.g., the default Node CI workflow for Flutter), enforced regardless of `--force`.

All three are opt-in and preserve existing behavior for profiles that do not set them. Repository walking also learns `.omx/` as local runtime state, matching existing `.omc/` handling.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | `tests/bootstrap.test.mjs` preserves a synthetic existing `.github/workflows/ci.yml`. |
| AC-002 | `tests/bootstrap.test.mjs` asserts Flutter product paths in `.unicorn-hub/config.json`. |
| AC-003 | `tests/bootstrap.test.mjs` asserts Flutter required checks include `Build Android APK`, `guard`, `AI Review`, and exclude `baseline-checks`. |
| AC-004 | `tests/bootstrap.test.mjs` asserts generated Dependabot includes `github-actions` and `pub`, not `npm`. |
| AC-005 | `pnpm run preflight` passes locally with sanitizer, baseline, workflow sync, syntax, and the updated test suite. |
| AC-006 | `tests/sanitizer.test.mjs` asserts `.omx/` runtime state is ignored. |
| AC-007 | `tests/bootstrap.test.mjs` "fresh Flutter target" case asserts no `ci.yml` is installed and Unicorn guard / AI review / OSV workflows still land. |
| AC-008 | `tests/bootstrap.test.mjs` "--force still preserves Flutter ci.yml" case asserts `excludeTemplates` overrides `--force`. |
| AC-009 | `tests/bootstrap.test.mjs` "merges profile packageScripts into a pre-existing package.json" case asserts user scripts survive and profile scripts are merged in. |
| AC-010 | `tests/bootstrap.test.mjs` "merges profile packageScripts into a pre-existing package.json" case asserts that `check:repo` and `check:feature-memory` are filled from template defaults; "preserves user-defined baseline scripts" case asserts that user values outrank template defaults. |
| AC-011 | `tests/bootstrap.test.mjs` "fresh Flutter target" case runs `scripts/check-repo-baseline.mjs` against the target and asserts the baseline passes despite `.github/workflows/ci.yml` being excluded. |
| AC-012 | `tests/bootstrap.test.mjs` "preserves Flutter CI" case asserts `requiredChecks` is exactly `["guard", "AI Review"]` and explicitly excludes presumed job names (`Lint`, `Unit tests`, `Widget tests`, `Build Web`, `Build Android APK`, `baseline-checks`). |
| AC-013 | `tests/bootstrap.test.mjs` "dependabot renderer preserves explicit zero values" case asserts that `openPullRequestsLimit: 0` and zero-day `cooldown` values render verbatim in the generated `.github/dependabot.yml`. |

Negative scenario evidence:

- Existing generic bootstrap test continues to cover default package/template behavior.
- Synthetic Flutter bootstrap test verifies target CI is skipped without `--force`.

## Risks

- Some Flutter targets may not use Make. Mitigation: commands are visible in generated config and package scripts, so teams can adjust during bootstrap review.
