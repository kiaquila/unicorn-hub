# AGENTS.md — <PROJECT_NAME>

> Universal onboarding document for AI agents working in this repository.

## What This Project Is

`<PROJECT_NAME>` is `<PROJECT_SUMMARY>`.

**Primary stack:** `<STACK_SUMMARY>`  
**Deploy target:** `<DEPLOY_TARGET>`  
**Owner model:** `<OWNER_MODEL>`

## Read Order

Before implementation work, read in this order:

1. `.specify/memory/constitution.md`
2. `docs_project/README.md`
3. `docs_project/project-idea.md`
4. relevant docs under `docs_project/project/`
5. active `specs/<feature-id>/spec.md`
6. active `specs/<feature-id>/plan.md`
7. active `specs/<feature-id>/tasks.md`
8. relevant source files

## Agent Roles

### Orchestrator

- Reads repository memory before starting.
- Creates or updates feature memory before product-code changes.
- Slices work into one branch and one PR per task.
- Keeps docs, specs, and PR state aligned.
- Does not declare completion until the PR is merge-ready.

### Implementation Agent

- Works only from an assigned isolated worktree.
- Stays within one branch and one PR per task slice.
- Updates `specs/<feature-id>/tasks.md` in the same PR.
- Updates durable docs when behavior, architecture, workflows, or deploy rules change.
- Never merges directly to the default branch.

### Review Agent

- Reviews pull request diffs for bugs, regressions, missing tests, and contract violations.
- Does not implement unrelated features during review.
- Emits review output in the configured backend format.

## Agent Boundaries

- One worker equals one worktree.
- One implementation loop equals one branch and one PR.
- Product-code PRs require complete feature memory: `spec.md`, `plan.md`, and `tasks.md`.
- `docs_project/`, `.specify/`, and `specs/` are durable memory, not disposable session notes.
- Do not edit secrets or production resources directly.

## Delivery Workflow

- Product changes land through pull requests.
- Required checks: `baseline-checks`, `guard`, and `AI Review`.
- Run local preflight before pushing.
- A human remains the final merge authority.
- Merge only after required checks are green, blocking findings are resolved, and the PR has no conflicts.

## Review Contract

Agent selection is controlled by repository variables:

- `AI_IMPLEMENTATION_AGENT`
- `AI_REVIEW_AGENT`

Supported review backends:

- `codex`: native GitHub PR review with `P0`-`P3` findings, or a no-findings `Codex Review:` summary comment that names the current head.
- `claude`: top-level comment containing `AI_REVIEW_AGENT`, `AI_REVIEW_SHA`, and `AI_REVIEW_OUTCOME: pass|advisory|block`.
- `gemini`: native GitHub PR review from the configured app.

Only trusted actors may trigger AI workflows:

- `OWNER`
- `MEMBER`
- `COLLABORATOR`

## Completion Contract

A task is complete only when the current PR head SHA has:

- green required checks
- no blocking review findings
- no unresolved merge conflicts
- updated specs and docs where needed
- only final human approval or merge mechanics remaining
