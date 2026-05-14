# Plan: Claude MD At-Syntax References

## Summary

This is a documentation-contract refinement. The root and template
`CLAUDE.md` files already list the right documents to read before coding. The
implementation keeps that order and changes only the reference syntax for the
canonical paths that Claude Code should treat as explicit file mentions.

## Implementation Outline

- Update root `CLAUDE.md` read-order entries from inline-code paths to
  `@path` references.
- Update `templates/CLAUDE.md` read-order entries for installed target
  repositories in the same style.
- Leave role definitions, review policy, and workflow instructions unchanged.
- Add this feature-memory folder so PR Guard can verify the documentation
  change has an explicit goal, plan, and task record.

## Verification

- Review the diff to confirm only the intended `CLAUDE.md` reference syntax
  changed.
- Run `pnpm run preflight` to cover sanitizer, baseline, and test checks.
- Confirm PR Guard no longer reports a missing feature-memory folder.

## Decisions and Constraints

- Do not add a new abstraction or script; this is a text-only compatibility
  tweak.
- Keep examples synthetic and generic, matching Unicorn Hub's portability
  contract.
- Preserve existing filenames and directories.
