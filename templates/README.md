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

## Local Commands

```bash
pnpm run preflight
pnpm run worktree:new -- --slug 001-example
pnpm run pr:publish
```

## Required PR Checks

The active list is `.unicorn-hub/config.json` (`requiredChecks`). The defaults installed by bootstrap reflect the chosen profile; stack-specific profiles that preserve existing target CI ship only Unicorn-controlled contexts (`guard`, `AI Review`) and expect the team to add the repository's real CI job names before applying branch protection.
