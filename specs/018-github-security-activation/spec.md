# Spec: GitHub Security Activation

## Goal

Make Dependabot, OSV scanning, GitHub repository security settings, and safe branch-protection activation a complete portable Unicorn Hub contract that can be installed and explicitly activated without creating nonexistent required checks.

## Scope

In scope:

- preserve the accepted per-ecosystem Dependabot minor/patch grouping and cooldown behavior in the template and profile renderer
- profile-scoped Dependabot ecosystems for generic, Node, Flutter, and Python consumers
- fail-closed OSV workflow behavior and profile-aware `osv-scan` required checks
- an installed, idempotent GitHub security settings script with `--dry-run`
- explicit activation ordering after workflows reach the default branch
- required-check existence validation before branch protection changes
- a short portable incident-response checklist
- synthetic regression tests and durable documentation

Out of scope:

- changing Unicorn Hub's live GitHub security settings or branch protection before this feature is merged to `main`
- rebuilding the Dependabot grouping already delivered by PR #14
- combining updates from different ecosystems into one pull request
- introducing a vulnerability scanner beyond OSV, Dependabot, and GitHub security features
- building an incident-management system

## User Stories

### User Story 1

As an installing maintainer, I want every relevant ecosystem to receive the accepted Dependabot cooldown and minor/patch grouping, so routine dependency updates are grouped without hiding major updates or mixing ecosystems.

### User Story 2

As a repository administrator, I want one explicit command to enable supported GitHub security features and report unsupported features separately from real failures, so activation is trustworthy and repeatable.

### User Story 3

As a maintainer applying branch protection, I want required checks verified on the default branch first, so an absent status context cannot silently block every future pull request.

## Acceptance Criteria

- AC-001: The Dependabot template and rendered profile output use weekly schedules, per-ecosystem `minor-and-patch` groups containing only `minor` and `patch`, separate majors, and the accepted cooldown values.
- AC-002: `github-actions` receives only `cooldown.default-days: 7`; semver-aware ecosystems receive default 7, major 14, minor 7, and patch 3 days.
- AC-003: Flutter installs only `pub` and `github-actions`; Node profiles install `npm` and `github-actions`; Python profiles install their relevant Python ecosystem and `github-actions`; generic output remains covered by regression tests.
- AC-004: The OSV workflow runs on pull requests, pushes to `main`, the weekly schedule, and manual dispatch, and explicitly fails when vulnerabilities are found.
- AC-005: Every profile that installs the OSV workflow includes `osv-scan` in generated `requiredChecks`; a profile excluding that workflow does not receive the check. Root and template config defaults include `osv-scan`.
- AC-006: `scripts/apply-security-settings.mjs` discovers the current repository via `gh`, supports `--dry-run`, enables Dependabot vulnerability alerts and security updates, enables secret scanning and push protection, and attempts validity checks and non-provider patterns when supported.
- AC-007: The security script is idempotent, distinguishes already enabled, newly enabled, unsupported, and failed states, exits nonzero on any failed mandatory feature, and never reports success for unapplied mandatory protection.
- AC-008: Bootstrap installs the security script and prints activation steps that require explicit remote-operation confirmation after workflows reach the default branch.
- AC-009: Successful activation applies branch protection from `.unicorn-hub/config.json` only after the workflows are present on the default branch and all required check contexts have appeared in recent repository runs.
- AC-010: Branch protection refuses to mutate GitHub when any configured required check is absent.
- AC-011: Portable DevOps documentation includes a concise incident-response checklist covering reinfection containment, secret rotation, GitHub/registry/SSH/integration tokens, verified-backup recovery, multiple backup generations, and one immutable copy.
- AC-012: Dependabot security-update state accepts both GitHub response shapes observed in production: `200` with an `enabled` boolean and the compatible `204`/`404` no-content form.
- AC-013: Dependabot security updates count as enabled only when GitHub reports them enabled and not paused; a paused repository is remediated and re-verified before branch protection is attempted.

## Negative Scenarios

- NS-001: `--dry-run` performs read-only inspection and emits no mutating GitHub API calls.
- NS-002: A second security-settings run observes already-enabled features and does not disable or misreport them.
- NS-003: A GitHub API permission, authentication, or unexpected server error is not classified as success or plan unavailability.
- NS-004: A plan/repository type that cannot enable an optional feature reports `unsupported` while still enabling available mandatory features.
- NS-005: A profile that excludes `osv-scan.yml` does not acquire an impossible `osv-scan` required check.
- NS-006: Branch protection is not applied when one or more configured status contexts have never appeared on the default branch.
- NS-007: `github-actions` output never contains unsupported semver cooldown fields, and major updates never enter the minor/patch group.
- NS-008: A disabled `200 {"enabled":false}` security-update response is planned for enablement instead of being misclassified as an API failure.
- NS-009: A paused `200 {"enabled":true,"paused":true}` security-update response never reports the feature as enabled; if it stays paused after remediation, activation fails closed and branch protection is not applied.

## Requirements

- FR-001: Keep implementation dependency-free on Node.js 20+ and use `gh api` for GitHub operations.
- FR-002: Use repository discovery from `gh repo view` unless an explicit synthetic `--repo` override is supplied for tests or automation.
- FR-003: Make every remote mutation obvious in CLI output and require an explicit activation flag before changing GitHub.
- FR-004: Evaluate security features independently so one unsupported optional feature does not disable available baseline protection.
- FR-005: Verify postconditions by re-reading GitHub state rather than trusting only mutation response codes.
- FR-006: Keep profile data and generated examples neutral and configurable through `.unicorn-hub/config.json`.
- FR-007: Preserve consumer-owned script collisions by default and use the existing `--force` refresh contract.

## Success Criteria

- SC-001: Focused tests cover Dependabot ecosystems/grouping, OSV required checks, security dry-run/idempotency/error classification, bootstrap installation/ordering, and required-check preflight.
- SC-002: `pnpm run preflight` passes, including sanitizer, baseline, workflow sync, tests, and synthetic bootstrap.
- SC-003: A final code review finds no unresolved blocking issues.
- SC-004: A commit with the required Codex co-author trailer is pushed and a ready-for-review PR is published with the required attribution.

## Assumptions

- PR #20 is the dependency-install prerequisite described as PR1, is merged, and is contained in the current `origin/main`.
- GitHub's repository update API remains the supported interface for secret scanning, push protection, and supported extended secret-scanning settings.
- Status contexts can be established by recent check runs or commit statuses after the workflow definitions have reached the default branch; PR-only checks are not expected to run on the default-branch head.
