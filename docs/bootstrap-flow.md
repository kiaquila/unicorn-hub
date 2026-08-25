# Bootstrap Flow

The bootstrap flow turns an empty or existing repository into a spec-driven, multi-agent workspace.

## Phase 0: Orientation

The installing agent inspects the target repository and captures the minimum context needed to choose a profile:

- project name
- application type
- package manager
- runtime
- deploy target
- whether frontend, backend, or both exist
- primary product paths

If important context is unknown, the agent writes `[NEEDS CLARIFICATION]` into the relevant document instead of inventing details.

Choose the closest profile before copying files. Profiles may provide stack-specific product paths, local commands, required checks, and dependency-update ecosystems. For example, a Flutter profile should preserve an existing Flutter CI workflow and use that workflow's job names as required checks instead of assuming the default Node `baseline-checks` job exists.

## Phase 1: Repository Memory

Install:

- `AGENTS.md`
- `CLAUDE.md`
- `docs_project/`
- `.unicorn-hub/config.json`
- `.gitattributes` (governance envelope marked `linguist-vendored`)

The `.gitattributes` block keeps the installed scaffolding (the managed script files bootstrap writes or recognizes as unchanged blueprint copies, `.unicorn-hub/**`, `.specify/**`) out of the target repository's GitHub Linguist language statistics, so the blueprint's Node automation does not inflate the language bar of, for example, a Python service. Bootstrap appends the managed block idempotently and preserves any pre-existing consumer `.gitattributes`; it never marks product code or pre-existing consumer script collisions as vendored.

The target repository must have a reading route before product code changes begin. For a new or under-documented target, the installed `CREATE-DOCS.md` protocol routes the agent to `docs-minimum.md` first. Use the full interview only when the user asks for deeper discovery or the project direction is unclear. Durable docs are a lazy-loaded index, not mandatory reading for every task.

## Phase 2: Spec-Kit Style Feature Memory

Install:

- `.specify/memory/constitution.md`
- `.specify/templates/`
- `specs/`

Every product-code PR must touch one complete feature folder:

```text
specs/<feature-id>/
  spec.md
  plan.md
  tasks.md
```

Feature memory should include the SENAR fields from the installed templates:
goal, scope, acceptance criteria, negative scenario, verification evidence, and
process memory.

## Phase 3: Local Orchestration

Install scripts for:

- one worktree per task
- feature-memory enforcement
- direct-dependency, lockfile, registry, typosquat, and install-script policy enforcement
- repository baseline verification
- context budget and agent-readiness reporting
- PR publishing
- AI review normalization
- review-agent switching
- branch protection setup

## Phase 4: GitHub Control Plane

Install workflows:

- CI
- PR Guard
- AI Command Policy
- AI Review
- AI Review Rerun
- OSV Scan

When a target repository already has a mature CI workflow, do not overwrite it. Keep the existing workflow, install the additional guard/review/security workflows, and set `.unicorn-hub/config.json` `requiredChecks` to the target's real CI job names plus the Unicorn guard and review jobs.

Profiles can declare `excludeTemplates` to skip blueprint templates that conflict with the target stack. The `flutter-app` profile excludes the default Node `ci.yml`, so fresh Flutter targets are not handed a `baseline-checks` workflow that would never match their CI. `excludeTemplates` is enforced even under `--force`; the flag only refreshes templates the profile considers compatible.

Bootstrap also installs `pnpm-workspace.yaml`, a minimal `pnpm-lock.yaml`, and
`scripts/check-dependency-policy.mjs`. Existing consumer copies are preserved by
default; `--force` is the explicit refresh contract. A generated minimal lock is
safe only while the generated package manifest has no dependencies. If an
existing target manifest declares dependencies, generate and review a matching
lock before CI—the guard intentionally fails closed instead of repairing it.

The generated `.unicorn-hub/config.json` carries dependency-policy settings and
version-scoped exception records. Python lock enforcement is enabled for the
`python-service` and `telegram-bot` profiles and disabled for unrelated profiles.

Set repository variables:

- `AI_IMPLEMENTATION_AGENT`
- `AI_REVIEW_AGENT`

Default recommendation:

```text
AI_IMPLEMENTATION_AGENT=claude
AI_REVIEW_AGENT=codex
```

## Phase 5: Branch Protection

After the workflows exist on the default branch, apply branch protection:

- require pull requests
- require the contexts listed in `.unicorn-hub/config.json` (`requiredChecks`) — the generic profile ships `baseline-checks`, `guard`, `AI Review`, while stack-specific profiles such as `flutter-app` ship only `guard` and `AI Review` and expect the team to extend the list with the target's real CI job names
- require branches to be up to date when appropriate
- enforce admins
- dismiss stale reviews
- require conversation resolution
- block force pushes and deletions

## Phase 6: First Feature PR

The first feature validates the whole system after minimum project docs are present or refreshed:

1. follow `CREATE-DOCS.md` and `docs-minimum.md` if `docs_project/` is empty, stale, or still contains placeholders
2. create a feature worktree
3. write `spec.md`, `plan.md`, `tasks.md`
4. implement only scoped changes
5. run preflight
6. publish a ready-for-review PR; use `node scripts/publish-branch.mjs --draft` only when a draft is intentional
7. trigger AI review from a trusted human account
8. merge only after all gates are green
