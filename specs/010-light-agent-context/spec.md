# Spec: Light Agent Context

## Goal

Make Unicorn Hub cheaper and clearer for coding agents by keeping always-on context compact, routing first setup through minimum documentation by default, and validating context substance in local preflight and PR gates.

## Scope

In scope:

- compact target `AGENTS.md` and `CLAUDE.md` templates
- a two-tier documentation router with minimum and full discovery paths
- docs that describe `docs_project/` as lazy-loaded durable memory
- a context-budget script that checks always-on file size and feature-memory substance
- bootstrap, baseline, profile, PR Guard, and test updates that install and run the new gate
- multi-agent guidance for deciding when extra agents are justified

Out of scope:

- changing GitHub review backends or branch protection semantics
- removing the spec-first workflow
- adding model-provider dependencies or external orchestration services

## User Stories

### US1: Start Small Before Coding

As a repository owner, I want agents to collect only the minimum project context needed for the first feature so that small changes do not begin with a large documentation interview.

### US2: Keep Launch Files Cheap

As an agent using a bootstrapped repository, I want `AGENTS.md` and `CLAUDE.md` to contain only hard rules and routing links so that every task starts with less irrelevant context.

### US3: Detect Context Drift

As a maintainer, I want preflight to fail oversized launch files and placeholder-only feature memory so that the blueprint stays lightweight after future edits.

## Acceptance Criteria

- AC-001: Installed target `AGENTS.md` and `CLAUDE.md` stay compact and route deeper workflow, review, and documentation details to task-scoped files.
- AC-002: `CREATE-DOCS.md` defaults to `docs-minimum.md` and reserves `docs-full-interview.md` for explicit full discovery or unclear project direction.
- AC-003: Preflight and PR Guard install and run `scripts/check-context-budget.mjs`, which enforces a line budget for always-on files and validates committed PR diffs.
- AC-004: `scripts/check-context-budget.mjs` rejects feature specs whose `Goal`, `Acceptance Criteria`, or `Verification` sections are missing or placeholder-only.
- AC-005: Documentation frames `docs_project/` as a lazy-loaded index rather than required reading before every task.
- AC-006: Multi-agent docs include a decision matrix that keeps single-agent work as the default and forbids parallel writers in the same worktree.

## Negative Scenarios

- NS-001: The change must not remove the requirement for feature memory before product-code PRs.
- NS-002: The change must not make full market, screen, or architecture interviews mandatory for every first feature.
- NS-003: The change must not add private URLs, source-project residue, secrets, production IDs, or personal paths.

## Requirements

- FR-001: Add minimum and full documentation templates and route first setup through them.
- FR-002: Update bootstrap-installed launch files to stay under the configured context budget.
- FR-003: Add a reusable context-budget script copied into target repositories.
- FR-004: Add tests for bootstrap output, installed compact docs, oversized launch-file rejection, and placeholder-only feature-memory rejection.
- FR-005: Update local preflight and PR Guard so context-budget validation runs before publish and against committed PR diffs.

## Success Criteria

- SC-001: `pnpm run preflight` passes.
- SC-002: Synthetic bootstrap targets include the new documentation router files and context-budget script.
- SC-003: Context-budget tests fail intentionally bloated or placeholder-only synthetic targets.

## Assumptions

- A small default docs path is enough for most first implementation tasks.
- Teams that need strategic discovery can still opt into the full interview.
- Context line budgets should be configurable later through `.unicorn-hub/config.json`, while the default remains conservative.
