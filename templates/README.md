# <PROJECT_NAME>

`<PROJECT_SUMMARY>`

## Development Workflow

This repository uses a portable multi-agent development workflow:

- durable project docs in `docs_project/`
- feature memory in `specs/<feature-id>/`
- SENAR-style verification evidence and process memory
- agent onboarding in `AGENTS.md`
- Claude-specific guidance in `CLAUDE.md`
- local preflight before push
- GitHub CI, PR Guard, and AI Review gates
- frozen dependency locks and direct-dependency policy in the existing PR Guard

## First Setup After Bootstrap

If this repository is new or `docs_project/` still contains placeholders, start with the documentation router before product code:

```text
Read CREATE-DOCS.md and ai-docs-guide.md.
Use docs-minimum.md unless the user asks for full discovery or the project is unclear.
Create the minimum docs needed for the next feature, then create
specs/<feature-id>/spec.md, plan.md, and tasks.md. Do not implement product code yet.
```

If project docs already exist, use the same protocol to review and refresh them.

## Local Commands

```bash
pnpm run preflight
pnpm run check:dependencies -- <base-ref> <head-ref>
pnpm run worktree:new -- --slug 001-example
pnpm run pr:publish
```

`pnpm run pr:publish` opens a ready-for-review pull request by default. Use
`pnpm run pr:publish -- --draft` only when a draft is intentional.

Node installs require a current `pnpm-lock.yaml` and use
`pnpm install --frozen-lockfile`. Review install-script permissions in the
exact-version `allowBuilds` map in `pnpm-workspace.yaml`. Dependency-policy
settings and reviewed typosquat exceptions live under `dependencyPolicy` in
`.unicorn-hub/config.json`. Repository pnpmfile hooks and custom `pnpmfile` or
`global-pnpmfile` settings are not supported. Python-enabled profiles use
`uv lock --check` plus `uv sync --locked`, or a fully pinned and hashed
`requirements.lock` installed with isolated pip, the official index,
`--require-hashes`, and `--only-binary :all:`.

## Required PR Checks

The active list is `.unicorn-hub/config.json` (`requiredChecks`). The defaults installed by bootstrap reflect the chosen profile; stack-specific profiles that preserve existing target CI ship only Unicorn-controlled contexts (`guard`, `AI Review`) and expect the team to add the repository's real CI job names before applying branch protection.
