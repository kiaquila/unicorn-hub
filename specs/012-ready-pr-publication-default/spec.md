# Spec: Ready PR Publication Default

## Goal

Make the canonical Unicorn Hub PR publisher open pull requests ready for review by default while retaining draft creation as an explicit author choice.

## Scope

In scope:

- `scripts/publish-branch.mjs` argument handling for ready and draft PR creation
- bootstrap coverage that preserves the canonical publisher in installed repositories
- documentation for the source blueprint and installed workflow
- automated tests for both publication modes

Out of scope:

- changing branch protection, required checks, review evidence, or merge authority
- changing unrelated bootstrap templates or profile behavior

## User Stories

### US1: Default Ready PR

As a workflow user, I want `node scripts/publish-branch.mjs` to create a ready-for-review PR so that normal feature work immediately enters the repository review flow.

### US2: Intentional Draft PR

As a workflow user, I want `node scripts/publish-branch.mjs --draft` to create a draft PR so that I can explicitly pause review when work is knowingly incomplete.

## Acceptance Criteria

- AC-001: When no draft option is supplied, `scripts/publish-branch.mjs` calls `gh pr create` without `--draft`.
- AC-002: When `--draft` is supplied, `scripts/publish-branch.mjs` calls `gh pr create` with `--draft`.
- AC-003: Bootstrap installs the canonical publisher unchanged, so a newly bootstrapped repository receives the same default and explicit-draft behavior.
- AC-004: Source and installed workflow documentation state the ready-by-default contract and the explicit `--draft` escape hatch.

## Negative Scenarios

- NS-001: A normal publication must not silently create a draft PR.
- NS-002: An explicit `--draft` invocation must not be ignored.
- NS-003: The change must not alter unrelated portable workflow, CI, review-gate, or branch-protection behavior.
- NS-004: The blueprint must remain synthetic and free of secrets, private identifiers, and source-project residue.

## Requirements

- FR-001: Build the `gh pr create` arguments so `--draft` is present only when the parsed `draft` option is truthy.
- FR-002: Add isolated tests that inspect the effective `gh pr create` arguments for default-ready and explicit-draft runs.
- FR-003: Add bootstrap coverage proving the installed publisher remains byte-identical to the canonical source.
- FR-004: Update only documentation that describes PR publication behavior.

## Success Criteria

- SC-001: Both publication-mode tests pass.
- SC-002: `pnpm run preflight` passes, including sanitizer, baseline, and feature-memory checks.
- SC-003: The resulting PR is opened ready for review and has green required CI checks before handoff.

## Assumptions

- GitHub CLI creates a ready-for-review PR when `gh pr create` omits `--draft`.
- Bootstrap continues to copy `scripts/publish-branch.mjs` from the source blueprint without transformations.
