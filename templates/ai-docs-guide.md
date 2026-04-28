# AI Documentation Guide

Good AI development documentation is an executable map for agents.

## Principles

- Write docs before large implementation work.
- Use one file per responsibility.
- Keep high-level indexes concise and link to focused subfiles.
- Treat every agent mistake as a signal to improve documentation.
- Keep specs close to the feature and durable docs close to the product.

## Recommended Structure

```text
docs_project/
  README.md
  project-idea.md
  marketing/go-to-market.md
  project/frontend/frontend-docs.md
  project/backend/backend-docs.md
  project/devops/
  adr/
  screens/
specs/
  001-example/spec.md
  001-example/plan.md
  001-example/tasks.md
```

## File Size

Aim for 100 to 400 lines per file. If a file grows beyond that, split it into subfiles and keep the parent as an index.

## Agent Rule Files

`AGENTS.md` is universal context for all agents. `CLAUDE.md` is Claude-specific runtime guidance. Keep both concise and link to deeper docs.

## Validation

Before implementation:

- the feature has a complete spec
- unclear requirements are marked or resolved
- the plan names verification steps
- tasks are atomic enough for agents

Before merge:

- docs and specs reflect the behavior
- checks are green
- review findings are resolved or explicitly deferred by a human
