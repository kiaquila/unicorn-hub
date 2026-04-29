# <PROJECT_NAME> Constitution

## Core Principles

### I. Spec-First Development

Every product-code PR must include a complete feature-memory folder under `specs/<feature-id>/` with `spec.md`, `plan.md`, and `tasks.md`.

### II. Testable Boundaries

Product behavior must be implemented behind boundaries that can be tested without real external services unless the test is explicitly integration-level.

### III. Test-First Bias

New behavior should begin with failing tests or a documented reason why tests are deferred. PRs without verification are not merge-ready.

### IV. Supervised Verification

Every product-code PR must name its goal, scope, acceptance criteria, negative scenario, and verification evidence before merge. AI-written summaries do not replace evidence tied to the requested behavior.

### V. PR-Only Workflow

Direct pushes to the default branch are forbidden after branch protection is enabled.

### VI. One Worktree Per Task

Parallel implementation work must use separate worktrees, branches, and PRs.

### VII. Deployability Contract

The default branch must remain deployable. Broken default branch status has priority over feature work.

### VIII. Simplicity

New abstractions require a current reason documented in `plan.md`.

### IX. Process Memory

Feature tasks must record dead ends, decisions, and known issues before merge so future agents inherit the working context.

## Workflow

1. Create or update project docs.
2. Create feature memory.
3. Name scope, acceptance criteria, and negative scenarios.
4. Implement in an isolated worktree.
5. Record verification evidence and process memory.
6. Run local preflight.
7. Open a PR.
8. Resolve CI and review.
9. Merge only when gates are green.

## Governance

Changes to this constitution require a PR that updates dependent templates and agent rule files.
