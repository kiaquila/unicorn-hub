# Tasks: Claude MD At-Syntax References

## Implementation

- [x] T001 Update root `CLAUDE.md` read-order paths to `@` references.
- [x] T002 Update `templates/CLAUDE.md` read-order paths to `@` references.
- [x] T003 Add feature-memory spec, plan, and tasks files for PR Guard.
- [x] T004 Run `pnpm run preflight`.
- [ ] T005 Verify PR checks after pushing the branch.

## Process Memory

- The change intentionally preserves the existing read order and surrounding
  policy text. The only intended behavior is making important documentation
  paths easier for Claude Code to detect as file references.
- No downstream bootstrap behavior changes are needed because target
  repositories already receive `templates/CLAUDE.md`.
- `pnpm run preflight` passed locally on 2026-05-14 before publishing the
  feature-memory fix.
