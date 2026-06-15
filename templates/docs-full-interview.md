# Docs Full Interview: Durable Project Discovery

Use this path only when the user asks for full discovery or the project needs broad context before repeated agent work.

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
  [ ] first specs/<feature-id>/ folder identified

Phase 5 — Screens or interaction maps
  [ ] docs_project/screens/ or equivalent flow maps

Phase 6 — Agent rules
  [ ] AGENTS.md and CLAUDE.md still compact

Phase 7 — Final consistency validation
  [ ] links, commands, ports, env vars, and feature names checked
```

## Phases

1. Idea and vision: problem, solution, value, target audience, high-level user flow.
2. Audience and market: ideal user, alternatives, audience priorities, monetization if relevant.
3. Technical configuration: platform, stack, backend/storage/auth/deploy/background jobs/observability.
4. Feature inventory: MVP versus later; feature implementation details belong in `specs/<feature-id>/`.
5. Screens or interaction maps: UI screens, bot commands, event maps, API flow maps, or service workflows.
6. Agent rules: keep root guidance short and move detailed contracts into linked docs.
7. Final validation: links, commands, ports, env vars, feature IDs, placeholders, and secrets.
