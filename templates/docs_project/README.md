# Project Documentation

This folder stores durable project context for agents and humans.

## First Setup

For a new or under-documented repository, start with `CREATE-DOCS.md` and use `ai-docs-guide.md` as supporting structure. The agent should interview the user in small batches, write these docs, then create the first `specs/<feature-id>/` folder before product-code work.

## Read Order

1. `project-idea.md`
2. `marketing/go-to-market.md`
3. `project/frontend/frontend-docs.md`
4. `project/backend/backend-docs.md`
5. `project/devops/`
6. `adr/`
7. `screens/`

Feature implementation details live in `../specs/<feature-id>/`.
