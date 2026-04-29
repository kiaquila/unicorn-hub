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

Review hardening keeps root workflows synchronized from templates via a local script and CI preflight check. Security-sensitive workflow values are routed through environment variables before shell use, and external Actions are pinned by commit SHA with tag comments.

AI review validation uses exact trusted bot logins. Defaults cover the supported review agents, while `.unicorn-hub/config.json` can add repository-specific trusted logins without reintroducing substring matching.

Codex review validation accepts native `COMMENTED` reviews for the current head when inline findings are absent or advisory-only `P3`. Trusted no-findings `Codex Review:` summary comments remain acceptable only when they name the current head SHA, avoiding stale summary evidence.

AI review evidence collection reads paginated GitHub API results for reviews, review comments, and issue comments. This avoids missing recent Codex findings or trusted triggers on long-running PRs with more than one page of discussion.

The preflight entrypoint is a Node.js script that orchestrates feature memory, baseline, workflow parity, syntax, sanitizer, and tests without shell-only loops.

## Verification

- `pnpm run preflight`
- extra forbidden-term sanitizer pass
- `git diff --check`

## Risks

- Initial workflow installation PRs cannot run trusted default-branch gate scripts because they do not exist yet. Mitigation: PR Guard has a narrow first-install fallback only when the trusted script is absent on the default branch.
