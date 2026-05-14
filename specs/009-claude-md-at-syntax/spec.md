# Spec: Claude MD At-Syntax References

## Goal

Update the root and template `CLAUDE.md` read-order references so Claude Code
can recognize important repository documents as explicit `@` file references
while preserving the existing read order and portable blueprint wording.

## Scope

In scope:

- root `CLAUDE.md` read-before-coding references
- `templates/CLAUDE.md` read-before-coding references copied into target
  repositories
- feature-memory evidence for the documentation-only change

Out of scope:

- changing agent roles, supported review backends, or merge policy
- changing bootstrap behavior
- adding project-specific examples or private repository references

## Acceptance Criteria

- AC-001: Root `CLAUDE.md` uses `@` file references for the canonical local
  files listed before coding.
- AC-002: `templates/CLAUDE.md` uses `@` file references for canonical files
  that should be auto-load friendly in target repositories.
- AC-003: The existing read order is preserved; only the reference syntax
  changes.
- AC-004: The blueprint remains generic and sanitizer-safe.
- AC-005: Local preflight passes before the PR is considered ready to merge.

## Negative Scenarios

- The change must not introduce real user paths, private repository URLs,
  deployment identifiers, or source-project product details.
- The change must not rename existing files or move documentation locations.
- The change must not require downstream repositories to adopt a new directory
  layout beyond the already documented Unicorn Hub template layout.

## Assumptions

- Claude Code recognizes `@path` references as stronger file-reference cues
  than backtick-wrapped plain paths in `CLAUDE.md`.
- Markdown readability remains acceptable without wrapping the `@path`
  references in inline code spans.
