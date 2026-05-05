# Tasks: Flutter Profile CI Compatibility

## Setup

- [x] T001 Confirm active feature folder and branch.
- [x] T002 Run baseline orientation before editing.

## Implementation

- [x] T003 Add a neutral `flutter-app` profile.
- [x] T004 Make bootstrap apply profile-specific package scripts only when it installs `package.json`.
- [x] T005 Make bootstrap render profile-specific Dependabot ecosystems.
- [x] T006 Document stack-specific CI preservation and required-check mapping.
- [x] T007 Add synthetic bootstrap coverage for Flutter CI compatibility.
- [x] T008 Ignore local OMX runtime state in file walks and git.

## Verification

- [x] T009 Run local preflight.
- [x] T010 Update verification evidence after checks complete.

## Process Memory

### Dead Ends

- None yet.

### Decisions

- Preserve existing target CI by default and map required checks through profile config instead of replacing mature workflows.
- Keep the profile generic: no private repository names, real product details, or owner-specific paths.
- Treat `.omx/` as local runtime state like `.omc/`, so sanitizer remains useful on machines with OMX installed.

### Known Issues

- Flutter projects without Make need a small generated-script edit during bootstrap review.
