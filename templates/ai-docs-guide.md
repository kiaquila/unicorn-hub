# AI Documentation Guide

Good AI development documentation is a task-scoped map, not an always-on encyclopedia.

## Principles

- Start with the minimum durable context needed for the next feature.
- Keep agent-loaded files short and link to focused subfiles.
- Use `docs_project/README.md` as an index, not required reading for every task.
- Treat every agent mistake as a signal to improve the nearest relevant doc.
- Keep specs close to the feature and durable docs close to the product.

## Documentation Paths

Use [`CREATE-DOCS.md`](./CREATE-DOCS.md) as the router:

- [`docs-minimum.md`](./docs-minimum.md) is the default path before the first product-code change.
- [`docs-full-interview.md`](./docs-full-interview.md) is for greenfield, strategic, or unclear projects.

## Recommended Structure

```text
docs_project/
  README.md
  project-idea.md
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

Add marketing, screen maps, ADRs, and deeper architecture docs only when they answer a current task or the user asks for full discovery.

## File Size

- Root agent files should stay compact enough to read on every task.
- Durable docs should usually stay between 50 and 250 lines.
- If a file grows beyond that, split it into subfiles and keep the parent as an index.

## Agent Rule Files

`AGENTS.md` is universal launch context. `CLAUDE.md` is Claude-specific launch context. Keep both to hard rules, setup routes, and links to deeper task-scoped docs.

## Validation

Before implementation:

- minimum docs exist or full discovery was intentionally chosen
- the feature has a complete spec
- unclear requirements are marked or resolved
- the plan names verification steps
- tasks are atomic enough for agents

Before merge:

- docs and specs reflect the behavior
- checks are green
- review findings are resolved or explicitly deferred by a human
