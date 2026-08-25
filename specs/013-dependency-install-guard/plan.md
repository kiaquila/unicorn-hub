# Plan: Portable Dependency Install Guard

## Summary

Implement one dependency-free Node checker with explicit base/head inputs, deterministic policy helpers, official-registry verification, pnpm lock/install-script enforcement, and profile-scoped Python lock validation. Install it through bootstrap, invoke it inside the existing PR Guard, and document the strict contracts.

## Technical Context

- runtime: Node.js 20+ ESM; pnpm 10.34.5; Python policy invokes `uv` or pip only through documented CI/profile commands
- dependencies: no new runtime libraries; Node built-ins and package-manager CLIs only
- product paths: workspace settings, package/config templates, workflows, scripts, profiles, tests, docs, feature memory
- data changes: configuration schema gains dependency-policy fields and version-scoped exception records

## Scope Boundaries

- in scope: direct-dependency diff validation, registry metadata checks, name heuristics, exact-version install-script policy, Node/Python lock contracts, bootstrap propagation
- out of scope: transitive-package reputation scoring, branch protection, GitHub Advanced Security configuration, new required checks

## Constitution Check

- Spec-first: this feature memory is created before implementation changes.
- Testable boundaries: registry access is injectable for deterministic unit tests; CLI behavior is covered with synthetic repositories.
- PR-only: implementation remains on `codex/dependency-install-guard` and will be published as a ready PR.
- Simplicity: one small checker and configuration object; no database or service.
- Deployability: the existing `guard` context and bootstrap managed-file rules remain intact.

## Complexity Tracking

The checker centralizes related dependency policy because source validation, lock resolution, name analysis, registry metadata, and Python lock contracts must produce one fail-closed result. Its pure helpers and injectable fetch boundary keep the logic testable without introducing external packages or a service.

## Verification

| Acceptance criterion | Evidence |
| --- | --- |
| AC-001 | Workspace parity assertions and pnpm configuration tests. |
| AC-002 | Workflow assertions plus synthetic missing/stale lockfile CLI tests. |
| AC-003 | Dependency-policy tests for direct diff scope and forbidden source forms. |
| AC-004 | Mock-registry tests for valid, missing, young, and unavailable metadata. |
| AC-005 | Synthetic typo, transposition, Unicode, and exception tests. |
| AC-006 | Exact-version allowBuilds assertions, unknown/allowed install-script tests, and fail-closed pnpmfile hook tests. |
| AC-007 | Python profile/config assertions plus hashed-lock/uv tests proving the guard does not build or install PR project sources and rejects non-official artifact URLs. |
| AC-008 | Bootstrap tests for installed files, settings, config, collision preservation, and forced refresh. |
| AC-009 | Root/template PR Guard parity test showing the checker runs inside `guard`. |

Negative scenario evidence:

- Run the focused dependency-policy test suite covering NS-001 through NS-010.
- Run `pnpm run preflight` for sanitizer, baseline, workflow sync, syntax, and full tests.

## Risks

- Risk: range declarations cannot be verified as exact versions from registry metadata alone.
  Mitigation: resolve the direct package/version from the committed pnpm lockfile and require a single exact version.
- Risk: simple name similarity can produce false positives.
  Mitigation: compare against a small configurable protected-name set and require narrow exact-version exceptions with reasons.
- Risk: first-install PR Guard cannot use a checker absent from the default branch.
  Mitigation: mirror the existing trusted-script fallback used by other guard scripts and fail clearly if neither copy exists.
- Risk: Python projects vary in tooling.
  Mitigation: support the preferred uv contract plus one hashed pip lock contract only for Python-enabled profiles.
- Risk: pnpmfile hooks can rewrite dependency manifests during a frozen install.
  Mitigation: reject default hook files and local/global pnpmfile settings before invoking pnpm.
- Risk: syncing a PR-controlled Python project can execute its local PEP 517 backend.
  Mitigation: validate and sync uv locks with source builds disabled, and omit the current project from the guard environment.
- Risk: a lockfile can retain an official registry while pointing an artifact URL at another host.
  Mitigation: validate every uv artifact URL against the exact official PyPI distribution origin and path before invoking uv.
- Risk: pnpm graph-rewrite settings can inject transitive dependencies without changing a direct declaration.
  Mitigation: reject overrides, package extensions, and patched dependencies in workspace and manifest policy before invoking pnpm.
