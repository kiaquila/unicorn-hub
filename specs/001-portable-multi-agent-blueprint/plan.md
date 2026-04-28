# Plan: Portable Multi-Agent Development Blueprint

## Summary

Create a self-contained blueprint repository with docs, templates, reusable Node.js scripts, GitHub workflows, project profiles, tests, and sanitizer checks.

## Technical Context

- Runtime: Node.js ESM scripts.
- Package manager: pnpm with minimum release age.
- Product paths: docs, templates, scripts, profiles, tests, workflows.
- External services: GitHub CLI and GitHub Actions only where explicitly invoked.

## Constitution Check

- Spec-first: this folder provides feature memory for the blueprint PR.
- Testable boundaries: helper parsing and bootstrap behavior are covered by Node tests.
- PR-only: changes are prepared on a feature branch.
- Simplicity: scripts use built-in Node modules and JSON config.
- Deployability: the repository has self-checking CI and local preflight.

## Complexity Tracking

The bootstrap script copies templates and scripts rather than introducing a package installer. This keeps the first version inspectable and easy for agents to adapt.

The sanitizer supports extra forbidden terms through environment variables instead of committing source-project names into the repository. This preserves portability while still allowing a local final leakage scan.

## Verification

- `pnpm run preflight`
- extra forbidden-term sanitizer pass
- `git diff --check`

## Risks

- Initial workflow installation PRs cannot run trusted default-branch gate scripts because they do not exist yet. Mitigation: PR Guard has a narrow first-install fallback only when the trusted script is absent on the default branch.
