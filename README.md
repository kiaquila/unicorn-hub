# Unicorn Hub

Portable multi-agent development blueprint for spec-driven, PR-only, review-gated software work.

This repository is meant to be copied by agents into a new project. It contains the distilled practices, templates, scripts, workflows, and checks needed to bootstrap a multi-agent development system without depending on any private source repository.

## Quickstart For Agents

Unicorn Hub can be used in two ways:

- Analyze and adopt: ask an agent to inspect this blueprint and recommend which parts fit an existing repository.
- Install: bootstrap the portable workflow files into a target repository, then create the minimum project docs and first feature spec before product-code work.

Use this prompt in the target repository when you want to install the blueprint:

```text
Use the Unicorn Hub repository at https://github.com/kiaquila/unicorn-hub as
the process blueprint. If you do not already have a local copy, clone it
first (the bootstrap script needs a filesystem path). Install the portable
multi-agent development blueprint into the current repository, choose the
closest project profile, adapt placeholders, run local verification, and
prepare a pull request. After bootstrap, follow CREATE-DOCS.md to choose the
minimum or full documentation path before creating the first feature spec. Do
not copy project-specific examples or secrets.
```

If you do not already have a local clone, get one first:

```bash
git clone https://github.com/kiaquila/unicorn-hub /tmp/unicorn-hub
```

Then run, from the target repository, pointing `--source` at the local Unicorn Hub path:

```bash
node /tmp/unicorn-hub/scripts/bootstrap-repo.mjs \
  --source /tmp/unicorn-hub \
  --profile next-app \
  --project-name "Your Project"
```

`--source` only accepts a local filesystem path; it does not resolve a Git URL. If the agent says it cannot find Unicorn Hub, share the GitHub URL above so the agent can clone it, then re-run the command with the resulting local path.

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
- Local orchestration scripts for worktrees, PR publishing, feature-memory gates, context budget checks, AI review gates, and branch protection
- GitHub Actions workflows for CI, PR guard, trusted AI review routing, and OSV scanning
- Supply-chain defaults: pnpm `minimumReleaseAge`, Dependabot cooldown, pinned package manager, lockfile-oriented installs
- A `.gitattributes` block that marks the installed governance envelope (the managed script files bootstrap writes or recognizes as unchanged blueprint copies, `.unicorn-hub/**`, and `.specify/**`) as `linguist-vendored`, so the blueprint's Node scaffolding does not skew the target repo's GitHub language bar. Bootstrap appends this block idempotently and never overwrites an existing consumer `.gitattributes`; pre-existing consumer script collisions and product code keep their language stats.

## Canonical Workflow

1. Create or refresh project context with the documentation router; load detailed docs only when relevant.
2. Create feature memory before product code: `spec.md`, `plan.md`, `tasks.md`.
3. Implement in one worktree, one branch, one PR.
4. Run local preflight before every push.
5. Publish PRs ready for review by default; use `node scripts/publish-branch.mjs --draft` only when a draft is intentional.
6. Let CI, PR guard, and AI review fail closed.
7. Merge only after required checks are green and blocking review findings are resolved.

## After Bootstrap

For a new or under-documented target repository, ask the agent to run the installed documentation router before implementation:

```text
Read CREATE-DOCS.md and ai-docs-guide.md in this repository.
Use docs-minimum.md unless the user asks for full discovery or the project is unclear.
When minimum docs are sufficient, create the first specs/<feature-id>/spec.md,
plan.md, and tasks.md. Do not implement product code yet.
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
