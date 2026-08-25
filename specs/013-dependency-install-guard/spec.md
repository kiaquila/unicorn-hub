# Spec: Portable Dependency Install Guard

## Goal

Add a portable, fail-closed dependency installation policy that hardens Node and relevant Python profiles, catches obvious typosquatting risks, and remains a small repository-native guard rather than a reputation platform.

## Scope

In scope:

- root and bootstrapped `pnpm-workspace.yaml` security settings
- frozen pnpm lockfile enforcement in CI and repository checks
- a dependency-policy checker installed into consumer repositories and invoked by the existing PR Guard
- validation of newly added or changed direct Node dependencies against the official registry, publication time, obvious spelling/transposition and Unicode-confusable risks, and version-scoped exceptions
- explicit pnpm install-script allowlisting
- locked Python installation contracts for `python-service` and `telegram-bot`
- profile-aware bootstrap configuration, documentation, and synthetic tests

Out of scope:

- GitHub security settings or branch-protection changes
- a package popularity database, generalized reputation service, or new required status context
- applying Python dependency rules to profiles that do not declare Python dependency management
- global lifecycle-script enablement

## User Stories

### User Story 1

As a repository maintainer, I want dependency additions to fail closed when their source, registry identity, exact version, age, or name safety cannot be verified, so that dependency installation remains reviewable and conservative.

### User Story 2

As an installing agent, I want Unicorn Hub to bootstrap the checker, policy configuration, and strict install contracts without silently overwriting consumer files, so that the protection is portable and predictable.

### User Story 3

As a Python profile maintainer, I want either a locked `uv` workflow or a fully hashed binary-only pip workflow, so that an unpinned `requirements.txt` is never represented as the safe default.

## Acceptance Criteria

- AC-001: Root and template pnpm settings retain `minimumReleaseAge: 10080` and enable `blockExoticSubdeps`, `trustPolicy: no-downgrade`, `strictDepBuilds`, and an explicit `allowBuilds` map without globally allowing lifecycle scripts.
- AC-002: Node CI and repository validation fail when `pnpm-lock.yaml` is missing or stale and install only with `pnpm install --frozen-lockfile`.
- AC-003: The existing `guard` job checks only new or changed direct dependency declarations and rejects Git, URL, tarball/archive, local, and unknown-registry sources.
- AC-004: Registry dependencies pass only when the exact package name and resolved exact version exist in the configured official registry and the publication timestamp satisfies the configured minimum age; registry unavailability is reported as not verified and fails the check.
- AC-005: Obvious misspellings, adjacent transpositions, and Unicode substitutions are blocked until a version-scoped exception with a non-empty reason is present in `.unicorn-hub/config.json`.
- AC-006: Install scripts are denied by pnpm unless the exact package and version are explicitly allowed, and repository-controlled pnpmfile hooks are rejected before installation.
- AC-007: Python-enabled profiles use `uv.lock` with `uv lock --check` and `uv sync --locked`, or a fully pinned hashed requirements lock installed using isolated pip, the official index, `--require-hashes`, and `--only-binary :all:`; unpinned requirements installs are not accepted.
- AC-008: Bootstrap installs the checker and settings, exposes policy through `.unicorn-hub/config.json`, preserves consumer files unless `--force` authorizes replacement, and keeps generated examples synthetic.
- AC-009: The checker is integrated into PR Guard without adding a new required check.

## Negative Scenarios

- NS-001: A nonexistent registry package or exact version is rejected.
- NS-002: A dependency name with a one-edit typo, adjacent transposition, or Unicode confusable is rejected without a matching version-scoped exception and reason.
- NS-003: Git, URL, archive, tarball, local path, or unknown-registry dependency specifications are rejected.
- NS-004: Registry downtime produces a fail-closed “not verified” result rather than a pass.
- NS-005: An install-script package absent from the exact-version allowlist is blocked while an explicitly allowed package/version passes; repository pnpmfile hooks and hook settings are rejected before pnpm runs.
- NS-006: A missing or manifest-stale pnpm lockfile is rejected.
- NS-007: A Python requirements lock entry without a required hash is rejected.
- NS-008: Non-Python profiles are not forced to adopt Python lock tooling.

## Requirements

- FR-001: Keep the implementation dependency-free and use official registry metadata rather than a local popularity database.
- FR-002: Compare direct dependency declarations between explicit base and head refs, including dependencies, devDependencies, optionalDependencies, and peerDependencies.
- FR-003: Treat inability to verify required remote metadata as a blocking error with an explicit not-verified diagnostic.
- FR-004: Scope exceptions to package name plus exact version and require a human-readable reason visible in repository configuration.
- FR-005: Keep all policy defaults configurable through `.unicorn-hub/config.json` and profile output.
- FR-006: Install all required checker scripts through the existing bootstrap allowlist and managed-file contract.
- FR-007: Preserve consumer-owned collisions by default and refresh managed targets only under the established `--force` behavior.
- FR-008: Use only neutral synthetic fixtures and mocked registry responses in tests.

## Success Criteria

- SC-001: Focused dependency-policy, workflow, baseline, and bootstrap tests cover every requested pass/fail scenario.
- SC-002: `pnpm run preflight` passes, including sanitizer, baseline, workflow synchronization, syntax, and all tests.
- SC-003: A final code review finds no unresolved blocking issues.
- SC-004: The ready-for-review PR is published from a `codex/` branch with the required attribution trailers.

## Assumptions

- The project remains on pnpm 10.x, where the requested workspace policy keys are supported.
- Exact registry verification may resolve an exact version from a lockfile when a direct manifest uses a semver range; direct non-registry protocols remain forbidden.
- The official npm registry is the only supported Node registry for this portable policy.
