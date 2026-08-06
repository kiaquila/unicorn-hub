# Plan: Portable Dependabot Grouping

## Summary

Synchronize the checked-in configuration, template, and bootstrap renderer so every installed repository receives the same safe Dependabot behavior.

## Technical Context

- runtime: Node.js ESM bootstrap script
- dependencies: none added
- product paths: templates, scripts, tests, specs
- data changes: no dependency or lockfile updates

## Scope Boundaries

- in scope: Dependabot template, renderer, and generation tests
- out of scope: package upgrades and workflow scheduling changes

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Flutter-profile bootstrap test asserts the GitHub Actions section contains only `default-days`. |
| AC-002 | Bootstrap test asserts `minor-and-patch` contains both allowed update types for GitHub Actions and pub. |
| AC-003 | A direct parity test compares the root Dependabot configuration with its template counterpart. |
| AC-004 | Existing explicit-zero renderer test remains green. |

## Risks

- Risk: a root-only configuration change would leave generated repositories stale.
  Mitigation: update the template and renderer in the same commit, with generated-output assertions.
- Risk: broadly removing semantic cooldown fields would change non-Actions ecosystems.
  Mitigation: condition renderer behavior on the `github-actions` ecosystem only.
