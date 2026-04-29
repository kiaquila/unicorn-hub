# Spec: SENAR Process Layer

## Goal

Add a lightweight SENAR layer to Unicorn Hub so installed repositories capture goal, scope, acceptance evidence, negative scenarios, and process memory without replacing the existing spec-first PR workflow.

## Scope

In scope:

- document how SENAR maps to Unicorn Hub
- update installed spec, plan, task, checklist, agent, and devops templates
- add a pull request checklist for SENAR done-gate evidence
- keep the implementation portable and dependency-free

Out of scope:

- changing GitHub Actions gate behavior
- requiring a specific external SENAR tool
- changing the solo-owner branch protection default

## User Stories

### US1: Make Feature Memory More Verifiable

As a repository owner, I want feature specs to capture goal, scope, acceptance criteria, and negative scenarios so that AI agents implement against explicit behavior instead of inferred intent.

### US2: Preserve Process Memory

As a maintainer, I want dead ends, decisions, and known issues recorded with each feature so that future agents do not repeat discarded approaches or erase accepted tradeoffs.

### US3: Carry SENAR Into Installed Repositories

As an installing agent, I want the blueprint templates to include SENAR done-gate fields so that new repositories inherit the process automatically.

## Acceptance Criteria

- AC-001: The blueprint includes a SENAR mapping document that explains how SENAR practices map to existing Unicorn Hub artifacts.
- AC-002: Installed `.specify` templates ask for goal, scope, acceptance criteria, negative scenarios, verification evidence, and process memory.
- AC-003: Installed agent and devops templates tell agents to verify acceptance criteria with evidence and update process memory.
- AC-004: Root and installed pull request templates include a SENAR Done Gate.
- AC-005: Local preflight passes.

## Negative Scenarios

- NS-001: The change must not add new runtime dependencies or require an external SENAR service.
- NS-002: The change must not alter fail-closed GitHub Action behavior or branch protection semantics.

## Requirements

- FR-001: Add documentation that positions SENAR as a layer on top of the existing workflow.
- FR-002: Update feature-memory templates to include SENAR fields.
- FR-003: Update agent-facing templates to make acceptance evidence and process memory part of the completion contract.
- FR-004: Add a pull request checklist that exposes the SENAR Done Gate in GitHub.
- FR-005: Add or update tests so bootstrap coverage proves the SENAR templates are installed.

## Success Criteria

- SC-001: `pnpm run preflight` passes.
- SC-002: The bootstrap test confirms installed repositories receive the SENAR spec and PR templates.
- SC-003: No workflow script or branch protection behavior changes are required for this layer.

## Assumptions

- SENAR should remain lightweight in Unicorn Hub and should not become a mandatory external dependency.
- Existing PR Guard remains structural: it requires feature memory files, while the SENAR checklist guides human and review-agent verification.
