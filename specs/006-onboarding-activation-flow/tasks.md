# Tasks: Onboarding Activation Flow

## Setup

- [x] T001 Confirm GitHub state, local branch state, and open PR baseline.
- [x] T002 Create the feature folder and document the intended scope.

## Implementation

- [x] T003 Update the root `README.md` with explicit source discovery, install, and post-bootstrap flows.
- [x] T004 Update blueprint docs to surface `CREATE-DOCS.md` as the first setup path.
- [x] T005 Update installed templates with first-setup guidance for empty or under-documented repositories.
- [x] T006 Update `scripts/bootstrap-repo.mjs` final output with concrete next steps.
- [ ] T007 Add bootstrap tests for the new output and installed guidance.

## Verification

- [ ] T008 Run focused tests.
- [ ] T009 Run local preflight.
- [ ] T010 Update verification evidence after checks complete.

## Process Memory

### Dead Ends

- None yet.

### Decisions

- Keep this as one PR with separate commits for feature memory, public docs, installed docs, and behavior/tests.
- Reuse the existing `CREATE-DOCS.md` protocol instead of introducing a second onboarding script or document.
- Keep the PR documentation-only plus bootstrap-output behavior; no workflow or branch-protection semantics change.

### Known Issues

- Native AI review still depends on a trusted human `@codex review` comment after PR creation, matching the current repository review contract.
