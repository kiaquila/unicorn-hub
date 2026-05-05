# Tasks: Flutter Profile CI Compatibility

## Setup

- [x] T001 Confirm active feature folder and branch.
- [x] T002 Run baseline orientation before editing.

## Implementation

- [x] T003 Add a neutral `flutter-app` profile.
- [x] T004 Make bootstrap merge profile-specific `packageScripts` into the target `package.json` whether the file was freshly installed or pre-existed.
- [x] T005 Make bootstrap render profile-specific Dependabot ecosystems with ecosystem validation and weekly-only `day` emission.
- [x] T006 Document stack-specific CI preservation and required-check mapping.
- [x] T007 Add synthetic bootstrap coverage for Flutter CI compatibility.
- [x] T008 Ignore local OMX runtime state in file walks and git.
- [x] T011 Add `excludeTemplates` profile field so stack-specific profiles can opt out of incompatible blueprint templates regardless of `--force`.
- [x] T012 Wire `flutter-app` to exclude the default Node `ci.yml` template so fresh Flutter targets do not receive `baseline-checks`.
- [x] T013 Trim `flutter-app` `productPaths` to standard Flutter folders and collapse `commands.preflight` to the canonical `pnpm run preflight` to remove duplication with `packageScripts.preflight`.
- [x] T014 Extend `tests/bootstrap.test.mjs` with fresh-target, `--force`-preserve, and pre-existing-`package.json` scenarios.
- [x] T015 Persist `excludeTemplates` into `.unicorn-hub/config.json` and have `scripts/check-repo-baseline.mjs` skip excluded paths so fresh targets that opt out of the default Node `ci.yml` still pass baseline.
- [x] T016 Fill baseline `check:repo` / `check:feature-memory` from `templates/package.json` when merging `packageScripts` into a pre-existing `package.json`, with user-defined values winning over template defaults and profile overrides winning over both.
- [x] T017 Cover both fix-ups in `tests/bootstrap.test.mjs`: run baseline against fresh Flutter target, assert merged baseline scripts in pre-existing `package.json`, and verify user-defined baseline scripts are preserved.
- [x] T018 Trim `flutter-app` `requiredChecks` to only Unicorn-controlled contexts (`guard`, `AI Review`); document in `docs/github-ci-and-branch-protection.md` that targets must add real CI job names post-bootstrap.
- [x] T019 Replace `||` with `??` for numeric Dependabot defaults in `scripts/bootstrap-repo.mjs` so explicit `0` survives rendering.
- [x] T020 Extend `tests/bootstrap.test.mjs` to assert (a) flutter-app `requiredChecks` ships without presumed job names, and (b) Dependabot rendering preserves explicit zero values via a synthetic profile.
- [x] T021 Restrict `scripts/check-repo-baseline.mjs` exclusions to a `PROFILE_EXCLUDABLE` allowlist (currently `.github/workflows/ci.yml`) so a tampered `.unicorn-hub/config.json` cannot drop required scaffold files like `AGENTS.md`.
- [x] T022 Fill `packageManager` and `engines` from `templates/package.json` when merging into a pre-existing `package.json`, with user-defined values winning.
- [x] T023 Cover both fix-ups in `tests/bootstrap.test.mjs`: tampered-config baseline rejection, `packageManager` fill + baseline pass, and user-defined `packageManager` preservation.
- [x] T024 Replace hard-coded `baseline-checks` lists in `templates/AGENTS.md`, `templates/README.md`, `templates/docs_project/project/devops/ai-pr-workflow.md`, and `docs/bootstrap-flow.md` with pointers to `.unicorn-hub/config.json` (`requiredChecks`) so installed docs match the active profile.
- [x] T025 Extend `tests/bootstrap.test.mjs` Flutter case to assert the installed docs do not contain the legacy `baseline-checks` triplet and reference `.unicorn-hub/config.json`.

## Verification

- [x] T009 Run local preflight.
- [x] T010 Update verification evidence after checks complete.

## Process Memory

### Dead Ends

