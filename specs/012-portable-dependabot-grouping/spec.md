# Spec: Portable Dependabot Grouping

## Goal

Keep Dependabot configuration valid and consistent both in Unicorn Hub and in repositories bootstrapped from it: GitHub Actions uses only the supported default cooldown, and each ecosystem groups minor and patch updates.

## Scope

In scope:

- the root Dependabot configuration and its template counterpart
- bootstrap rendering of profile-defined Dependabot updates
- tests covering the generated GitHub Actions and pub configuration

Out of scope:

- changing dependency versions or lockfiles
- adding or removing monitored ecosystems
- altering Dependabot schedules, labels, or pull-request limits

## Acceptance Criteria

- AC-001: GitHub Actions keeps `cooldown.default-days` and has no `semver-*-days` keys.
- AC-002: Every generated ecosystem configuration groups `minor` and `patch` updates under `minor-and-patch`.
- AC-003: The template mirrors the root Dependabot configuration for the npm and GitHub Actions ecosystems.
- AC-004: Bootstrap rendering preserves explicit non-GitHub-Actions cooldown values, including zero values.

## Negative Scenarios

- NS-001: Bootstrap must not emit unsupported semantic-version cooldown keys for GitHub Actions.
- NS-002: The change must not modify application dependencies or lockfiles.
- NS-003: Profile-specific ecosystems such as `pub` must retain their configurable semantic-version cooldowns.

## Requirements

- FR-001: Render only `default-days` in a GitHub Actions cooldown block.
- FR-002: Render a per-ecosystem minor-and-patch group for bootstrap-provided Dependabot updates.
- FR-003: Prove the generated Flutter profile configuration has the expected GitHub Actions and pub behavior.

## Success Criteria

- SC-001: `pnpm run preflight` passes.
- SC-002: Bootstrap tests prove the rendered configuration meets AC-001 through AC-004.
