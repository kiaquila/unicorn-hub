# <PROJECT_NAME>

`<PROJECT_SUMMARY>`

## Development Workflow

This repository uses a portable multi-agent development workflow:

- durable project docs in `docs_project/`
- feature memory in `specs/<feature-id>/`
- agent onboarding in `AGENTS.md`
- Claude-specific guidance in `CLAUDE.md`
- local preflight before push
- GitHub CI, PR Guard, and AI Review gates

## Local Commands

```bash
pnpm run preflight
pnpm run worktree:new -- --slug 001-example
pnpm run pr:publish
```

## Required PR Checks

- `baseline-checks`
- `guard`
- `AI Review`
