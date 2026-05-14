# CLAUDE.md — Unicorn Hub

Claude Code may implement blueprint changes in this repository.

## Read Before Coding

1. @AGENTS.md
2. @README.md
3. @docs/bootstrap-flow.md
4. @docs/portability-and-sanitization.md
5. relevant scripts/templates/tests

## Operating Rules

- Keep the blueprint portable and generic.
- Never copy source-project specs, private URLs, domains, credentials, cloud identifiers, or personal absolute paths.
- Update tests when changing sanitizer, bootstrap behavior, scripts, or required file structure.
- Run `pnpm run preflight` before pushing.
- Keep examples synthetic.

## Review Focus

Prioritize portability leaks, unsafe GitHub gate behavior, broken bootstrap output, missing checks, and docs that no longer match scripts.
