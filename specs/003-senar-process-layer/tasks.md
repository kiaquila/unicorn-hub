# Tasks: SENAR Process Layer

## Setup

- [x] T001 Confirm active feature folder and branch.
- [x] T002 Run GitHub freshness checks before editing.

## Documentation

- [x] T003 Add SENAR mapping documentation.
- [x] T004 Update workflow docs to describe SENAR fields and done-gate evidence.

## Templates

- [x] T005 Update `.specify` templates for goal, scope, negative scenarios, evidence, and process memory.
- [x] T006 Update installed agent and devops templates.
- [x] T007 Add root and installed pull request templates.

## Verification

- [x] T008 Add bootstrap test assertions for installed SENAR templates.
- [x] T009 Run local preflight.

## Process Memory

### Dead Ends

- No workflow-gate changes were added because the requested layer can be carried by templates, PR checklist, and human/review-agent verification first.

### Decisions

- Treat SENAR as a lightweight supervised verification layer on top of Unicorn Hub rather than a replacement for spec-kit or the existing GitHub gates.
- Keep branch protection semantics unchanged and document `--approvals 1` as the team recommendation.
- Add the PR template both to the blueprint repo and installable templates so current and future repositories get the done gate.

### Known Issues

- PR Guard still checks for complete feature-memory files structurally; it does not parse whether every SENAR field is filled.
- Team repositories still need to opt into at least one required human approval when applying branch protection.
