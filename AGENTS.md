# AGENTS.md — Unicorn Hub

Unicorn Hub is a portable multi-agent development blueprint. It must stay generic, installable, and free of source-project residue.

## Read Order

1. `README.md`
2. `docs/overview.md`
3. `docs/bootstrap-flow.md`
4. `docs/multi-agent-workflow.md`
5. `docs/github-ci-and-branch-protection.md`
6. `docs/portability-and-sanitization.md`
7. relevant files under `templates/`, `scripts/`, and `profiles/`

## Rules

- This repository is a distilled practice template, not a product archive.
- Do not add real secrets, private repository URLs, real deployment identifiers, personal paths, or source-project product details.
- Templates must use placeholders such as `<PROJECT_NAME>` and neutral synthetic examples.
- Scripts must be configurable through `.unicorn-hub/config.json`.
- Run `pnpm run preflight` before publishing changes.
- If changing install behavior, update docs and tests in the same PR.

## Completion Contract

A change is complete only when:

- sanitizer passes
- baseline check passes
- tests pass
- generated examples remain synthetic
- no project-specific residue appears in tracked text files
