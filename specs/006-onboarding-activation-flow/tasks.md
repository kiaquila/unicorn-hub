# Tasks: Onboarding Activation Flow

## Setup

- [x] T001 Confirm GitHub state, local branch state, and open PR baseline.
- [x] T002 Create the feature folder and document the intended scope.

## Implementation

- [x] T003 Update the root `README.md` with explicit source discovery, install, and post-bootstrap flows.
- [x] T004 Update blueprint docs to surface `CREATE-DOCS.md` as the first setup path.
- [x] T005 Update installed templates with first-setup guidance for empty or under-documented repositories.
- [x] T006 Update `scripts/bootstrap-repo.mjs` final output with concrete next steps.
- [x] T007 Add bootstrap tests for the new output and installed guidance.

## Verification

- [x] T008 Run focused tests.
- [x] T009 Run local preflight.
- [x] T010 Update verification evidence after checks complete.

## Process Memory

### Dead Ends

- None yet.

### Decisions

- Keep this as one PR with separate commits for feature memory, public docs, installed docs, and behavior/tests.
- Reuse the existing `CREATE-DOCS.md` protocol instead of introducing a second onboarding script or document.
- Keep the PR documentation-only plus bootstrap-output behavior; no workflow or branch-protection semantics change.
- Bootstrap output branches on `--dry-run` and on whether anything was actually written, so a dry run or idempotent re-run no longer prints a misleading "Review placeholders" line.
- The idempotent-re-run message states explicitly that existing files were preserved and not compared to the blueprint, and points users at `--force` to refresh, instead of claiming the targets "already match the blueprint" (which the script cannot verify).
- `--source` is documented as a local filesystem path only; the README provides an explicit `git clone` step rather than implying URL support that the script does not have.
- Local `pnpm run preflight` passed with baseline, workflow sync, syntax, sanitizer, and tests.

### Known Issues

- None.
