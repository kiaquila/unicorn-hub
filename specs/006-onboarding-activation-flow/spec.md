# Spec: Onboarding Activation Flow

## Goal

Make Unicorn Hub's public quickstart and installed repository guidance executable for agents and humans, from finding the blueprint through the first project docs and first feature spec.

## Scope

In scope:

- Clarify the source discovery path in the root `README.md`, including the canonical GitHub URL and local `--source` usage.
- Add an explicit post-bootstrap path for empty or under-documented target repositories.
- Surface `CREATE-DOCS.md` as the first project-documentation protocol before product-code work.
- Update installed templates so bootstrapped repositories tell agents what to do before the first feature.
- Update bootstrap output to print actionable next steps.
- Add synthetic tests for the new bootstrap output and installed guidance.

Out of scope:

- Changing the spec-kit architecture or file layout.
- Changing GitHub workflow semantics, branch protection, or AI review policy.
- Adding product-specific examples, private repository references, or real deployment details.

## User Stories

### User Story 1

As a user trying Unicorn Hub from GitHub, I want the quickstart prompt to name the blueprint source explicitly, so that my agent does not fail before bootstrap by trying to infer or search for the repository.

### User Story 2

As a user bootstrapping an empty repository, I want clear next steps after installation, so that I know to document the project and create the first feature spec before asking an agent to implement code.

### User Story 3

As an agent working inside a newly bootstrapped target repository, I want installed guidance to detect placeholder project docs, so that I ask for product context instead of inventing implementation details.

## Acceptance Criteria

1. Given the root `README.md`, when a user copies the quickstart prompt, then the prompt includes the canonical Unicorn Hub GitHub URL and tells the agent to clone or open the blueprint if needed.
2. Given the root `README.md`, when a user has already cloned Unicorn Hub locally, then the bootstrap command still shows explicit `--source /path/to/unicorn-hub` usage.
3. Given bootstrap finishes successfully, when the terminal output is inspected, then it names `CREATE-DOCS.md`, `docs_project`, `specs/<feature-id>`, and the project preflight as next steps.
4. Given a target repository is bootstrapped, when installed `README.md`, `AGENTS.md`, or `CLAUDE.md` are inspected, then they include first-setup guidance for running the documentation interview before product code.
5. Given installed docs are generated for stack-specific profiles, when those docs describe required checks, then they still point at `.unicorn-hub/config.json` instead of hard-coding profile-sensitive status contexts.
6. Given this blueprint PR, when `pnpm run preflight` runs, then sanitizer, baseline, workflow sync, syntax, and tests pass.

## Negative Scenarios

1. Given a target repository already has mature project docs, when bootstrap guidance is read, then the user is told to refresh or review docs rather than duplicate them blindly.
2. Given the agent cannot access GitHub, when following the quickstart, then the docs still offer the local `--source` path as the supported path.

## Requirements

- FR-001: Public quickstart guidance must be self-contained enough for an agent that has no prior knowledge of Unicorn Hub.
- FR-002: Post-bootstrap guidance must separate project documentation, feature memory, and implementation into distinct ordered steps.
- FR-003: Installed templates must direct agents to `CREATE-DOCS.md` and `ai-docs-guide.md` for first setup.
- FR-004: Bootstrap output must print concrete next actions, not only a generic "review placeholders" message.
- FR-005: All new examples must remain neutral and synthetic.

## Success Criteria

- SC-001: A user can paste the root quickstart prompt into an agent and the agent has enough information to locate Unicorn Hub.
- SC-002: A bootstrapped empty target gives the user a clear route from placeholders to docs, first spec, and implementation.

## Assumptions

- The canonical public repository URL is `https://github.com/kiaquila/unicorn-hub`.
- `CREATE-DOCS.md` is the supported first-setup documentation interview for new or under-documented projects.
