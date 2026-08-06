# Tasks: Portable Dependabot Grouping

## Setup

- [x] T001 Inspect the root configuration, template, profiles, and bootstrap renderer.
- [x] T002 Create feature memory before publishing the bootstrap changes.

## Implementation

- [x] T003 Update root and template Dependabot configurations with per-ecosystem minor-and-patch groups.
- [x] T004 Render GitHub Actions cooldowns without semantic-version keys while preserving them for other ecosystems.
- [x] T005 Add generated Flutter profile assertions for both cooldown and grouping behavior.

## Verification

- [x] T006 Run the focused bootstrap test suite.
- [x] T007 Run the complete preflight after feature memory is present.
- [x] T008 Push the fix and request a new Codex review.
- [x] T009 Add a direct root/template parity test so preflight catches future Dependabot drift.

## Process Memory

### Decisions

- Keep the semantic-version cooldown settings for non-GitHub-Actions ecosystems so existing profile behavior and explicit-zero values remain intact.
- Treat grouping as a setting on each generated ecosystem entry rather than combining ecosystems into one Dependabot pull request.

### Known Issues

- The initial PR-only configuration change did not update bootstrapped targets; the Codex review correctly identified the missing template and renderer propagation.
