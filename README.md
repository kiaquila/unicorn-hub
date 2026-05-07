# Unicorn Hub

Portable multi-agent development blueprint for spec-driven, PR-only, review-gated software work.

This repository is meant to be copied by agents into a new project. It contains the distilled practices, templates, scripts, workflows, and checks needed to bootstrap a multi-agent development system without depending on any private source repository.

## Quickstart For Agents

Unicorn Hub can be used in two ways:

- Analyze and adopt: ask an agent to inspect this blueprint and recommend which parts fit an existing repository.
- Install: bootstrap the portable workflow files into a target repository, then create or refresh project docs before product-code work.

Use this prompt in the target repository when you want to install the blueprint:

```text
Use the Unicorn Hub repository at https://github.com/kiaquila/unicorn-hub as
the process blueprint. If you need a local copy, clone or open it first.
Install the portable multi-agent development blueprint into the current
repository, choose the closest project profile, adapt placeholders, run local
verification, and prepare a pull request. After bootstrap, follow CREATE-DOCS.md
to build docs_project before creating the first feature spec. Do not copy
project-specific examples or secrets.
```

Then run, from the target repository, using your local Unicorn Hub path:

```bash
node /path/to/unicorn-hub/scripts/bootstrap-repo.mjs \
  --source /path/to/unicorn-hub \
  --profile next-app \
  --project-name "Your Project"
```

If the agent says it cannot find Unicorn Hub, pass the GitHub URL above or the local `--source` path explicitly.

Profiles live in [`profiles/`](./profiles). If no profile fits, use `generic` values in `.unicorn-hub/config.json` after bootstrapping.

Current profiles include:

- `generic`: fallback for repositories that need manual command adaptation
- `next-app`: Next.js applications with TypeScript and hosted previews
- `python-service`: Python services with API or worker entrypoints
- `static-vercel`: static frontends deployed through Vercel Git integration
- `telegram-bot`: Telegram bots with service-style deployment
- `flutter-app`: Flutter/Dart apps with mobile targets and optional web demo builds

## What Gets Installed

- Durable documentation system under `docs_project/`
- Spec-driven feature memory under `specs/<feature-id>/`
- SENAR-style supervised verification fields for goals, scope, acceptance evidence, negative scenarios, and process memory
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

## After Bootstrap

For a new or under-documented target repository, ask the agent to run the installed documentation interview before implementation:

```text
Read CREATE-DOCS.md and ai-docs-guide.md in this repository.
Interview me in small batches and write durable project docs under docs_project/.
When docs are sufficient, create the first specs/<feature-id>/spec.md, plan.md,
and tasks.md. Do not implement product code yet.
```

If project docs already exist, use the same protocol to review and refresh them instead of duplicating them.

## Repository Map

- [`docs/`](./docs) explains the blueprint and operating model.
- [`docs/senar-mapping.md`](./docs/senar-mapping.md) maps the SENAR layer onto Unicorn Hub.
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
