# Tasks: Portable Multi-Agent Development Blueprint

## Documentation

- [x] Create root README and docs explaining the blueprint.
- [x] Document bootstrap, spec-kit, multi-agent, CI, preflight, supply-chain, and sanitizer practices.

## Templates

- [x] Add generic agent rules, documentation interview, docs skeleton, spec templates, workflows, Dependabot, and package manager templates.

## Scripts

- [x] Add bootstrap, feature-memory, baseline, sanitizer, AI review, worktree, PR publish, review switch, and branch protection scripts.

## Profiles

- [x] Add static frontend, Next.js, Python service, bot, and generic profiles.

## Verification

- [x] Add Node tests for bootstrap, baseline, sanitizer, and review helpers.
- [x] Run `pnpm run preflight`.
- [x] Run extra forbidden-term sanitizer pass.

## Review Hardening

- [x] Pin external GitHub Actions by full commit SHA with tag comments.
- [x] Route AI review workflow variables through environment before shell use.
- [x] Generate root workflows from templates and assert parity in preflight.
- [x] Replace substring review-login checks with exact trusted logins configurable through `.unicorn-hub/config.json`.
- [x] Expand sanitizer personal path coverage across common host formats.
- [x] Replace shell-only preflight syntax checks with a Node-based preflight entrypoint.
- [x] Document the zero-human-approval branch protection default.
- [x] Add review-fix tests for workflow parity, login matching, sanitizer coverage, and helper behavior.
- [x] Fix pnpm optional test/build invocation in the generated CI workflow.
- [x] Accept native Codex `COMMENTED` reviews without blocking inline findings.
- [x] Require trusted Codex no-findings summary comments to name the current head.
- [x] Read paginated GitHub review, review-comment, and issue-comment evidence in the AI Review gate.
- [x] Document Codex summary-comment review evidence in blueprint and generated contract docs.
