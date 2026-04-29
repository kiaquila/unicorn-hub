# Spec: Portable Multi-Agent Development Blueprint

## User Stories

### US1: Install The Blueprint Into A New Repository

As a repository owner, I want an agent to copy this blueprint into a target repository so that the target gets docs, specs, scripts, workflows, and review gates without access to any private source repository.

### US2: Verify The Installed Workflow

As a repository owner, I want local checks and tests to prove the blueprint is complete and portable before opening a PR.

### US3: Prevent Source-Project Leakage

As a repository owner, I want the blueprint to reject secrets, private infrastructure identifiers, personal paths, and source-project residue so that the repository remains a distilled public-quality practice reference.

## Requirements

- FR-001: The repository must include installable templates for agent guidance, documentation, spec memory, GitHub workflows, package manager configuration, and dependency update policy.
- FR-002: The repository must include reusable scripts for bootstrap, feature-memory enforcement, baseline checks, AI review validation, worktree creation, PR publishing, review-agent switching, and branch protection.
- FR-003: The repository must include project profiles for common target shapes.
- FR-004: The repository must include automated tests that exercise bootstrap and review helper behavior.
- FR-005: The repository must include sanitizer checks for secret-like and non-portable content.
- FR-006: Root GitHub workflows must remain generated from `templates/.github/workflows/` so the blueprint repository and installed targets do not drift.
- FR-007: GitHub workflow inputs and repository variables must not be interpolated directly into shell scripts.
- FR-008: AI review evidence must come from exact trusted bot logins, with target repositories able to extend trusted logins through `.unicorn-hub/config.json`.
- FR-009: Local preflight must avoid shell-only syntax so it can run on Windows, macOS, and Linux hosts.
- FR-010: Codex review validation must accept head-bound Codex review evidence, including native `COMMENTED` reviews classified by `P0`-`P3` inline findings and trusted no-findings `Codex Review:` summary comments that name the current head.
- FR-011: AI review validation must read paginated GitHub review and issue comment evidence so recent findings and triggers are not missed on long PRs.

## Success Criteria

- SC-001: `pnpm run preflight` passes locally.
- SC-002: A synthetic target repository can be bootstrapped and pass baseline checks.
- SC-003: Extra forbidden-term sanitizer checks pass without committing the forbidden terms into the blueprint.
- SC-004: Root workflow parity, pinned GitHub Actions, exact bot-login matching, personal path detection, and cross-platform preflight behavior are covered by local checks.
- SC-005: Codex native commented reviews and head-bound no-findings summary comments are covered by review-helper tests and documented in the generated review contract.
- SC-006: AI review evidence collection handles GitHub API pagination.
