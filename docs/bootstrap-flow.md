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

## Phase 1: Repository Memory

Install:

- `AGENTS.md`
- `CLAUDE.md`
- `docs_project/`
- `.unicorn-hub/config.json`

The target repository must have a reading route before product code changes begin.

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
- repository baseline verification
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
- OSV Scan

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
- require `baseline-checks`, `guard`, and `AI Review`
- require branches to be up to date when appropriate
- enforce admins
- dismiss stale reviews
- require conversation resolution
- block force pushes and deletions

## Phase 6: First Feature PR

The first feature validates the whole system:

1. create a feature worktree
2. write `spec.md`, `plan.md`, `tasks.md`
3. implement only scoped changes
4. run preflight
5. publish PR
6. trigger AI review from a trusted human account
7. merge only after all gates are green
