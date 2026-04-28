# Spec: FR-007 Shell Interpolation Cleanup

## User Stories

### US1: Consistent Workflow Hardening

As a repository owner, I want every shell block in every workflow to read GitHub context values through environment variables so that FR-007 holds uniformly across `ai-review.yml` and `pr-guard.yml`.

## Requirements

- FR-007a: `ai-review.yml` must read `github.event_name` from an `env:` mapping inside the policy step, not from inline `${{ }}` interpolation in the shell block.
- FR-007b: `pr-guard.yml` must read `github.event_name`, `github.event.pull_request.base.sha`, `github.event.pull_request.head.sha`, `inputs.base_ref`, and `inputs.head_ref` from an `env:` mapping inside the resolve-diff-refs step, not from inline `${{ }}` interpolation in the shell block.
- FR-007c: Root workflows must remain in lock-step with templates after the change (enforced by existing `sync-workflows.mjs --check`).

## Success Criteria

- SC-001: `pnpm run preflight` passes locally on the cleanup branch.
- SC-002: No `${{ ... }}` expression appears inside any shell `run:` block in `templates/.github/workflows/ai-review.yml` or `templates/.github/workflows/pr-guard.yml`.
- SC-003: `node scripts/sync-workflows.mjs --check` confirms root parity.
