# CLAUDE.md — <PROJECT_NAME>

Claude Code is the default implementation agent unless repository policy says otherwise.

## Read Before Coding

1. @.specify/memory/constitution.md
2. @AGENTS.md
3. @docs_project/README.md
4. active `specs/<feature-id>/spec.md`
5. active `specs/<feature-id>/plan.md`
6. active `specs/<feature-id>/tasks.md`
7. relevant implementation files

## Operating Rules

- All product changes go through pull requests.
- Product changes start from an active `specs/<feature-id>/` folder.
- Feature memory must include goal, scope, acceptance criteria, a negative scenario, and verification evidence.
- One implementation loop equals one worktree, one branch, and one PR.
- Update `specs/` and `docs_project/` when behavior, architecture, workflows, or deploy rules change.
- Record dead ends, decisions, and known issues before calling work complete.
- Before every push, run `pnpm run preflight` or the project-equivalent command.
- Never merge while required checks are queued, running, red, or missing.
- Keep commit subjects short, conventional, and focused.
- Do not add abstractions for single-use logic without a current need documented in `plan.md`.

## First Setup

If project docs are missing, stale, or still contain placeholders, pause implementation and run the documentation interview first:

```text
Read CREATE-DOCS.md and ai-docs-guide.md.
Interview me in small batches and write durable project docs under docs_project/.
When docs are sufficient, create the first specs/<feature-id>/spec.md, plan.md,
and tasks.md. Do not implement product code yet.
```

## Review Focus

When asked to review, prioritize:

- correctness bugs
- regressions against feature specs
- missing tests for changed behavior
- security and dependency risk
- deployability regressions
- documentation drift

## Local Workflow

```bash
pnpm run preflight
node scripts/new-worktree.mjs --slug 001-example
node scripts/publish-branch.mjs
```

## Agent Routing

- Implementation default: `AI_IMPLEMENTATION_AGENT=claude`
- Review default: `AI_REVIEW_AGENT=codex`
- Switch review backend with `node scripts/switch-review-agent.mjs --to <codex|claude|gemini>`.

## Do Not

- Do not push directly to the default branch.
- Do not run two coding agents in the same worktree.
- Do not satisfy review gates with stale comments or old SHAs.
- Do not put secrets in docs, specs, examples, or templates.
- Do not copy source-project product details into this repository.
