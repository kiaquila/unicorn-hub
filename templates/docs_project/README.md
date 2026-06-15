# Project Documentation

This folder stores durable project context for agents and humans.

## First Setup

For a new or under-documented repository, start with the repository-root [`CREATE-DOCS.md`](../CREATE-DOCS.md) and use [`ai-docs-guide.md`](../ai-docs-guide.md) as supporting structure (both live at the repo root, not inside `docs_project/`). The default route is [`docs-minimum.md`](../docs-minimum.md); use [`docs-full-interview.md`](../docs-full-interview.md) only when the user asks for full discovery or the project direction is unclear. Create the first `specs/<feature-id>/` folder before product-code work.

## Task-Scoped Reading

Treat this file as an index. Read only the docs relevant to the current task:

1. `project-idea.md`
2. `project/frontend/frontend-docs.md`
3. `project/backend/backend-docs.md`
4. `project/devops/`
5. `adr/`
6. `screens/`
7. `marketing/go-to-market.md`

Feature implementation details live in `../specs/<feature-id>/`.
