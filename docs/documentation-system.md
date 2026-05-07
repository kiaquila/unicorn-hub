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

Use this layer for product facts, user flows, stack decisions, deployment rules, architecture decisions, screen maps, and domain terminology.

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

## Interview Protocol

The generic interview lives in [`templates/CREATE-DOCS.md`](../templates/CREATE-DOCS.md). It is the first setup protocol for new or under-documented target repositories: ask a small batch of questions at a time, summarize what was understood, write documentation after each phase, and keep implementation paused until the durable docs and first feature spec are ready.

The key phases are:

1. idea and vision
2. audience and market
3. technical configuration
4. feature inventory
5. screens or interaction maps
6. agent rules
7. final consistency validation

Use the installed `ai-docs-guide.md` as supporting context for structure, file size, and validation expectations.

## Context Hygiene

- Keep agent-loaded files concise.
- Put detailed references in linked subfiles.
- Prefer indexes over giant omnibus documents.
- Update durable docs whenever behavior, architecture, workflows, or deploy rules change.
- Do not put secrets, real tokens, or private infrastructure identifiers in docs.
