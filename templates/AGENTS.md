# AGENTS.md — <PROJECT_NAME>

`<PROJECT_NAME>` is `<PROJECT_SUMMARY>`.

- Primary stack: `<STACK_SUMMARY>`
- Deploy target: `<DEPLOY_TARGET>`
- Owner model: `<OWNER_MODEL>`

## Hard Rules

- Product-code changes must use one branch, one worktree, and one pull request.
- Product-code PRs must include one complete `specs/<feature-id>/` folder with `spec.md`, `plan.md`, and `tasks.md`.
- Acceptance criteria need concrete verification evidence before merge.
- Run `pnpm run preflight` or the project-equivalent command before pushing.
- Keep dependency installs locked; review direct dependency and exact-version install-script policy changes in the PR diff.
- Never push directly to the default branch or merge with missing, queued, red, or stale required checks.
- Do not put secrets, private URLs, production identifiers, or personal paths in docs, specs, examples, or templates.

## Task-Scoped Reading

Start with the active task, not a repository tour:

1. active `specs/<feature-id>/spec.md`
2. active `specs/<feature-id>/plan.md`
3. active `specs/<feature-id>/tasks.md`
4. `.unicorn-hub/config.json` for product paths, commands, and required checks
5. `docs_project/README.md` only as an index to task-relevant durable docs
6. relevant source files found by search or imports

Read `.specify/memory/constitution.md` when creating or changing feature memory.

## First Setup

If project docs are missing, stale, or placeholder-heavy, run the documentation router before product code:

```text
Read CREATE-DOCS.md and ai-docs-guide.md.
Create only the minimum docs needed for the first feature unless the user asks for full discovery.
Then create specs/<feature-id>/spec.md, plan.md, and tasks.md. Do not implement product code yet.
```

## Where Details Live

- Documentation protocol: `CREATE-DOCS.md`, `docs-minimum.md`, `docs-full-interview.md`
- Project memory index: `docs_project/README.md`
- PR/review workflow: `docs_project/project/devops/ai-pr-workflow.md`
- Review evidence contract: `docs_project/project/devops/review-contract.md`
- Active required checks: `.unicorn-hub/config.json` (`requiredChecks`)

## Completion

A task is complete only when the current PR head has green required checks, no blocking review findings, evidence for acceptance criteria, current process memory, and no unresolved conflicts.
