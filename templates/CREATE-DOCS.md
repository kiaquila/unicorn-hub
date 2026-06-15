# CREATE-DOCS: Documentation Router

This file routes agents to the smallest documentation pass that can safely unblock development.

## Default Path: Minimum Docs

Use `docs-minimum.md` before the first product-code change when the repository is new, stale, or still contains placeholders.

The minimum pass captures only:

- project summary and audience
- stack, commands, product paths, and deploy target
- first feature intent
- links from `docs_project/README.md` to the docs that exist
- the first `specs/<feature-id>/spec.md`, `plan.md`, and `tasks.md`

Do not run the full interview by default.

## Full Discovery Path

Use `docs-full-interview.md` when the user asks for full discovery, the product direction is unclear, multiple features must be planned together, or the repository lacks enough durable context for repeated agent work.

## Working Rules

- Ask in small batches.
- Write files yourself after each batch.
- Mark unresolved facts as `[NEEDS CLARIFICATION]` instead of inventing details.
- Keep `AGENTS.md` and `CLAUDE.md` concise; put detailed process notes in linked docs.
- Do not implement product code until the chosen docs path and first feature memory are ready.
- Do not write secrets, private infrastructure identifiers, or source-project-specific examples.

## Final Validation

Before handing off to implementation, check:

- `docs_project/README.md` links only to files that exist
- commands match package scripts or documented project commands
- `.unicorn-hub/config.json` product paths and required checks match the target
- the active feature has a goal, acceptance criteria, verification plan, and tasks
- no placeholder-only specs are being used as implementation input
