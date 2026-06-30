# Tasks: Vendor Governance Envelope For Linguist

## Setup

- [x] T001 Identify the exact bootstrap copy manifest (template walk + script allowlist) and map destination paths.
- [x] T002 Create feature memory for the Linguist-vendoring change.

## Implementation

- [x] T003 Add `templates/.gitattributes` managed block vendoring the managed script filenames bootstrap actually writes, `.unicorn-hub/**`, `.specify/**`.
- [x] T004 Skip `.gitattributes` in the generic template walk and add an idempotent merge step in `scripts/bootstrap-repo.mjs`.
- [x] T005 Update README, `docs/bootstrap-flow.md`, and `docs/portability-and-sanitization.md`.

## Verification

- [x] T006 Add bootstrap tests for installation, `git check-attr` outcomes, consumer merge preservation, and idempotent re-run.
- [x] T007 Capture manual `git check-attr` evidence against a synthetic `python-service` target.
- [x] T008 Run `pnpm run preflight`.

## Process Memory

### Dead Ends

- Copying `.gitattributes` through the normal template walk was rejected: `copyFileFromSource` skips when the target exists, so a consumer `.gitattributes` would never receive the governance rules. A dedicated merge step was required.

### Decisions

- Mark only the managed script filenames bootstrap actually writes, `.unicorn-hub/**`, and `.specify/**` as vendored. These are the only installed paths that reach GitHub's language bar (JavaScript) or are pure governance scaffolding; markdown/JSON/YAML are `prose`/`data` and already excluded by Linguist, and `docs_project/` stays consumer-owned and counted.
- If a consumer already owns a colliding `scripts/*.mjs` filename, bootstrap skips that file and filters its corresponding attribute line so the consumer script remains counted.
- Use `linguist-vendored` (third-party copied-in code), not `linguist-generated`: nothing here is a build artifact.
- Guard idempotency with a stable begin marker; append the block when absent, skip when present, create when no `.gitattributes` exists.
- Keep `templates/.gitattributes` as the source of truth and exclude it from the generic walk, mirroring how `.unicorn-hub/config.json` is handled.

### Known Issues

- Manual evidence (`python-service` target): `scripts/ai-review-gate.mjs`, `.unicorn-hub/config.json`, and `.specify/templates/spec-template.md` reported `linguist-vendored: set`; `src/bot.py` and `app/main.ts` reported `linguist-vendored: unspecified`.
- `pnpm run preflight` passed locally after adding the feature folder.
