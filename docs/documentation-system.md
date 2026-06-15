# Documentation System

The documentation system separates durable project context from feature-specific implementation memory.

## Durable Project Context

`docs_project/` stores context that should survive many features:

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
```

Use this layer for product facts, user flows, stack decisions, deployment rules, architecture decisions, screen maps, and domain terminology. Treat `docs_project/README.md` as an index and load detailed docs only when they are relevant to the current task.

## Feature Memory

`specs/<feature-id>/` stores context for one feature or change:

```text
specs/001-example-feature/
  spec.md
  plan.md
  tasks.md
```

The feature-memory gate requires all three files for product-code changes.
The SENAR layer gives those files a shared contract:

- `spec.md` names the goal, scope, acceptance criteria, and negative scenario
- `plan.md` maps acceptance criteria to verification evidence
- `tasks.md` captures dead ends, decisions, and known issues so future agents do not repeat discarded work or erase accepted tradeoffs

## Documentation Router

The router lives in [`templates/CREATE-DOCS.md`](../templates/CREATE-DOCS.md). It is the first setup protocol for new or under-documented target repositories: choose the smallest context package that lets the next feature start safely, then keep implementation paused until the durable docs and first feature spec are ready.

Default path:

1. use [`templates/docs-minimum.md`](../templates/docs-minimum.md)
2. capture the project summary, stack/commands, product paths, and first feature intent
3. create the first `specs/<feature-id>/` folder

Full discovery path:

1. use [`templates/docs-full-interview.md`](../templates/docs-full-interview.md)
2. interview in small batches
3. write focused docs after each phase
4. reserve market, screen, and deep architecture docs for projects that need them

Use the installed `ai-docs-guide.md` as supporting context for structure, file size, and validation expectations.

## Context Hygiene

- Keep agent-loaded files concise.
- Keep root agent files to hard rules, setup routes, and links.
- Put detailed references in linked subfiles.
- Prefer indexes over giant omnibus documents.
- Update durable docs whenever behavior, architecture, workflows, or deploy rules change.
- Do not put secrets, real tokens, or private infrastructure identifiers in docs.
