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

## Verification

- [x] T009 Run local preflight.
- [x] T010 Update verification evidence after checks complete.

## Process Memory

### Dead Ends

- Initial implementation gated `packageScripts` merging on `installedPaths.has("package.json")`. That silently dropped profile scripts when the target already had a `package.json`, leaving the generated `preflight` referencing nonexistent commands. Replaced with an `existsSync` check at merge time and removed the dead `installedPaths` set.
- Initial implementation relied on the generic "skip if exists" rule to preserve target CI. That broke for fresh Flutter targets, which received the default Node `ci.yml`, and for `--force` re-runs, which clobbered an existing Flutter CI. Replaced with profile-level `excludeTemplates`, enforced regardless of `--force`.

### Decisions

- Preserve existing target CI by default and map required checks through profile config instead of replacing mature workflows.
- Keep the profile generic: no private repository names, real product details, or owner-specific paths. `productPaths` were trimmed to standard Flutter folders only.
- Treat `.omx/` as local runtime state like `.omc/`, so sanitizer remains useful on machines with OMX installed.
- `excludeTemplates` always wins over `--force`. `--force` is for refreshing Unicorn scaffolding, not for clobbering target stacks the profile declared incompatible.
- `commands.preflight` in the profile points at `pnpm run preflight`; `packageScripts.preflight` is the single source of the actual command chain.

### Known Issues

- Flutter projects without Make still need a small generated-script edit during bootstrap review.
- Other profiles (`python-service`, `next-app`, `static-vercel`, `telegram-bot`) do not yet declare `dependabotUpdates`, so they inherit the static `npm`-only Dependabot template. Tracked as a follow-up; out of scope for this PR.