- Initial implementation gated `packageScripts` merging on `installedPaths.has("package.json")`. That silently dropped profile scripts when the target already had a `package.json`, leaving the generated `preflight` referencing nonexistent commands. Replaced with an `existsSync` check at merge time and removed the dead `installedPaths` set.
- Initial implementation relied on the generic "skip if exists" rule to preserve target CI. That broke for fresh Flutter targets, which received the default Node `ci.yml`, and for `--force` re-runs, which clobbered an existing Flutter CI. Replaced with profile-level `excludeTemplates`, enforced regardless of `--force`.
- Initial `excludeTemplates` left `scripts/check-repo-baseline.mjs` unchanged, so fresh Flutter targets passed bootstrap but failed baseline because that script unconditionally required `.github/workflows/ci.yml`. Fixed by persisting `excludeTemplates` into `.unicorn-hub/config.json` and filtering required paths through it. The bootstrap test for the fresh-target case now also runs the baseline script as proof.
- Initial `packageScripts` merge dropped baseline scripts when `package.json` already existed. Profile `preflight` chains that called `pnpm run check:repo` then failed at runtime with `ERR_PNPM_NO_SCRIPT`. Fixed by layering `templates/package.json` scripts as defaults under user-defined scripts under profile overrides, so the baseline chain always has its dependencies while user overrides still win.
- First draft of `flutter-app.requiredChecks` listed presumed job names (`Lint`, `Unit tests`, `Widget tests`, `Build Web`, `Build Android APK`). `scripts/apply-branch-protection.mjs` consumes that list verbatim as required status contexts, so any mismatch with the target's real CI job names becomes a permanently-pending required check that blocks every merge. Fixed by trimming the shipped list to `guard` + `AI Review` and documenting that installers extend it with the repository's actual job names. The blueprint should never guess label strings on behalf of the target stack.
- Dependabot renderer used `||` for numeric defaults, which silently overwrote explicit `0` values (e.g., zero-day cooldowns). Fixed by switching to `??` so `0` survives rendering; only `undefined`/`null` values fall back to the documented defaults.
- First pass at `excludeTemplates` filtering in `scripts/check-repo-baseline.mjs` honored every config entry generically. Because PR Guard runs the trusted baseline script against the PR workspace using the PR's `.unicorn-hub/config.json`, a hostile PR could have set `excludeTemplates: ["AGENTS.md"]`, deleted `AGENTS.md`, and still passed baseline. Fixed by hard-coding a `PROFILE_EXCLUDABLE` allowlist (`.github/workflows/ci.yml` only) and intersecting requested exclusions with it. The trust boundary is the trusted script, not the PR-controlled config.
- Cycle 1's `packageScripts` fix only filled scripts; the merged `package.json` still had no `packageManager`, so `scripts/check-repo-baseline.mjs` failed on its `pnpm@*` check whenever a target's pre-existing `package.json` was minimal. Fixed by also filling `packageManager` and `engines` from `templates/package.json` while preserving user-defined values for those keys.
- Trimming `flutter-app.requiredChecks` left the installed `AGENTS.md`, `README.md`, and `ai-pr-workflow.md` still hard-coded to the legacy `baseline-checks, guard, AI Review` triplet, giving Flutter targets contradictory agent guidance. Fixed by replacing the hard-coded list in every installed doc with a pointer to `.unicorn-hub/config.json` `requiredChecks`. Same edit applied to `docs/bootstrap-flow.md` Phase 5 so the blueprint's own Phase 5 stays consistent.

### Decisions

- Preserve existing target CI by default and map required checks through profile config instead of replacing mature workflows.
- Keep the profile generic: no private repository names, real product details, or owner-specific paths. `productPaths` were trimmed to standard Flutter folders only.
- Treat `.omx/` as local runtime state like `.omc/`, so sanitizer remains useful on machines with OMX installed.
- `excludeTemplates` always wins over `--force`. `--force` is for refreshing Unicorn scaffolding, not for clobbering target stacks the profile declared incompatible.
- `commands.preflight` in the profile points at `pnpm run preflight`; `packageScripts.preflight` is the single source of the actual command chain.

### Known Issues

- Flutter projects without Make still need a small generated-script edit during bootstrap review.
- Other profiles (`python-service`, `next-app`, `static-vercel`, `telegram-bot`) do not yet declare `dependabotUpdates`, so they inherit the static `npm`-only Dependabot template. Tracked as a follow-up; out of scope for this PR.
