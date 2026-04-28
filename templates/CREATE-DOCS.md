# CREATE-DOCS: Project Documentation Interview

This file is an agent protocol for creating durable project documentation.

## Role

You are the documentation architect. Interview the user in small batches, summarize what you understood, write the files yourself, and keep a progress checklist updated.

## Output Location

Write documentation under `docs_project/`. The only root-level agent guidance files are `AGENTS.md` and `CLAUDE.md`.

## Progress Checklist

```text
Project documentation progress:

Phase 1 — Idea and vision
  [ ] docs_project/project-idea.md

Phase 2 — Audience and market
  [ ] docs_project/marketing/go-to-market.md

Phase 3 — Technical configuration
  [ ] docs_project/project/frontend/frontend-docs.md
  [ ] docs_project/project/backend/backend-docs.md

Phase 4 — Feature inventory
  [ ] specs/<feature-id>/ folders identified

Phase 5 — Screens or interaction maps
  [ ] docs_project/screens/

Phase 6 — Agent rules
  [ ] AGENTS.md
  [ ] CLAUDE.md

Phase 7 — Final consistency validation
  [ ] links, commands, ports, env vars, and feature names checked
```

## Phase 1: Idea And Vision

Ask:

1. What does the project do in two or three sentences?
2. Who is it for?
3. What problem does it solve?
4. What is the ideal user flow?
5. What is the project name?

Create `docs_project/project-idea.md` with:

- problem
- solution
- key value
- high-level user flow
- target audience

## Phase 2: Audience And Market

Ask:

1. Who is the ideal user?
2. What alternatives or competitors exist?
3. What matters most to this audience?
4. Is monetization planned?
5. Why choose this product over alternatives?

Create `docs_project/marketing/go-to-market.md`.

## Phase 3: Technical Configuration

Ask:

1. What platform is needed: web, mobile, desktop, bot, API, service?
2. What stack is preferred?
3. Is a backend needed?
4. What data storage is needed?
5. How will auth, deployment, background jobs, and observability work?

Create frontend and/or backend docs under `docs_project/project/`.

## Phase 4: Feature Inventory

Ask for the full feature list and mark MVP vs later. Do not create long-lived feature docs by default. Feature implementation details belong in `specs/<feature-id>/`.

## Phase 5: Screens Or Interaction Maps

For UI projects, create screen files under `docs_project/screens/`. For bots and services, create interaction maps, command maps, event maps, or API flow maps.

## Phase 6: Agent Rules

Update `AGENTS.md` and `CLAUDE.md` so their read order, commands, and product summary match the project.

## Phase 7: Final Validation

Check:

- all links point to existing files
- commands match package scripts
- ports and env vars match technical docs
- feature IDs are consistent
- no secrets were written
- no source-project-specific examples remain
