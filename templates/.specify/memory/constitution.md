# <PROJECT_NAME> Constitution

## Core Principles

### I. Spec-First Development

Every product-code PR must include a complete feature-memory folder under `specs/<feature-id>/` with `spec.md`, `plan.md`, and `tasks.md`.

### II. Testable Boundaries

Product behavior must be implemented behind boundaries that can be tested without real external services unless the test is explicitly integration-level.

### III. Test-First Bias

New behavior should begin with failing tests or a documented reason why tests are deferred. PRs without verification are not merge-ready.

### IV. PR-Only Workflow

Direct pushes to the default branch are forbidden after branch protection is enabled.

### V. One Worktree Per Task

Parallel implementation work must use separate worktrees, branches, and PRs.

### VI. Deployability Contract

The default branch must remain deployable. Broken default branch status has priority over feature work.

### VII. Simplicity

New abstractions require a current reason documented in `plan.md`.

## Workflow

1. Create or update project docs.
2. Create feature memory.
3. Plan verification.
4. Implement in an isolated worktree.
5. Run local preflight.
6. Open a PR.
7. Resolve CI and review.
8. Merge only when gates are green.

## Governance

Changes to this constitution require a PR that updates dependent templates and agent rule files.
