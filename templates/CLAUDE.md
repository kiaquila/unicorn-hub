# CLAUDE.md — <PROJECT_NAME>

Claude Code may implement product changes unless repository policy chooses another implementation agent.

## Load

1. @AGENTS.md
2. active `specs/<feature-id>/spec.md`
3. active `specs/<feature-id>/plan.md`
4. active `specs/<feature-id>/tasks.md`
5. task-relevant implementation files

Use `docs_project/README.md` as an index only when durable project context is needed.

## Rules

- Keep one implementation loop to one worktree, branch, and PR.
- Update `specs/` and relevant durable docs when behavior, architecture, workflows, or deploy rules change.
- Record dead ends, decisions, and known issues before calling work complete.
- Run `pnpm run preflight` or the configured equivalent before pushing.
- Do not add abstractions for single-use logic without a current need documented in `plan.md`.
- Do not satisfy review gates with stale comments or old SHAs.

## First Setup

If project docs are missing, stale, or placeholder-heavy, pause implementation and run:

```text
Read CREATE-DOCS.md and ai-docs-guide.md.
Use docs-minimum.md for the first feature unless the user asks for full discovery.
Then create specs/<feature-id>/spec.md, plan.md, and tasks.md.
```

## Review Focus

When asked to review, prioritize correctness bugs, regressions against the active spec, missing tests, security risk, deployability regressions, and documentation drift.
