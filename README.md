# Unicorn Hub

Portable multi-agent development blueprint for spec-driven, PR-only, review-gated software work.

This repository is meant to be copied by agents into a new project. It contains the distilled practices, templates, scripts, workflows, and checks needed to bootstrap a multi-agent development system without depending on any private source repository.

## Quickstart For Agents

Use this prompt in the target repository:

```text
Use Unicorn Hub as the source of truth. Install the portable multi-agent
development blueprint into the current repository. Choose the closest project
profile, adapt placeholders, run local verification, and prepare a pull request.
Do not copy project-specific examples or secrets.
```

Then run, from the target repository:

```bash
node /path/to/unicorn-hub/scripts/bootstrap-repo.mjs \
  --source /path/to/unicorn-hub \
  --profile next-app \
  --project-name "Your Project"
```

Profiles live in [`profiles/`](./profiles). If no profile fits, use `generic` values in `.unicorn-hub/config.json` after bootstrapping.

## What Gets Installed

- Durable documentation system under `docs_project/`
- Spec-driven feature memory under `specs/<feature-id>/`
- Agent rules: `AGENTS.md` and `CLAUDE.md`
- Local orchestration scripts for worktrees, PR publishing, feature-memory gates, AI review gates, and branch protection
- GitHub Actions workflows for CI, PR guard, trusted AI review routing, and OSV scanning
- Supply-chain defaults: pnpm `minimumReleaseAge`, Dependabot cooldown, pinned package manager, lockfile-oriented installs

## Canonical Workflow

1. Create or refresh project context with the documentation interview.
2. Create feature memory before product code: `spec.md`, `plan.md`, `tasks.md`.
3. Implement in one worktree, one branch, one PR.
4. Run local preflight before every push.
5. Let CI, PR guard, and AI review fail closed.
6. Merge only after required checks are green and blocking review findings are resolved.

## Repository Map

- [`docs/`](./docs) explains the blueprint and operating model.
- [`templates/`](./templates) contains files copied into target repositories.
- [`scripts/`](./scripts) contains reusable Node.js automation.
- [`profiles/`](./profiles) describes project-type defaults.
- [`tests/`](./tests) verifies portability, sanitizer rules, and script behavior.

## Validation

Run the full local check:

```bash
pnpm run preflight
```

The final check includes a sanitizer pass to ensure the blueprint does not contain secrets, private repository references, owner-specific infrastructure, or source-project residue.
